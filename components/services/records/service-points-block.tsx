"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { adjustPoints, loadPointsDaily, type PointsDaily } from "@/lib/actions/points";
import { dailyActivityView, historyLabel } from "@/lib/portal-points/daily";

/** Un color fijo por grupo (F130.4), el mismo en las dos fichas y en la leyenda. */
export const GROUP_COLORS: Record<string, string> = {
  cont: "bg-sky-500",
  act: "bg-violet-500",
  camino: "bg-emerald-500",
  clases: "bg-amber-500",
  com: "bg-pink-500",
  proy: "bg-teal-600",
  ref: "bg-orange-600",
  equipo: "bg-slate-500",
};

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/**
 * «Actividad en el portal» (F130.4): una barra por día (14, 30 o 90) apilada por grupo de puntos; los días que no entró
 * con fondo rayado y una tira debajo (verde = entró). Arriba: última vez que entró, días que entró de N, puntos del
 * período y por día, total y nivel. Cada barra es un botón con su texto (tooltip y lector de pantalla).
 */
export function PortalActivityChart({ serviceId, initial }: { serviceId: string; initial: PointsDaily }) {
  const [data, setData] = useState(initial);
  const [focus, setFocus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const v = dailyActivityView(data.days);

  const switchDays = (n: 14 | 30 | 90) =>
    start(async () => {
      setError(null);
      const res = await loadPointsDaily(serviceId, n);
      if (res.ok && res.data) setData(res.data);
      else setError(res.ok ? "No se pudo leer" : res.error.message);
    });

  const shown = focus !== null ? v.bars[focus] : null;
  return (
    <section aria-labelledby="record-actividad" className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 id="record-actividad" className="text-sm font-semibold">
          Actividad en el portal
        </h3>
        <div role="group" aria-label="Período" className="ml-auto flex rounded-lg bg-muted/60 p-0.5 text-xs">
          {([14, 30, 90] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={data.days_n === n}
              disabled={pending}
              onClick={() => switchDays(n)}
              className={cn("min-h-8 rounded-md px-2.5", data.days_n === n ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
            >
              {n} días
            </button>
          ))}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Última vez que entró</dt>
          <dd>{data.last_active ? fmtDay(data.last_active) : "Todavía no entró"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Días que entró</dt>
          <dd>
            {v.activeDays} de {v.totalDays}
          </dd>
        </div>
        {data.enabled && (
          <>
            <div>
              <dt className="text-xs text-muted-foreground">Puntos del período</dt>
              <dd>
                {v.periodPoints} <span className="text-xs text-muted-foreground">· {v.perDay.toLocaleString("es")} por día</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd>
                {data.total} <span className="text-xs text-muted-foreground">· nivel {data.level.level}, {data.level.name}</span>
              </dd>
            </div>
          </>
        )}
      </dl>

      <div className="space-y-1">
        <div className="flex h-28 items-end gap-px" role="list" aria-label="Puntos por día">
          {v.bars.map((b, i) => (
            <button
              key={b.day}
              type="button"
              role="listitem"
              aria-label={b.text}
              title={b.text}
              onMouseEnter={() => setFocus(i)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              className={cn(
                "flex h-full min-w-0 flex-1 flex-col-reverse rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                !b.active && "bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-muted)_3px_5px)]",
              )}
            >
              {b.segments.map((s) => (
                <span key={s.group} className={cn("block w-full", GROUP_COLORS[s.group] ?? "bg-slate-400")} style={{ height: `${Math.max(s.share * 100, 2)}%` }} aria-hidden />
              ))}
            </button>
          ))}
        </div>
        <div className="flex gap-px" aria-hidden>
          {v.bars.map((b) => (
            <span key={b.day} className={cn("h-1.5 flex-1 rounded-[1px]", b.active ? "bg-good" : "bg-muted")} />
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
          <span>{v.bars[0] ? fmtDay(v.bars[0].day) : ""}</span>
          <span>{v.bars.length ? fmtDay(v.bars[v.bars.length - 1].day) : ""}</span>
        </div>
      </div>

      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {shown ? shown.text : !data.enabled ? "Los puntos están apagados en este programa: el gráfico muestra solo los días que entró." : v.max === 0 ? "Sin puntos en el período." : "Pasá o enfocá una barra para ver el detalle."}
      </p>

      {v.legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Leyenda">
          {v.legend.map((l) => (
            <li key={l.group} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm", GROUP_COLORS[l.group] ?? "bg-slate-400")} aria-hidden />
              {l.label} <span className="tabular-nums text-muted-foreground">{l.points}</span>
            </li>
          ))}
          {v.negativeTotal < 0 && <li className="text-muted-foreground">Descuentos y ajustes {v.negativeTotal}</li>}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export interface PointsHistoryRow {
  id: string;
  at: string;
  day: string;
  group: string;
  points: number;
  reason: string | null;
  kind: string;
  by: string | null;
}

/** El plegable «Historial de puntos» con «Sumar o restar puntos» (motivo obligatorio, permiso `portal.points`). */
export function ServicePointsHistory({
  serviceId,
  rows,
  enabled,
  canAdjust,
  userNames,
}: {
  serviceId: string;
  rows: PointsHistoryRow[];
  enabled: boolean;
  canAdjust: boolean;
  userNames: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return setMsg({ kind: "error", text: "Elegí cuántos puntos." });
    if (!reason.trim()) return setMsg({ kind: "error", text: "Contá el motivo." });
    start(async () => {
      const res = await adjustPoints(serviceId, sign * n, reason);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: "ok", text: `Listo. Total: ${res.data}.` });
      setAmount("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <section id="record-puntos" className="rounded-xl border border-border">
      <h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm">
          <span className="font-semibold">Historial de puntos</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">De dónde salió cada punto</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h3>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {canAdjust && enabled && (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm" aria-label="Sumar o restar puntos">
              <label className="text-xs text-muted-foreground">
                <span className="block">Sumar o restar</span>
                <select value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)} className="mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm">
                  <option value={1}>Sumar</option>
                  <option value={-1}>Restar</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                <span className="block">Puntos</span>
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 h-9 w-24 rounded-md border border-border bg-background px-2 text-right text-sm" />
              </label>
              <label className="min-w-[12rem] flex-1 text-xs text-muted-foreground">
                <span className="block">Motivo</span>
                <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
              </label>
              <button type="submit" disabled={pending} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </form>
          )}
          {canAdjust && !enabled && <p className="text-xs text-muted-foreground">Los puntos están apagados en este programa: no se pueden sumar ni restar.</p>}
          {msg && (
            <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {msg.text}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no tiene puntos en este programa.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-2">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", GROUP_COLORS[r.group] ?? "bg-slate-400")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block">{historyLabel(r.kind, r.points)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDay(r.day)}
                      {r.reason ? ` · ${r.reason}` : ""}
                      {r.by && userNames[r.by] ? ` · ${userNames[r.by]}` : ""}
                    </span>
                  </span>
                  <span className={cn("tabular-nums font-medium", r.points < 0 ? "text-bad" : "text-foreground")}>
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
