"use client";

/**
 * «Alerta si un número deja de entregar»: con envíos esperando y ninguno entregado durante estos minutos (dentro del
 * horario y con cupo), la cola del número se pausa y Owner y Admin reciben el aviso. Los 3 a 5 fallos seguidos que ya
 * pausaban el número siguen igual (se cambian en el ritmo de cada número).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveLaneAlert } from "@/lib/actions/send-queue";
import type { LaneAlertSettings } from "@/lib/send-queue/automation/lane-alert";

export function LaneAlertCard({ settings }: { settings: LaneAlertSettings }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(String(settings.stalledMinutes));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setMsg(null);
      const res = await saveLaneAlert(minutes);
      setMsg(res.ok ? { ok: true, text: "Guardado." } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <section aria-labelledby="alerta-numero" className="rounded-xl border border-border bg-card p-4">
      <h2 id="alerta-numero" className="text-sm font-semibold">
        Alerta si un número deja de entregar
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Si un número tiene envíos esperando y no entrega ninguno durante estos minutos, se pausa su cola (y sus broadcasts) y avisamos a Owner y Admin en la
        campana. Los mensajes siguen guardados y salen al reanudar. Fuera del horario de envío o con el cupo lleno no cuenta.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Minutos sin entregar</span>
          <input
            type="number"
            min={5}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          Guardar
        </button>
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "pb-1.5 text-xs text-muted-foreground" : "pb-1.5 text-xs text-destructive"}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
