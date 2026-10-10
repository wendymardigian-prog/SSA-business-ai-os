"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Cog, User, Webhook } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  actorName,
  buildHistoryQuery,
  describeChanges,
  effectiveActorType,
  runHistoryQuery,
  CALL_ACTION_LABELS,
  type HistoryRow,
} from "@/lib/audit-history";
import type { AuditActorType } from "@/lib/types/database";

/**
 * El historial de una entidad (Llamadas, F1). Lo usan Llamadas, Formularios,
 * Ventas, CX y Gastos: por eso es generico.
 *
 * Lee con el cliente del usuario: la RLS decide que se ve. Una persona nunca
 * ve de mas por usar este componente.
 */

const ACTOR_ICON: Record<AuditActorType, typeof User> = { user: User, agent: Bot, system: Cog, webhook: Webhook };
const ACTOR_NOUN: Record<AuditActorType, string> = { user: "persona", agent: "agente de IA", system: "sistema", webhook: "proveedor externo" };

const GENERIC_ACTIONS: Record<string, string> = {
  create: "creó",
  update: "editó",
  delete: "eliminó",
  restore: "restauró",
  link: "vinculó",
  summary: "actualizó el resumen",
  ...CALL_ACTION_LABELS,
};

function actionText(action: string): string {
  return GENERIC_ACTIONS[action] ?? action.replace(/[._]/g, " ");
}

function formatWhen(value: string, timeZone?: string): string {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}),
  });
}

export interface HistorialProps {
  entityType: string;
  entityId: string;
  /** Nombres de los miembros y de los agentes (los carga el servidor: auth.users no se lee por RLS). */
  names?: { users?: Record<string, string>; agents?: Record<string, string> };
  /** Zona del usuario (IANA). */
  timeZone?: string;
  pageSize?: number;
}

export function Historial({ entityType, entityId, names, timeZone, pageSize }: HistorialProps) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (after: string | null) => {
      const supabase = createClient();
      const spec = buildHistoryQuery({ entityType, entityId, cursor: after, pageSize });
      const result = await runHistoryQuery(supabase as never, spec);
      if (!result.ok) {
        setState("error");
        return;
      }
      setRows((prev) => (after ? [...prev, ...result.page.rows] : result.page.rows));
      setCursor(result.page.nextCursor);
      setState("ready");
    },
    [entityType, entityId, pageSize],
  );

  useEffect(() => {
    setState("loading");
    void load(null);
  }, [load]);

  if (state === "loading") {
    return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />)}</div>;
  }
  if (state === "error") {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
        <span>No pude leer el historial.</span>
        <button type="button" className="underline" onClick={() => { setState("loading"); void load(null); }}>Reintentar</button>
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay cambios.</p>;
  }

  return (
    <div>
      <ol className="space-y-3">
        {rows.map((row) => {
          const type = effectiveActorType(row);
          const Icon = ACTOR_ICON[type];
          const lines = describeChanges(entityType, row.changes);
          return (
            <li key={row.id} className="flex gap-3">
              <span title={ACTOR_NOUN[type]} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">{ACTOR_NOUN[type]}</span>
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  <span className="font-medium">{actorName(row, names)}</span> {actionText(row.action)}
                  <span className="ml-2 text-xs text-muted-foreground">{formatWhen(row.performed_at, timeZone)}</span>
                </p>
                {lines.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {lines.map((l) => (
                      <li key={l.field} className="break-words">
                        <span className="font-medium">{l.label}:</span> {l.before} → {l.after}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {cursor && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={async () => { setLoadingMore(true); await load(cursor); setLoadingMore(false); }}
          className="mt-3 text-sm text-primary underline disabled:opacity-50"
        >
          {loadingMore ? "Cargando…" : "Ver más"}
        </button>
      )}
    </div>
  );
}
