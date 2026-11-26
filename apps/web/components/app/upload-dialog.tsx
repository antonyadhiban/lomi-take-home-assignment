"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, UploadCloud, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { MAX_PDF_BYTES, PDF_ACCEPT, rejectionMessage } from "@/components/app/upload-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { typeLabel } from "@/lib/format";
import type { DocumentDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const prettySize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Guess the document type from the file name (the user can always change it). */
function guessType(name: string, types: string[]) {
  const n = name.toLowerCase();
  if (/invoice|inv[-_]/.test(n)) return "invoice";
  if (/lease|rental-agreement/.test(n)) return "lease";
  if (/market|report/.test(n)) return "market_report";
  return types[0] ?? "invoice";
}

export function UploadDialog({
  open,
  initialFile,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  initialFile?: File;
  onOpenChange: (open: boolean) => void;
  onUploaded: (doc: DocumentDetail) => void;
}) {
  const types = useQuery({ queryKey: ["types"], queryFn: api.documentTypes, staleTime: Infinity });
  const typeList = types.data ?? ["invoice", "lease", "market_report"];
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [type, setType] = useState("invoice");
  const [title, setTitle] = useState("");

  // reset whenever the dialog opens (possibly with a dropped file)
  useEffect(() => {
    if (!open) return;
    setFile(initialFile);
    setTitle(initialFile ? initialFile.name.replace(/\.pdf$/i, "") : "");
    setType(initialFile ? guessType(initialFile.name, typeList) : "invoice");
  }, [open, initialFile]);

  const pick = (f: File) => {
    setFile(f);
    setTitle((t) => t || f.name.replace(/\.pdf$/i, ""));
    setType(guessType(f.name, typeList));
  };

  const { getRootProps, getInputProps, isDragActive, open: browse } = useDropzone({
    accept: PDF_ACCEPT,
    maxSize: MAX_PDF_BYTES,
    maxFiles: 1,
    multiple: false,
    noClick: !!file,
    onDropAccepted: ([f]) => f && pick(f),
    onDropRejected: (r) => toast.error(rejectionMessage(r)),
  });

  const upload = useMutation({ mutationFn: api.upload });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const promise = upload.mutateAsync({ type, title: title.trim() || file.name.replace(/\.pdf$/i, ""), file });
    toast.promise(promise, {
      loading: `Uploading ${file.name}…`,
      success: "Uploaded. Extraction has started.",
      error: (err: Error) => err.message,
    });
    try {
      const doc = await promise;
      onOpenChange(false);
      onUploaded(doc);
    } catch {
      /* toast shows the error; keep the dialog open */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal">{initialFile ? "Start a new document?" : "Upload document"}</DialogTitle>
            <DialogDescription>
              The PDF is stored right away and extracted in the background. Every value comes back with the passage it
              was read from, for you to approve or correct.
            </DialogDescription>
          </DialogHeader>

          <div
            {...getRootProps({
              className: cn(
                "flex min-h-36 flex-col items-center justify-center gap-2 border border-dashed px-6 py-8 text-center transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring",
                isDragActive ? "border-foreground bg-accent" : "border-border bg-card",
                !file && "cursor-pointer hover:bg-accent",
              ),
            })}
          >
            <input {...getInputProps()} aria-label="PDF file" />
            {file ? (
              <div className="flex w-full items-center gap-3 text-left">
                <div className="flex size-10 shrink-0 items-center justify-center border bg-background">
                  <FileText className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">PDF · {prettySize(file.size)}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={browse}>
                  Replace
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove file" onClick={() => setFile(undefined)}>
                  <X />
                </Button>
              </div>
            ) : (
              <>
                <UploadCloud className="size-6 text-muted-foreground" />
                <p className="font-medium">{isDragActive ? "Drop it" : "Drop a PDF here, or click to browse"}</p>
                <p className="text-xs text-muted-foreground">One PDF, up to 20 MB</p>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
            <div className="grid gap-2">
              <Label htmlFor="doc-type">Document type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="doc-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeList.map((t) => (
                    <SelectItem key={t} value={t}>
                      {typeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="doc-title">Title</Label>
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Invoice — Meridian" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? "Uploading…" : "Upload and extract"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
