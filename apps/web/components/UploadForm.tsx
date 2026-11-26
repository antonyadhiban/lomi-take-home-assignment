"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { typeLabel } from "@/lib/format";

export function UploadForm() {
  const qc = useQueryClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("invoice");
  const [title, setTitle] = useState("");
  const types = useQuery({ queryKey: ["types"], queryFn: api.documentTypes, staleTime: Infinity });

  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      router.push(`/documents/${doc.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (file) upload.mutate({ type, title: title || file.name.replace(/\.pdf$/i, ""), file });
  };

  return (
    <form className="card card-pad" onSubmit={submit} aria-label="Upload a document">
      <div className="upload">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Document type">
          {(types.data ?? ["invoice", "lease", "market_report"]).map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
        <input type="text" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" required aria-label="PDF file" />
        <button className="btn btn-primary" disabled={upload.isPending}>
          {upload.isPending ? "Uploading…" : "Upload PDF"}
        </button>
      </div>
      {upload.error && <p className="error-text small" style={{ margin: "8px 0 0" }}>{upload.error.message}</p>}
    </form>
  );
}
