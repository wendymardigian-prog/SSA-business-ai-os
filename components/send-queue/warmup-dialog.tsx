"use client";

/**
 * El calentamiento de un número: una escalera de tramos («N días al X % del cupo»). Mientras calienta, el cupo de la hora
 * y del día del número (cola y broadcasts) baja a ese porcentaje. «Volver a calentar» arranca la escalera desde hoy: sirve
 * después de una restricción de WhatsApp o al reconectar un número que estuvo parado.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { ContentDialog } from "@/components/content/dialog";
import { saveWarmup } from "@/lib/actions/send-queue";
import type { WarmupStep } from "@/lib/send-queue/automation/policy";

const field = "h-8 w-20 rounded-md border border-input bg-background px-2 text-sm";

export function WarmupDialog({ channelId, name, steps, warming, onClose }: { channelId: string; name: string; steps: WarmupStep[]; warming: boolean; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => (steps.length ? steps : [{ days: 7, factor: 0.5 }]).map((s) => ({ days: String(s.days), pct: String(Math.round(s.factor * 100)) })));
  const [restart, setRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveWarmup(channelId, { steps: rows.map((r) => ({ days: Number(r.days), pct: Number(r.pct) })), restart });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });

  const totalDays = rows.reduce((n, r) => n + (Number(r.days) || 0), 0);

  return (
    <ContentDialog
      title={`Calentamiento · ${name}`}
      label={`Calentamiento de ${name}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || rows.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Guardar
          </button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">
        Mientras el número calienta, su cupo de la hora y del día (automatizaciones y broadcasts) baja al porcentaje del tramo. Arranca cuando se conectó el número o
        cuando tocás «volver a calentar».
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Días</span>
              <input type="number" min={1} max={60} value={r.days} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, days: e.target.value } : x)))} className={field} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">% del cupo</span>
              <input type="number" min={10} max={100} value={r.pct} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className={field} />
            </label>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              aria-label={`Quitar el tramo ${i + 1}`}
              className="mb-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {rows.length < 10 && (
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { days: "7", pct: "75" }])}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline"
        >
          <Plus className="h-4 w-4" aria-hidden /> Sumar un tramo
        </button>
      )}
      <p className="mt-2 text-xs text-muted-foreground">En total {totalDays} días. Después, el cupo entero.</p>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} className="mt-0.5" />
        <span>
          Volver a calentar desde hoy
          <span className="block text-xs text-muted-foreground">
            {warming ? "El número ya está calentando: esto reinicia la escalera." : "Por ejemplo, después de una restricción de WhatsApp."}
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </ContentDialog>
  );
}
