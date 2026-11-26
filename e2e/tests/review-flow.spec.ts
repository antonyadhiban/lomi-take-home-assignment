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
  await page.goto("/");
  for (const title of [/Invoice — Meridian/, /Lease excerpt/, /Market report excerpt/]) {
    const row = page.getByRole("link", { name: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Ready to review");
  }
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
  await expect(card(page)).toContainText("“Total Due” in document");
});

test("a revised invoice brings back exactly the changed values for review", async ({ page }) => {
  await open(page, /Invoice — Meridian/);
  for (const label of ["Invoice number", "Issue date", "Due date", "Vendor name", "Total amount"]) await approve(page, label);
  await expect(sidebar(page)).toContainText("All reviewed");

  await page.locator("header input[type=file]").setInputFiles(fixture("invoice-001.v2.pdf"));
  await expect(sidebar(page)).toContainText("2 to review", { timeout: 60_000 });

  for (const label of ["Due date", "Total amount"]) await expect(fieldRow(page, label)).toContainText("changed");
  for (const label of ["Invoice number", "Issue date", "Vendor name"]) await expect(fieldRow(page, label)).not.toContainText("changed");

  await fieldRow(page, "Total amount").click();
  await expect(card(page)).toContainText("was $5,230.29");
  await expect(card(page)).toContainText("approved in v1");

  await fieldRow(page, "Issue date").click();
  await expect(card(page)).toContainText("Carried over from v1");
});

test("undo and redo are stored, so they survive a reload", async ({ page }) => {
  await open(page, /Lease excerpt/);
  await approve(page, "Tenant name");
  await card(page).getByRole("button", { name: "Undo" }).click();
  await expect(card(page)).toContainText("Needs review");

  await page.reload();
  await fieldRow(page, "Tenant name").click();
  const redo = card(page).getByRole("button", { name: "Redo" });
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(card(page)).toContainText("Approved");
});
