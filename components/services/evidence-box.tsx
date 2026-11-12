// @plantilla-quitar(servicios)
"use client";

/**
 * La evidencia de un paso (Servicios A4, F147): la lista y «Adjuntar evidencia» (una captura o un PDF, un link o una
 * nota). La usan la ficha del servicio y el panel de la tarea. Lo valida y lo guarda el servidor; quitar se puede solo
 * lo propio y con el paso pendiente (la base lo vuelve a mirar).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Link2, Loader2, Paperclip, StickyNote, X } from "lucide-react";
import { addItemEvidence, evidenceFileUrl, removeItemEvidence } from "@/lib/actions/service-evidence";
import { EVIDENCE_KIND_LABEL, canRemoveEvidence, type EvidenceEntry, type EvidenceKind, type EvidenceRule } from "@/lib/services/evidence";
import { cn } from "@/lib/utils";

const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";
const KIND_ICON: Record<EvidenceKind, typeof FileText> = { file: FileText, link: Link2, note: StickyNote };

export function EvidenceBox({
  itemId,
  entries,
  rule,
  itemStatus,
  viewerId,
  canAdd,
  missing,
}: {
  itemId: string;
  entries: EvidenceEntry[];
  rule: EvidenceRule | null;
  itemStatus: string;
  viewerId: string | null;
  canAdd: boolean;
  missing: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EvidenceKind | null>(null);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const kinds: EvidenceKind[] = rule?.kinds ?? ["file", "link", "note"];
  const open = itemStatus === "pending" && canAdd;
  if (entries.length === 0 && !rule && !open) return null;

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const res = await addItemEvidence(itemId, form);
      if (!res.ok) return setError(res.error.message);
      setMode(null);
      setText("");
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const res = await removeItemEvidence(itemId, id);
      if (!res.ok) return setError(res.error.message);
      router.refresh();
    });
  }

  function openFile(id: string) {
    start(async () => {
      const res = await evidenceFileUrl(itemId, id);
      if (!res.ok) return setError(res.error.message);
      window.open(res.data, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <section className="space-y-2" aria-label="Evidencia">
      <p className="text-xs font-semibold text-muted-foreground">
        Evidencia
        {rule && <span className="font-normal"> · pide {rule.kinds.map((k) => EVIDENCE_KIND_LABEL[k]).join(", ")}</span>}
      </p>
      {missing && <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs">Falta la evidencia: sin ella el paso no se puede completar.</p>}
      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map((e) => {
            const Icon = KIND_ICON[e.kind];
            return (
              <li key={e.id} className="flex items-start gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 break-words">
                  {e.kind === "file" ? (
                    <button type="button" onClick={() => openFile(e.id)} className="inline-flex items-center gap-1 text-primary-ink hover:underline">
                      Ver el archivo <ExternalLink className="h-3 w-3" aria-hidden />
                    </button>
                  ) : e.kind === "link" ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">
                      {e.url}
                    </a>
                  ) : (
                    <span className="whitespace-pre-wrap">{e.text}</span>
                  )}
                </span>
                {viewerId && canRemoveEvidence(e, viewerId, itemStatus) && (
                  <button type="button" disabled={pending} onClick={() => remove(e.id)} aria-label="Quitar esta evidencia" className="rounded p-1 text-muted-foreground hover:bg-accent">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setMode(k);
                  setText("");
                  if (k === "file") fileRef.current?.click();
                }}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-accent", mode === k && "bg-accent")}
              >
                {k === "file" ? <Paperclip className="h-3.5 w-3.5" aria-hidden /> : k === "link" ? <Link2 className="h-3.5 w-3.5" aria-hidden /> : <StickyNote className="h-3.5 w-3.5" aria-hidden />}
                {k === "file" ? "Adjuntar archivo" : k === "link" ? "Pegar un link" : "Escribir una nota"}
              </button>
            ))}
            {pending && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-hidden />}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="sr-only"
            aria-label="Elegí una captura o un PDF"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const form = new FormData();
              form.set("kind", "file");
              form.set("file", f);
              submit(form);
            }}
          />
          {(mode === "link" || mode === "note") && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData();
                form.set("kind", mode);
                form.set(mode === "link" ? "url" : "text", text);
                submit(form);
              }}
            >
              {mode === "link" ? (
                <input aria-label="Link" placeholder="https://…" value={text} onChange={(e) => setText(e.target.value)} className={input} />
              ) : (
                <textarea aria-label="Nota" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode(null)} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                  Cancelar
                </button>
                <button type="submit" disabled={pending || !text.trim()} className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  Adjuntar
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
