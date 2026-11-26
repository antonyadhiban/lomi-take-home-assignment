"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileStack } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { UploadDialog } from "@/components/app/upload-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const PDF_ACCEPT = { "application/pdf": [".pdf"] };

/** A page that accepts drops as "new version of this document" registers itself here. */
export interface VersionTarget {
  documentId: string;
  title: string;
  nextVersion: number;
}

interface UploadContextValue {
  openNewDocument: (file?: File) => void;
  uploadNewVersion: (target: VersionTarget, file: File) => void;
  setVersionTarget: (t: VersionTarget | null) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside <UploadProvider>");
  return ctx;
}

/** Registers the current page as the drop target for new versions while it is mounted. */
export function useVersionDropTarget(target: VersionTarget | null) {
  const { setVersionTarget } = useUpload();
  const key = target ? `${target.documentId}:${target.nextVersion}:${target.title}` : "";
  useEffect(() => {
    setVersionTarget(target);
    return () => setVersionTarget(null);
  }, [key, setVersionTarget]);
}

export function rejectionMessage(rejections: FileRejection[]) {
  const code = rejections[0]?.errors[0]?.code;
  if (code === "file-too-large") return "That PDF is larger than 20 MB.";
  if (code === "file-invalid-type") return "Only PDF files can be reviewed.";
  if (code === "too-many-files") return "Drop one PDF at a time.";
  return "That file can't be uploaded.";
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<{ open: boolean; file?: File }>({ open: false });
  const [versionTarget, setVersionTarget] = useState<VersionTarget | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ file: File; target: VersionTarget } | null>(null);

  const versionMutation = useMutation({
    mutationFn: ({ target, file }: { target: VersionTarget; file: File }) => api.uploadVersion(target.documentId, file),
  });

  const uploadNewVersion = useCallback(
    (target: VersionTarget, file: File) => {
      const promise = versionMutation.mutateAsync({ target, file }).then((res) => {
        qc.setQueryData(["document", target.documentId, null], res);
        qc.invalidateQueries({ queryKey: ["document", target.documentId] });
        qc.invalidateQueries({ queryKey: ["documents"] });
        return res;
      });
      toast.promise(promise, {
        loading: `Uploading ${file.name} as v${target.nextVersion}…`,
        success: (res) =>
          res.duplicate
            ? `Identical to v${res.currentVersion}. Nothing to re-extract.`
            : `v${res.currentVersion} uploaded. Extracting, unchanged reviews will carry over.`,
        error: (e: Error) => e.message,
      });
    },
    [qc, versionMutation],
  );

  const openNewDocument = useCallback((file?: File) => setDialog({ open: true, file }), []);

  // App-wide drop zone (Midday-style full-cover overlay while dragging).
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: PDF_ACCEPT,
    maxSize: MAX_PDF_BYTES,
    maxFiles: 1,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    // the upload dialog has its own drop area; don't double-handle drops into it
    disabled: dialog.open,
    onDropAccepted: ([file]) => {
      if (!file) return;
      if (versionTarget) setPendingDrop({ file, target: versionTarget });
      else openNewDocument(file);
    },
    onDropRejected: (r) => toast.error(rejectionMessage(r)),
  });

  const value = useMemo(
    () => ({ openNewDocument, uploadNewVersion, setVersionTarget }),
    [openNewDocument, uploadNewVersion],
  );

  return (
    <UploadContext.Provider value={value}>
      <div {...getRootProps({ className: "relative min-h-svh outline-none" })}>
        <input {...getInputProps()} />
        {children}
        {isDragActive && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-[2px] animate-in fade-in-0">
            <div className="flex w-[min(28rem,90vw)] flex-col items-center gap-3 border border-dashed border-foreground/30 bg-card px-8 py-10 text-center">
              {versionTarget ? <FileStack className="size-6 text-muted-foreground" /> : <FilePlus2 className="size-6 text-muted-foreground" />}
              <p className="font-serif text-xl">
                {versionTarget ? `New version of ${versionTarget.title}` : "Start a new document"}
              </p>
              <p className="text-xs text-muted-foreground">
                {versionTarget
                  ? `Drop the revised PDF to upload it as v${versionTarget.nextVersion}. Reviews whose evidence is unchanged carry over.`
                  : "Drop a PDF anywhere to upload it for extraction and review."}
              </p>
            </div>
          </div>
        )}
      </div>

      <UploadDialog
        open={dialog.open}
        initialFile={dialog.file}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onUploaded={(doc) => {
          qc.setQueryData(["document", doc.id, null], doc);
          qc.invalidateQueries({ queryKey: ["documents"] });
          router.push(`/documents/${doc.id}`);
        }}
      />

      <AlertDialog open={!!pendingDrop} onOpenChange={(o) => !o && setPendingDrop(null)}>
        <AlertDialogContent className="data-[size=default]:max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal break-words">
              Upload as v{pendingDrop?.target.nextVersion} of {pendingDrop?.target.title}?
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              <span className="font-medium break-all text-foreground">{pendingDrop?.file.name}</span> will be extracted as a new
              version. Values whose evidence didn&apos;t change keep their review; changed values come back for review with
              the previous version beside them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                const f = pendingDrop?.file;
                setPendingDrop(null);
                if (f) openNewDocument(f);
              }}
            >
              Start a new document instead
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingDrop) uploadNewVersion(pendingDrop.target, pendingDrop.file);
                  setPendingDrop(null);
                }}
              >
                Upload new version
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UploadContext.Provider>
  );
}
