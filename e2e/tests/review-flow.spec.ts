import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../../fixtures/documents", name);

const sidebar = (page: Page) => page.locator("aside[aria-label=Review]");
const fieldRow = (page: Page, label: string) => sidebar(page).getByRole("button").filter({ hasText: label });
const card = (page: Page) => page.locator("[data-review-card]");

async function open(page: Page, title: RegExp) {
  await page.goto("/");
  await page.getByRole("link", { name: title }).click();
  await expect(sidebar(page).getByText("Review progress")).toBeVisible();
}

async function approve(page: Page, label: string) {
  await fieldRow(page, label).click();
  await expect(card(page)).toContainText(label);
  await card(page).getByRole("button", { name: /Approve|Confirm absent/ }).click();
  await expect(card(page)).toContainText("Approved");
}

test.describe.configure({ mode: "serial" });

test("the seeded fixtures are listed and ready to review", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const pipeline = page.getByRole("button", { name: "Review pipeline" });
  await pipeline.click();
  await expect(pipeline).toHaveAttribute("aria-expanded", "false");
  const upload = page.getByRole("button", { name: "Upload PDF" });
  await expect.poll(async () => {
    const [toggleBox, uploadBox] = await Promise.all([pipeline.boundingBox(), upload.boundingBox()]);
    if (!toggleBox || !uploadBox) return Infinity;
    return Math.abs((toggleBox.y + toggleBox.height / 2) - (uploadBox.y + uploadBox.height / 2));
  }).toBeLessThan(2);
  await page.reload();
  await expect(pipeline).toHaveAttribute("aria-expanded", "false");
  await pipeline.click();
  await expect(page.locator("#pipeline-chart")).toBeVisible();
  for (const title of [/Invoice — Meridian/, /Lease excerpt/, /Market report excerpt/]) {
    const row = page.getByRole("link", { name: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Ready to review");
  }
  expect(pageErrors).toEqual([]);
});

test("a field missing from the document is a gap with a reason, not a guess", async ({ page }) => {
  await open(page, /Market report excerpt/);
  await expect(fieldRow(page, "Median household income")).toContainText("Not found");
  await fieldRow(page, "Median household income").click();
  await expect(card(page)).toContainText("not mentioned in the document");
});

test("the original PDF is shown with a box on every extracted value", async ({ page }) => {
  await open(page, /Invoice — Meridian/);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator(".evidence-box")).toHaveCount(5);
  await page.locator(".evidence-box[title^='Total amount']").click();
  await expect(card(page)).toContainText("Source passage · v1 · Page 1");
  const canvas = await page.locator("canvas").first().elementHandle();
  const reloads: string[] = [];
  page.on("request", (req) => { if (req.url().endsWith("/file")) reloads.push(req.url()); });
  await page.getByRole("tab", { name: "Text" }).click();
  await expect(page.locator("mark.evidence").first()).toBeVisible();
  await page.getByRole("tab", { name: "PDF" }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(await canvas!.evaluate(el => el === document.querySelector("canvas"))).toBe(true);
  expect(reloads).toHaveLength(0);
});

test("a revised invoice brings back exactly the changed values for review", async ({ page }) => {
  await open(page, /Invoice — Meridian/);
  for (const label of ["Invoice number", "Issue date", "Due date", "Vendor name", "Total amount"]) await approve(page, label);
  await expect(sidebar(page)).toContainText("All reviewed");

  await page.getByRole("button", { name: /v1.*current/ }).click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["v1"]);
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload", exact: true }).click();
  await (await choosing).setFiles(fixture("invoice-001.v2.pdf"));
  await expect(sidebar(page)).toContainText("2 to review", { timeout: 60_000 });

  for (const label of ["Due date", "Total amount"]) await expect(fieldRow(page, label)).toContainText("changed");
  for (const label of ["Invoice number", "Issue date", "Vendor name"]) await expect(fieldRow(page, label)).not.toContainText("changed");

  await fieldRow(page, "Total amount").click();
  await expect(card(page)).toContainText("Approved in v1");
  await expect(card(page)).toContainText("$5,230.29");
  await expect(card(page).locator("blockquote")).toContainText("$6,126.45");
  await expect(card(page).locator("blockquote")).not.toContainText("$5,230.29");
  await card(page).getByText("Compare passages").click();
  await expect(card(page).locator("del").first()).toBeVisible();

  await fieldRow(page, "Issue date").click();
  await expect(card(page)).toContainText("Carried over from v1");
  await page.getByRole("button", { name: /v2.*current/ }).click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["v2", "v1"]);
  await page.getByRole("menuitemradio", { name: "v1" }).click();
  await expect(sidebar(page)).toContainText("read-only");
  await fieldRow(page, "Total amount").click();
  await expect(card(page).locator("blockquote")).toContainText("$5,230.29");
  await expect(card(page).getByRole("button", { name: "Correct" })).toHaveCount(0);
});

test("undo and redo are stored, so they survive a reload", async ({ page }) => {
  await open(page, /Lease excerpt/);
  await approve(page, "Tenant name");
  const panel = card(page);
  const undo = panel.getByRole("button", { name: "Undo", exact: true });
  const redo = panel.getByRole("button", { name: "Redo", exact: true });
  const correct = async (name: string) => {
    await panel.getByRole("button", { name: /Correct/ }).click();
    await panel.getByLabel("Corrected value").fill(name);
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(undo).toBeEnabled();
  };
  await correct("Dana O.");
  await undo.click();
  await expect(panel).toContainText("Step 1 of 2");
  await expect(undo).toBeEnabled();
  await page.keyboard.press("u");
  await expect(panel).toContainText("Needs review");
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();

  await page.reload();
  await fieldRow(page, "Tenant name").click();
  await expect(panel).toContainText("Step 0 of 2");
  await redo.click();
  await expect(panel).toContainText("Approved");
  await expect(redo).toBeEnabled();
  await page.keyboard.press("Shift+U");
  await expect(panel).toContainText("Reviewer correction");
  await expect(panel).toContainText("Dana O.");
  await expect(redo).toBeDisabled();
  await undo.click();
  await correct("Dana Okafor");
  await expect(redo).toBeDisabled();
  await expect(panel).toContainText("Step 2 of 2");
});
