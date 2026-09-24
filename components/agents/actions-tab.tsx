"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, Undo2 } from "lucide-react";
import type { AgentScreenData, ActionRow } from "@/lib/agent/screen";
import { AGENT_ACTION_LABELS, countActiveActionFilters } from "@/lib/agent/actions-query";
import { revertAgentAction } from "@/lib/actions/agent-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/components/contacts/ui";
import { cn } from "@/lib/utils";
import { DateFilter, EmptyState, FilterBar, FilterSelect, Pagination, useUrlFilters } from "./filters";

/**
 * Pestana Acciones (F28): la vista inversa de Runs. Una fila por accion que el
 * agente ejecuto (etiqueto, cambio temperatura, puso seguimiento, asigno,
 * derivo, se pauso, resumio), con el antes y el despues, y el boton de
 * revertir. Se arma sobre audit_log, sin tabla nueva.
 */
export function ActionsTab({ data }: { data: AgentScreenData }) {
  const actions = data.actions;
  const router = useRouter();
  const { pending, setParam, setPage, clearAll } = useUrlFilters();
  const [confirming, setConfirming] = useState<ActionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reverting, start] = useTransition();
  if (!actions) return null;
  const { filters, rows, total, pageSize, options, anyActions } = actions;
  const activeCount = countActiveActionFilters(filters, data.agent.id);

  function revert(row: ActionRow) {
    setError(null);
    start(async () => {
      const result = await revertAgentAction(row.id);
      setConfirming(null);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <FilterBar activeCount={activeCount} onClear={() => clearAll(["tab"])} pending={pending}>
        <FilterSelect
          label="Acción"
          allLabel="todas"
          value={filters.accion}
          onChange={(v) => setParam("accion", v)}
          options={Object.entries(AGENT_ACTION_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <DateFilter preset={filters.datePreset} from={filters.dateFrom} to={filters.dateTo} setParam={setParam} />
        <select
          aria-label="Agente"
          value={filters.agente}
          onChange={(e) => setParam("agente", e.target.value)}
          className={cn("rounded-lg border bg-background px-3 py-2 text-sm", filters.agente !== data.agent.id ? "border-primary" : "border-input text-muted-foreground")}
        >
          {options.agents.map((a) => (
            <option key={a.id} value={a.id}>
              Agente: {a.name}
            </option>
          ))}
          <option value="todos">Agente: todos</option>
        </select>
        <FilterSelect label="Canal" value={filters.canal} onChange={(v) => setParam("canal", v)} options={options.channels.map((c) => ({ value: c.id, label: c.label }))} />
        <FilterSelect
          label="Revertida"
          allLabel="da igual"
          value={filters.revertida}
          onChange={(v) => setParam("revertida", v)}
          options={[
            { value: "no", label: "Vigentes" },
            { value: "si", label: "Revertidas" },
          ]}
        />
        {filters.contacto && (
          <button type="button" onClick={() => setParam("contacto", "")} className="rounded-full border border-primary px-2 py-1 text-xs">
            Solo este contacto ×
          </button>
        )}
      </FilterBar>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-10 w-10" />}
          title="El agente todavía no ejecutó ninguna acción"
          text="Acá va a aparecer cada vez que etiquete un contacto, cambie una temperatura, programe un seguimiento, asigne o derive una conversación, se pause o guarde un resumen. Cada fila muestra el antes y el después y se puede revertir."
          filtered={anyActions || activeCount > 0}
          onClear={() => clearAll(["tab"])}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Cuándo</th>
                  <th className="px-3 py-2 font-medium">Acción</th>
                  <th className="px-3 py-2 font-medium">Contacto</th>
                  <th className="px-3 py-2 font-medium">Antes → después</th>
                  <th className="px-3 py-2 font-medium">Origen</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className={cn("align-top", row.revertedAt && "opacity-60")}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatDateTime(row.performedAt)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.actionLabel}</p>
                      {row.reason && <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{row.reason}</p>}
                      {row.revertedAt && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">Revertida el {formatDateTime(row.revertedAt)}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {row.contactId ? (
                        <Link href={`/dashboard/contacts/${row.contactId}`} className="underline underline-offset-2">
                          {row.contactName ?? "Contacto sin nombre"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {row.channelLabel && <p className="text-[11px] text-muted-foreground">{row.channelLabel}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {row.changes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs">
                          {row.changes.map((c) => (
                            <li key={c.field}>
                              <span className="font-medium">{c.field}:</span> <span className="text-muted-foreground">{c.before}</span> → {c.after}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <p>{row.origin === "close_classification" ? "Al cierre" : "En la conversación"}</p>
                      <div className="mt-0.5 flex flex-wrap gap-2">
                        {row.runId && (
                          <Link href={`/dashboard/agents/runs/${row.runId}`} className="underline underline-offset-2">
                            Ver run
                          </Link>
                        )}
                        {row.conversationId && (
                          <Link href={`/dashboard/inbox?c=${row.conversationId}`} className="underline underline-offset-2">
                            Conversación
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.revertible && (
                        <button
                          type="button"
                          onClick={() => setConfirming(row)}
                          disabled={reverting}
                          className="inline-flex items-center gap-1 rounded-lg border border-input px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          <Undo2 className="h-3 w-3" aria-hidden />
                          Revertir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} total={total} pageSize={pageSize} onPage={setPage} />
        </>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title="¿Revertir esta acción?"
        message={
          confirming
            ? `Se deshace "${confirming.actionLabel.toLowerCase()}" sobre ${confirming.contactName ?? "este contacto"} y queda registrado quién lo revirtió y cuándo.`
            : ""
        }
        confirmLabel="Revertir"
        cancelLabel="Cancelar"
        onConfirm={() => confirming && revert(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
