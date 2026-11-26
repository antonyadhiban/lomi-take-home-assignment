import type { DocumentDetail, DocumentSummary, ReviewInput } from "./types";

/** The browser talks to the API directly (CORS); set at build time. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as T;
}

export const api = {
  listDocuments: () => request<{ documents: DocumentSummary[] }>("/documents").then((r) => r.documents),
  getDocument: (id: string, version?: number) =>
    request<DocumentDetail>(`/documents/${encodeURIComponent(id)}${version ? `?version=${version}` : ""}`),
  documentTypes: () => request<{ types: string[] }>("/document-types").then((r) => r.types),
  upload: (input: { type: string; title: string; file: File }) => {
    const form = new FormData();
    form.set("type", input.type);
    form.set("title", input.title);
    form.set("file", input.file);
    return request<DocumentDetail>("/documents", { method: "POST", body: form });
  },
  uploadVersion: (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<DocumentDetail & { duplicate: boolean }>(`/documents/${encodeURIComponent(id)}/versions`, {
      method: "POST",
      body: form,
    });
  },
  retry: (id: string) => request<DocumentDetail>(`/documents/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  review: (valueId: string, input: ReviewInput & { expectedLatestEventId?: string | null }) =>
    request<{ event: unknown }>(`/values/${encodeURIComponent(valueId)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
};

export const isInFlight = (s: string | null | undefined) => s === "queued" || s === "extracting";
