"use client";
// @plantilla-quitar(proyectos)

import { useEffect, useState, useTransition } from "react";
import { addStudentPayment, adjustStudentTotal, loadServiceProjects, verifyStudentPayment, type ServiceProjects } from "@/lib/actions/projects";
import { formatCents, parseAmountToCents } from "@/lib/projects/money";

const STATE_LABEL = { verified: "Verificado", pending: "Por verificar", no_receipt: "Sin comprobante" } as const;
const KIND_LABEL = { real: "Real", practice: "Práctica", challenge: "Reto" } as const;
const STATUS_LABEL: Record<string, string> = { draft: "Borrador", proposal_sent: "Propuesta enviada", won: "Ganado", in_build: "En construcción", delivered: "Entregado", lost: "Perdido" };
const field = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";
const btn = "rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50";

/**
 * Ficha del servicio › Proyectos e ingresos (Corrida C, F79): los proyectos del estudiante (solo lectura, para preparar
 * el hot seat) y sus pagos. Con `student_revenue.manage`: cargar un pago, verificar y ajustar el total. Con la extensión
 * apagada no se dibuja nada.
 */
export function ServiceProjectsSection({ serviceId }: { serviceId: string }) {
  const [state, setState] = useState<{ data: ServiceProjects; canManage: boolean } | null | "loading">("loading");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<null | "pay" | "adjust">(null);
  const [pay, setPay] = useState({ title: "", amount: "", date: new Date().toISOString().slice(0, 10), before: false });
  const [adj, setAdj] = useState({ amount: "", reason: "" });
  const reload = () => loadServiceProjects(serviceId).then(setState);
  useEffect(() => {
    let alive = true;
    loadServiceProjects(serviceId).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [serviceId]);
  if (state === "loading" || state === null) return null;
  const { data, canManage } = state;
  const t = data.totals;
  const run = (f: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setMsg(null);
      const r = await f();
      if (!r.ok) return setMsg(r.error?.message ?? "No se pudo");
      setForm(null);
      await reload();
    });
  return (
    <section aria-labelledby="record-proyectos" className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <h3 id="record-proyectos" className="text-sm font-semibold">
          Proyectos e ingresos
        </h3>
        <span className="text-sm">
          <span className="text-xs text-muted-foreground">Facturación </span>
          {formatCents(t.total_cents ?? 0)}
        </span>
        <span className="text-sm">
          <span className="text-xs text-muted-foreground">Verificado </span>
          {formatCents(t.verified_cents ?? 0)}
        </span>
        {t.without_receipt ? <span className="text-xs text-rose-700 dark:text-rose-300">{t.without_receipt} sin comprobante</span> : null}
        {canManage ? (
          <span className="ml-auto flex gap-1">
            <button type="button" className={btn} onClick={() => setForm(form === "pay" ? null : "pay")}>
              Cargar un pago
            </button>
            <button type="button" className={btn} onClick={() => { setAdj({ amount: String((t.total_cents ?? 0) / 100), reason: "" }); setForm(form === "adjust" ? null : "adjust"); }}>
              Ajustar el total
            </button>
          </span>
        ) : null}
      </div>
      {form === "pay" ? (
        <fieldset disabled={pending} className="grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[1fr_120px_150px_auto]">
          <input className={field} placeholder="Título (ej. Anticipo web)" maxLength={200} value={pay.title} onChange={(e) => setPay({ ...pay, title: e.target.value })} />
          <input className={field} inputMode="decimal" placeholder="Monto" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          <input className={field} type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!pay.title.trim() || !Number.isFinite(parseAmountToCents(pay.amount))}
            onClick={() => run(() => addStudentPayment(serviceId, { title: pay.title.trim(), amount_cents: parseAmountToCents(pay.amount), received_on: pay.date, before_program: pay.before }))}
          >
            Guardar
          </button>
          <label className="flex items-center gap-2 text-xs sm:col-span-4">
            <input type="checkbox" checked={pay.before} onChange={(e) => setPay({ ...pay, before: e.target.checked })} />
            Lo cobró antes del programa
          </label>
        </fieldset>
      ) : null}
      {form === "adjust" ? (
        <fieldset disabled={pending} className="grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[150px_1fr_auto]">
          <input className={field} inputMode="decimal" aria-label="Total nuevo" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
          <input className={field} placeholder="Motivo del ajuste" maxLength={1000} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            disabled={adj.reason.trim().length < 3 || !Number.isFinite(parseAmountToCents(adj.amount))}
            onClick={() => run(() => adjustStudentTotal(serviceId, parseAmountToCents(adj.amount), adj.reason))}
          >
            Ajustar
          </button>
        </fieldset>
      ) : null}
      {msg ? (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      ) : null}
      {data.projects.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm" aria-label="Proyectos">
          {data.projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
              <span className="font-medium">{p.title}</span>
              <span className="text-xs text-muted-foreground">
                {[KIND_LABEL[p.kind], p.status ? STATUS_LABEL[p.status] : null, p.client?.company].filter(Boolean).join(" · ")}
              </span>
              {p.sold_cents !== null ? <span className="ml-auto tabular-nums">{formatCents(p.sold_cents)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Todavía no cargó proyectos.</p>
      )}
      {data.payments.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm" aria-label="Pagos">
          {data.payments.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
              <span className="tabular-nums text-xs text-muted-foreground">{r.received_on}</span>
              <span>{r.title}</span>
              {r.adjust_reason ? <span className="text-xs text-muted-foreground">{r.adjust_reason}</span> : null}
              <span className="text-xs text-muted-foreground">{r.kind === "adjustment" ? "Ajuste" : STATE_LABEL[r.state]}</span>
              <span className="ml-auto tabular-nums">{formatCents(r.amount_cents)}</span>
              {canManage && r.kind === "payment" ? (
                <button type="button" className={btn} disabled={pending} onClick={() => run(() => verifyStudentPayment(r.id, r.state !== "verified"))}>
                  {r.state === "verified" ? "Quitar verificación" : "Verificar"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
