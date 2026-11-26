"use client";

/**
 * Adjuntar archivos a un comentario (ficha del cliente y tareas) y la lista de los ya adjuntos. Los archivos se suben
 * DESPUÉS de guardar el comentario, de a uno (cada uno hasta 25 MB): si uno falla, el comentario ya quedó y se avisa
 * cuál no se adjuntó. Cada archivo se abre con un enlace de 5 minutos que firma el servidor.
 */
import { useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { attachCommentFile, attachNoteFile, recordAttachmentUrl } from "@/lib/actions/record-attachments";
import { RECORD_ATTACHMENT_ACCEPT, RECORD_ATTACHMENTS_MAX, pickRecordFiles, type RecordAttachmentView } from "@/lib/attachments/record-files";
import { Tip } from "@/components/ui/tooltip";

export type AttachmentKind = "note" | "comment";

/** Sube los archivos elegidos a la nota o al comentario recién guardado. Devuelve los que no se pudieron adjuntar. */
export async function uploadRecordFiles(kind: AttachmentKind, parentId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    const form = new FormData();
    form.set(kind === "note" ? "noteId" : "commentId", parentId);
    form.set("file", f);
    const action = kind === "note" ? attachNoteFile : attachCommentFile;
    const r = await action(form).catch(() => ({ ok: false as const, error: "No pude subir el archivo." }));
    if (!r.ok) failed.push(`${f.name}: ${r.error}`);
  }
  return failed;
}

/** El clip y los archivos elegidos (todavía sin subir). Controlado: `files` y `onChange` los maneja quien lo usa. */
export function AttachmentPicker({ files, onChange, onError, disabled }: { files: File[]; onChange: (files: File[]) => void; onError: (message: string | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept={RECORD_ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const picked = pickRecordFiles([...files, ...Array.from(e.target.files ?? [])]);
          onChange(picked.ok);
          onError(picked.error);
          e.target.value = "";
        }}
      />
      <Tip content={`Adjuntar archivos (hasta ${RECORD_ATTACHMENTS_MAX})`}>
        <button
          type="button"
          aria-label="Adjuntar archivos"
          disabled={disabled || files.length >= RECORD_ATTACHMENTS_MAX}
          onClick={() => ref.current?.click()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 md:h-8 md:w-8"
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </button>
      </Tip>
    </>
  );
}

/** Los archivos elegidos como chips con su «Quitar». */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Archivos para adjuntar">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs">
          <span className="truncate">{f.name}</span>
          <button
            type="button"
            aria-label={`Quitar ${f.name}`}
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            className="inline-flex h-10 w-10 items-center justify-center rounded text-muted-foreground hover:bg-accent md:h-6 md:w-6"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Los archivos ya adjuntos: cada uno se abre en otra pestaña con un enlace de 5 minutos. */
export function AttachmentList({ kind, items }: { kind: AttachmentKind; items: RecordAttachmentView[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  async function open(id: string) {
    setError(null);
    setBusy(id);
    const r = await recordAttachmentUrl(kind, id).catch(() => ({ ok: false as const, error: "No pude abrir el archivo. Probá de nuevo." }));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    window.open(r.url, "_blank", "noopener,noreferrer");
  }
  return (
    <div className="mt-1">
      <ul className="flex flex-wrap gap-1.5" aria-label="Archivos adjuntos">
        {items.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => open(a.id)}
              disabled={busy === a.id}
              className="inline-flex min-h-10 max-w-[16rem] items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground hover:bg-accent disabled:opacity-60 md:min-h-7"
            >
              {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              <span className="truncate">{a.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
