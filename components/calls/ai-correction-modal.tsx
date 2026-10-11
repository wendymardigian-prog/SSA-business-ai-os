"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Quote, Sparkles } from "lucide-react";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { proposeSectionCorrection, saveCallSections, type CorrectionView } from "@/lib/actions/calls-edit";
import { SECTION_LABELS, type AnalysisSection } from "@/lib/calls/scoring";
import { describeSectionValue } from "@/lib/calls/section-forms";
import { CORRECTION_MAX_INSTRUCTION, CORRECTION_MIN_INSTRUCTION } from "@/lib/calls/correction-limits";

/**
 * Pedirle a la IA que revise una seccion (F24). La propuesta se ve antes y
 * despues, con la cita que la respalda; no se guarda nada hasta apretar
 * "Aceptar". Si se cierra la ventana a mitad de camino, no se aplico nada. Los
 * puntajes no los cambia el pedido: los calcula el sistema.
 */
export function AiCorrectionModal({ callId, section, onClose }: { callId: string; section: AnalysisSection; onClose: () => void }) {
  const router = useRouter();
  const [pedido, setPedido] = useState("");
  const [result, setResult] = useState<CorrectionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const valid = pedido.trim().length >= CORRECTION_MIN_INSTRUCTION && pedido.trim().length <= CORRECTION_MAX_INSTRUCTION;

  function ask() {
    setError(null);
    setResult(null);
    start(async () => setResult(await proposeSectionCorrection({ callId, section, pedido })));
  }

  function accept() {
    if (!result || result.status !== "propuesta") return;
    setError(null);
    start(async () => {
      const saved = await saveCallSections({
        callId,
        origin: "ai_correction",
        request: pedido,
        edits: [{ section: result.section, value: result.after }, ...result.dependents.map((d) => ({ section: d.section, value: d.after }))],
      });
      if (!saved.ok) return setError(saved.error);
      router.refresh();
      onClose();
    });
  }

  const proposal = result?.status === "propuesta" ? result : null;

  return (
    <ContentDialog
      title={`Revisar con IA: ${SECTION_LABELS[section]}`}
      label={`Revisar con IA ${SECTION_LABELS[section]}`}
      onClose={onClose}
      footer={
        proposal ? (
          <>
            <button type="button" onClick={accept} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Guardando…" : "Aceptar"}</button>
            <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Descartar</button>
            {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
          </>
        ) : (
          <>
            <button type="button" onClick={ask} disabled={pending || !valid} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              <Sparkles className="h-4 w-4" aria-hidden /> {pending ? "Revisando…" : "Pedir revisión"}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Cancelar</button>
          </>
        )
      }
    >
      {!proposal && (
        <>
          <p className="text-xs text-muted-foreground">Contá qué está mal. La IA solo cambia algo si la transcripción lo respalda, y no mueve puntajes porque se lo pidas.</p>
          <DialogField label="¿Qué está mal en esta sección?" hint={`${pedido.trim().length} de ${CORRECTION_MAX_INSTRUCTION} caracteres (mínimo ${CORRECTION_MIN_INSTRUCTION})`}>
            <textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={4} maxLength={CORRECTION_MAX_INSTRUCTION} className={`${fieldInput} resize-y`} />
          </DialogField>
        </>
      )}

      {result?.status === "rechazada" && (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">La IA no cambió nada</p>
          <p className="text-muted-foreground">{result.reason}</p>
          {result.quote && <p className="mt-1 flex gap-1 italic text-muted-foreground"><Quote className="mt-1 h-3 w-3 shrink-0" aria-hidden />{result.quote}</p>}
        </div>
      )}
      {result?.status === "error" && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{result.error}</p>
      )}

      {proposal && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Compare title="Ahora" text={describeSectionValue(proposal.section, proposal.before)} />
            <Compare title="Propuesta" text={describeSectionValue(proposal.section, proposal.after)} highlight />
          </div>
          {proposal.quote && <p className="flex gap-1 text-sm italic text-muted-foreground"><Quote className="mt-1 h-3 w-3 shrink-0" aria-hidden />{proposal.quote}</p>}
          {proposal.dependents.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold">También cambia, para no contradecirse</h3>
              <ul className="mt-1 space-y-2">
                {proposal.dependents.map((d) => (
                  <li key={d.section} className="rounded-lg border border-border p-2 text-xs">
                    <p className="font-medium">{SECTION_LABELS[d.section]}{d.reason ? <span className="font-normal text-muted-foreground"> · {d.reason}</span> : null}</p>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      <Compare title="Ahora" text={describeSectionValue(d.section, d.before)} small />
                      <Compare title="Propuesta" text={describeSectionValue(d.section, d.after)} highlight small />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Al aceptar, queda en el historial como “corregido con IA”, con tu pedido.</p>
        </div>
      )}
    </ContentDialog>
  );
}

function Compare({ title, text, highlight = false, small = false }: { title: string; text: string; highlight?: boolean; small?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`}>
      <p className="text-[11px] font-semibold text-muted-foreground">{title}</p>
      <p className={`mt-1 whitespace-pre-line ${small ? "text-xs" : "text-sm"}`}>{text}</p>
    </div>
  );
}
