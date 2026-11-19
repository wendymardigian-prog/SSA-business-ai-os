"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Quote } from "lucide-react";
import { saveCallChurnCause } from "@/lib/actions/calls-edit";
import { activeChurnReasons, churnReasonLabel, readChurnCause, type ChurnReason } from "@/lib/calls/churn";

/**
 * La causa de baja de una reunión de servicio: la que detectó el analizador (con la frase del cliente) o la que puso
 * una persona. Quien puede editar llamadas la cambia o la quita. Sin lista de causas en el negocio, no se muestra.
 */
export function ChurnCauseCard({ callId, analysis, reasons, canEdit }: { callId: string; analysis: unknown; reasons: ChurnReason[]; canEdit: boolean }) {
  const router = useRouter();
  const cause = useMemo(() => readChurnCause(analysis), [analysis]);
  const active = activeChurnReasons(reasons);
  const [editing, setEditing] = useState(false);
  const [clave, setClave] = useState(cause?.clave ?? "");
  const [motivo, setMotivo] = useState(cause?.motivo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (reasons.length === 0 && !cause) return null;

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveCallChurnCause({ callId, clave: clave || null, motivo: motivo.trim() || null });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <section aria-label="Causa de baja" className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Causa de baja</h3>
        {canEdit && !editing && active.length > 0 && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Pencil className="h-3 w-3" aria-hidden /> {cause ? "Cambiar" : "Poner una"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <select aria-label="Causa de baja" value={clave} onChange={(e) => setClave(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Sin causa de baja</option>
            {active.map((r) => (
              <option key={r.clave} value={r.clave}>{r.nombre}</option>
            ))}
          </select>
          {clave && (
            <textarea aria-label="Qué pasa" value={motivo} maxLength={500} rows={2} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué pasa (opcional)" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          )}
          {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted max-sm:w-full">Cancelar</button>
            <button type="button" disabled={pending} onClick={save} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 max-sm:w-full">
              {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        </div>
      ) : cause ? (
        <>
          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/60 dark:text-red-300">{churnReasonLabel(cause.clave, reasons)}</span>
          {cause.motivo && <p className="text-sm">{cause.motivo}</p>}
          {cause.cita && (
            <p className="flex gap-1 text-xs italic text-muted-foreground">
              <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>«{cause.cita}»</span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">{cause.fuente === "manual" ? "La puso una persona." : "La detectó el analizador."}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">El cliente no habló de irse.</p>
      )}
    </section>
  );
}
