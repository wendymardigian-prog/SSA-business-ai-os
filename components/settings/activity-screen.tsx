"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Cog, User, Webhook } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ACTOR_TYPE_LABELS, ACTOR_TYPES, ENTITY_TYPE_LABELS, entityHref } from "@/lib/audit-query";
import { actorName, describeChanges, effectiveActorType, SALE_ACTION_LABELS, CALL_ACTION_LABELS, FORM_ACTION_LABELS, type HistoryRow } from "@/lib/audit-history";
import type { AuditActorType } from "@/lib/types/database";

export type ActivityRow = HistoryRow & { entity_type: string; entity_id: string };

interface Filters {
  entidad: string;
  accion: string;
  actor: string;
  persona: string;
  q: string;
  desde: string;
  hasta: string;
}

const ACTOR_ICON: Record<AuditActorType, typeof User> = { user: User, agent: Bot, system: Cog, webhook: Webhook };
const ACTIONS: Record<string, string> = { create: "creó", update: "editó", delete: "eliminó", restore: "restauró", link: "vinculó", ...CALL_ACTION_LABELS, ...FORM_ACTION_LABELS, ...SALE_ACTION_LABELS };
const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

function formatWhen(value: string, timeZone: string): string {
  return new Date(value).toLocaleString("es-AR", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Actividad (F36): el historial de todo el workspace. Los filtros viven en la URL; quien la arma es
 * `lib/audit-query.ts`, la misma función que usa `<Historial>`. Cada fila lleva a su entidad.
 */
export function ActivityScreen({
  rows, total, page, pageSize, loadError, filters, names, members, timeZone,
}: { rows: ActivityRow[]; total: number; page: number; pageSize: number; loadError: boolean; filters: Filters; names: Record<string, string>; members: Array<{ id: string; name: string }>; timeZone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(filters.q);
  const [action, setAction] = useState(filters.accion);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const active = Object.values(filters).some(Boolean);

  function go(patch: Partial<Filters & { pagina: string }>) {
    const next = new URLSearchParams();
    const merged = { ...filters, ...patch } as Record<string, string>;
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    if (!("pagina" in patch)) next.delete("pagina");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/settings/actividad" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsTabs />
        <div className="p-4 md:p-6">
          <div className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Tipo de entidad">
              <select className={selectClass} value={filters.entidad} onChange={(e) => go({ entidad: e.target.value })}>
                <option value="">Todos</option>
                {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Acción (ej. sale.created o sale.)">
              <form onSubmit={(e) => { e.preventDefault(); go({ accion: action.trim() }); }}>
                <input className={selectClass} value={action} onChange={(e) => setAction(e.target.value)} onBlur={() => action.trim() !== filters.accion && go({ accion: action.trim() })} placeholder="payment.paid" />
              </form>
            </Field>
            <Field label="Quién lo hizo">
              <select className={selectClass} value={filters.actor} onChange={(e) => go({ actor: e.target.value })}>
                <option value="">Cualquiera</option>
                {ACTOR_TYPES.map((t) => <option key={t} value={t}>{ACTOR_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Persona">
              <select className={selectClass} value={filters.persona} onChange={(e) => go({ persona: e.target.value })}>
                <option value="">Todas</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Desde"><input type="date" className={selectClass} value={filters.desde} onChange={(e) => go({ desde: e.target.value })} /></Field>
            <Field label="Hasta"><input type="date" className={selectClass} value={filters.hasta} onChange={(e) => go({ hasta: e.target.value })} /></Field>
            <Field label="Buscar en el nombre del actor (ej. Job de mora)">
              <form onSubmit={(e) => { e.preventDefault(); go({ q: text.trim() }); }}>
                <input className={selectClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Job de mora" />
              </form>
            </Field>
            {active && <div className="flex items-end"><button type="button" onClick={() => router.push(pathname)} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">Limpiar filtros</button></div>}
          </div>

          {loadError ? (
            <p role="alert" className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-700 dark:text-red-300">No se pudo cargar la actividad.</p>
          ) : rows.length === 0 ? (
            <p className="mt-6 rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{active ? "No hay actividad con estos filtros." : "Todavía no hay actividad registrada."}</p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
                {rows.map((r) => {
                  const type = effectiveActorType(r);
                  const Icon = ACTOR_ICON[type];
                  const href = entityHref(r.entity_type, r.entity_id, r.metadata);
                  const lines = describeChanges(r.entity_type, r.changes);
                  const reason = (r.metadata as { reason?: unknown } | null)?.reason;
                  return (
                    <li key={r.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-sm">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={ACTOR_TYPE_LABELS[type]} />
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-medium">{actorName(r, { users: names })}</span> {ACTIONS[r.action] ?? r.action.replace(/[._]/g, " ")}
                          <span className="text-muted-foreground"> · {ENTITY_TYPE_LABELS[r.entity_type] ?? r.entity_type}</span>
                        </p>
                        {lines.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                            {lines.map((l) => <li key={l.field}>{l.label}: {l.before} → {l.after}</li>)}
                          </ul>
                        )}
                        {typeof reason === "string" && reason && <p className="mt-0.5 text-xs text-muted-foreground">Motivo: {reason}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <time dateTime={r.performed_at}>{formatWhen(r.performed_at, timeZone)}</time>
                        {href && <Link href={href} className="text-primary underline-offset-2 hover:underline">Ver</Link>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación">
                <span className="text-xs text-muted-foreground">{total} {total === 1 ? "registro" : "registros"}</span>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => go({ pagina: String(page - 1) })} aria-label="Página anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                  <span className="text-xs">Página {page} de {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => go({ pagina: String(page + 1) })} aria-label="Página siguiente" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
                </div>
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}
