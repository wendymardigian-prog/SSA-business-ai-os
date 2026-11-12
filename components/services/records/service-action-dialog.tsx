// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cancelService, completeService, discardService, extendService, moveServiceToPhase, pauseService } from "@/lib/actions/services";
import { ACTION_LABELS, type ServiceActionKey } from "@/lib/services/screens/service";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";

/**
 * Las acciones del servicio que piden datos y motivo (pausar, extender, completar, cancelar, descartar, cambiar de
 * fase). Se abren ENCIMA de la ficha: Esc cierra primero este dialogo.
 */
export function ServiceActionDialog({ action, serviceId, phases, onClose }: { action: ServiceActionKey; serviceId: string; phases: Array<{ id: string; name: string }>; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [n, setN] = useState("7");
  const [unit, setUnit] = useState<"days" | "months">("days");
  const [cutAccess, setCutAccess] = useState(true);
  const [resumeOn, setResumeOn] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      let r: { ok: boolean; error?: { message: string } };
      switch (action) {
        case "pause":
          r = await pauseService(serviceId, { reason, cutAccess, resumeOn: resumeOn || null });
          break;
        case "extend":
          r = await extendService(serviceId, { mode: "period", n: Number(n), unit, kind: "bonus", reason });
          break;
        case "complete":
          r = await completeService(serviceId, reason);
          break;
        case "cancel":
          r = await cancelService(serviceId, reason);
          break;
        case "discard":
          r = await discardService(serviceId, reason);
          break;
        case "change_phase":
          r = await moveServiceToPhase(serviceId, phaseId, reason);
          break;
        default:
          r = { ok: true };
      }
      if (!r.ok) return setError(r.error?.message ?? "No se pudo hacer");
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      title={ACTION_LABELS[action]}
      label={ACTION_LABELS[action]}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-border px-3 text-sm hover:bg-accent sm:h-9">
            Volver
          </button>
          <button
            type="button"
            disabled={pending || !reason.trim() || (action === "change_phase" && !phaseId)}
            onClick={submit}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:h-9"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {ACTION_LABELS[action].replace("…", "")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {action === "extend" && (
          <div className="grid grid-cols-2 gap-2">
            <DialogField label="Cuánto">
              <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} className={fieldInput} />
            </DialogField>
            <DialogField label="Unidad">
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className={fieldInput}>
                <option value="days">días</option>
                <option value="months">meses</option>
              </select>
            </DialogField>
          </div>
        )}
        {action === "pause" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cutAccess} onChange={(e) => setCutAccess(e.target.checked)} />
              Pausar también el acceso al portal
            </label>
            <DialogField label="Reanudar sola el (opcional)">
              <input type="date" value={resumeOn} onChange={(e) => setResumeOn(e.target.value)} className={fieldInput} />
            </DialogField>
          </>
        )}
        {action === "change_phase" && (
          <DialogField label="A qué fase">
            <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} className={fieldInput}>
              <option value="">Elegí…</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </DialogField>
        )}
        <DialogField label="Motivo" hint="Queda en el historial del servicio.">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={fieldInput} />
        </DialogField>
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
