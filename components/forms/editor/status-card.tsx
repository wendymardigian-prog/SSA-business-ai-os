"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Notice } from "@/components/agents/fields";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { setFormStatus } from "@/lib/actions/forms/forms";
import { FORM_STATUS_LABELS, type FormStatus } from "@/lib/forms/fields";
import { canTransition } from "@/lib/forms/list";

/**
 * "Estado" (plano formularios-ui, F14): en que estado esta el formulario y las acciones para cambiarlo: Pausar,
 * Reanudar, Archivar y Restaurar (las mismas que el menu "⋯" de la lista, con las mismas reglas: `setFormStatus`).
 * Publicar sigue siendo el boton de la barra de arriba.
 */
const EXPLAIN: Record<FormStatus, string> = {
  draft: "Todavía no está publicado: el link no recibe respuestas.",
  published: "Recibe respuestas en su link.",
  paused: "Pausado: el link no recibe respuestas hasta que lo reanudes.",
  archived: "Archivado: no recibe respuestas ni se puede editar. Las respuestas ya recibidas se conservan.",
};

export function StatusCard({ formId, formName, status, canManage, onStatus, hasVersion }: { formId: string; formName: string; status: FormStatus; canManage: boolean; onStatus: (next: FormStatus) => void; hasVersion: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  function change(to: FormStatus, done: string) {
    setMessage(null);
    start(async () => {
      const result = await setFormStatus(formId, to);
      if (result.ok) {
        onStatus(to);
        setMessage({ tone: "success", text: done });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  const actions: Array<{ label: string; to: FormStatus; done: string; destructive?: boolean }> = [];
  if (canTransition(status, "paused")) actions.push({ label: "Pausar", to: "paused", done: "Pausado" });
  // Reanudar solo si ya hubo una version publicada (si no, es del boton Publicar).
  if (status === "paused" && hasVersion) actions.push({ label: "Reanudar", to: "published", done: "Reanudado" });
  if (canTransition(status, "archived")) actions.push({ label: "Archivar", to: "archived", done: "Archivado", destructive: true });
  if (canTransition(status, "draft")) actions.push({ label: "Restaurar", to: "draft", done: "Restaurado como borrador" });

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-labelledby="estado">
      <div>
        <h2 id="estado" className="flex items-center gap-2 text-sm font-semibold">
          Estado
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{FORM_STATUS_LABELS[status]}</span>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{EXPLAIN[status]}</p>
      </div>
      {canManage && actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.to}
              type="button"
              disabled={pending}
              onClick={() => (a.to === "archived" ? setConfirmArchive(true) : change(a.to, a.done))}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 ${a.destructive ? "text-destructive" : ""}`}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {message && (
        <div role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title="¿Archivar este formulario?"
        message={`"${formName}" deja de recibir respuestas. Las respuestas ya recibidas se conservan y podés restaurarlo cuando quieras.`}
        confirmLabel="Archivar"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          change("archived", "Archivado");
        }}
      />
    </section>
  );
}
