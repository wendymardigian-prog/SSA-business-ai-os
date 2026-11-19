"use client";

/**
 * «Tope por contacto y día» en la pantalla de la cola: cuántos WhatsApp automáticos por la cola puede recibir un contacto
 * (y, aparte, un grupo) al día, sumando todas las automatizaciones y todos los números. Viene APAGADO (decisión del
 * 18/11/2026). Lo que sale al instante (respuestas a quien escribió, avisos de agenda) no cuenta. Vacío = sin tope.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveContactCap } from "@/lib/actions/send-queue";
import type { ContactCapPolicy } from "@/lib/send-queue/automation/contact-cap";

const field = "h-8 w-20 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50";

const toInput = (v: number | null) => (v === null ? "" : String(v));
const fromInput = (v: string) => (v.trim() === "" ? null : Number(v.trim()));

export function ContactCapCard({ cap }: { cap: ContactCapPolicy }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(cap.enabled);
  const [perContact, setPerContact] = useState(toInput(cap.perContactDay));
  const [perGroup, setPerGroup] = useState(toInput(cap.perGroupDay));
  const [urgentCounts, setUrgentCounts] = useState(cap.urgentCounts);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setMsg(null);
      const res = await saveContactCap({ enabled, perContactDay: fromInput(perContact), perGroupDay: fromInput(perGroup), urgentCounts });
      setMsg(res.ok ? { ok: true, text: "Guardado." } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <section aria-labelledby="tope-contacto" className="rounded-xl border border-border bg-card p-4">
      <h2 id="tope-contacto" className="text-sm font-semibold">
        Tope por contacto y día
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Cuántos WhatsApp automáticos de la cola puede recibir una misma persona (o un grupo) en el día, sumando todas las automatizaciones y todos los números.
        Lo que pasa del tope queda «Descartado por tope» y no se manda. Lo que sale al instante no cuenta. Vacío = sin tope.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Prender el tope
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Por contacto</span>
          <input type="number" min={1} max={50} value={perContact} disabled={!enabled} onChange={(e) => setPerContact(e.target.value)} className={field} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Por grupo</span>
          <input type="number" min={1} max={50} value={perGroup} disabled={!enabled} onChange={(e) => setPerGroup(e.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-xs">
          <input type="checkbox" checked={urgentCounts} disabled={!enabled} onChange={(e) => setUrgentCounts(e.target.checked)} />
          Lo urgente también cuenta
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
