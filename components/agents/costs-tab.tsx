"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import type { AgentScreenData } from "@/lib/agent/screen";
import { addModelPrice, updateWorkspaceAiLimits } from "@/lib/actions/agents";
import { formatDateTime } from "@/components/contacts/ui";
import { Field, NumberInput, Notice, Section, inputClass } from "./fields";
import { DateFilter, FilterBar, formatUsd, useUrlFilters } from "./filters";

/**
 * Pestana Costos (F29). Solo Owner/Admin: la pagina no manda estos datos a un
 * Member. Todos los numeros son estimados segun los precios cargados, y lo
 * dicen.
 */
export function CostsTab({ data }: { data: AgentScreenData }) {
  const costs = data.costs;
  const { pending, setParam, clearAll } = useUrlFilters();
  if (!costs) return null;
  const { report, averages, filters, rangeLabel, limits, pricing, canEditPricing } = costs;
  const t = report.totals;

  return (
    <div className="space-y-6">
      <FilterBar activeCount={filters.datePreset !== "30d" ? 1 : 0} onClear={() => clearAll(["tab"])} pending={pending}>
        <DateFilter preset={filters.datePreset} from={filters.dateFrom} to={filters.dateTo} setParam={setParam} />
        <span className="text-xs text-muted-foreground">Todo el gasto de IA del workspace, no solo el del agente. Estimado según los precios cargados.</span>
      </FilterBar>

      {t.runs === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Coins className="h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="mt-3 text-sm font-medium">Sin gasto de IA en {rangeLabel.toLowerCase()}</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Acá se suma cada llamada a IA del sistema: los turnos del agente, el nodo de IA de los flows, los pasos de secuencias, la indexación de documentos y los
            resúmenes de cierre. Aparece en cuanto corra la primera.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Total · ${rangeLabel}`} value={formatUsd(t.costUsd)} hint={`${t.runs} run${t.runs === 1 ? "" : "s"}`} />
            <Stat label="Promedio por run" value={formatUsd(averages.perRun)} />
            <Stat label="Promedio por conversación" value={formatUsd(averages.perConversation)} hint={`${t.conversations} conversaciones`} />
            <Stat label="Costo por derivación" value={formatUsd(averages.perEscalation)} hint={averages.escalationRatePct === null ? "sin derivaciones" : `${t.escalations} derivaciones (${averages.escalationRatePct}% de los turnos)`} />
          </div>
          {t.missingPricing > 0 && (
            <Notice tone="warning">
              {t.missingPricing} run{t.missingPricing === 1 ? "" : "s"} del período no tienen precio cargado para su modelo: el total está por debajo del real. Cargá el precio abajo.
            </Notice>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Por fuente" description="De dónde sale el gasto.">
              <Breakdown rows={report.bySource.map((r) => ({ key: r.source, label: r.label, runs: r.runs, costUsd: r.costUsd }))} />
            </Section>
            <Section title="Por agente">
              <Breakdown rows={report.byAgent.map((r) => ({ key: r.agentId ?? "none", label: r.name, runs: r.runs, costUsd: r.costUsd }))} />
            </Section>
          </div>

          <Section title="Por modelo">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Modelo</th>
                  <th className="py-1 text-right font-medium">Runs</th>
                  <th className="py-1 text-right font-medium">Tokens entrada / salida</th>
                  <th className="py-1 text-right font-medium">Costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.byModel.map((m) => (
                  <tr key={`${m.provider}/${m.model}`}>
                    <td className="py-1.5">
                      {m.provider}/{m.model}
                      {m.missingPricing > 0 && <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-400">sin precio en {m.missingPricing} run{m.missingPricing === 1 ? "" : "s"}</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{m.runs}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {m.inputTokens.toLocaleString("es-AR")} / {m.outputTokens.toLocaleString("es-AR")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Las 10 conversaciones más caras" description="Ahí es donde se detecta un loop.">
            {report.topConversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún run del período está atado a una conversación.</p>
            ) : (
              <ol className="divide-y divide-border">
                {report.topConversations.map((c, i) => (
                  <li key={c.conversationId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span>
                      <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                      <Link href={`/dashboard/inbox?c=${c.conversationId}`} className="underline underline-offset-2">
                        {c.contactName ?? "Contacto sin nombre"}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{c.runs} run{c.runs === 1 ? "" : "s"}</span>
                      <Link href={`/dashboard/agents/${data.agent.id}?tab=runs&c=${c.conversationId}&agente=todos`} className="ml-2 text-xs text-muted-foreground underline underline-offset-2">
                        ver runs
                      </Link>
                    </span>
                    <span className="tabular-nums">{formatUsd(c.costUsd)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}

      <LimitsSection limits={limits} agentId={data.agent.id} />
      <PricingSection pricing={pricing} canEdit={canEditPricing} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Breakdown({ rows }: { rows: Array<{ key: string; label: string; runs: number; costUsd: number }> }) {
  const max = Math.max(...rows.map((r) => r.costUsd), 0.000001);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>
              {r.label} <span className="text-xs text-muted-foreground">· {r.runs} run{r.runs === 1 ? "" : "s"}</span>
            </span>
            <span className="tabular-nums">{formatUsd(r.costUsd)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(2, (r.costUsd / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function LimitsSection({ limits, agentId }: { limits: NonNullable<AgentScreenData["costs"]>["limits"]; agentId: string }) {
  const router = useRouter();
  const [daily, setDaily] = useState<number | null>(limits.workspaceDailyUsd);
  const [monthly, setMonthly] = useState<number | null>(limits.workspaceMonthlyUsd);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = daily !== limits.workspaceDailyUsd || monthly !== limits.workspaceMonthlyUsd;
  const action = (a: "notify" | "disable") => (a === "disable" ? "apaga el agente" : "avisa");

  return (
    <Section title="Topes de gasto" description="Se evalúan antes de cada llamada al modelo, en la zona del negocio. Estimados según los precios cargados.">
      <div className="rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">Del agente</p>
        <p className="text-xs text-muted-foreground">
          Diario: {formatUsd(limits.agentDailyUsd)} ({action(limits.agentDailyAction)}) · Mensual: {formatUsd(limits.agentMonthlyUsd)} ({action(limits.agentMonthlyAction)}).{" "}
          <Link href={`/dashboard/agents/${agentId}?tab=config`} className="underline underline-offset-2">
            Se editan en Configuración → Guardarraíles
          </Link>
          .
        </p>
      </div>
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Del workspace (todo el gasto de IA)</p>
        <p className="text-xs text-muted-foreground">El diario avisa; el mensual apaga el agente. Vacío: sin tope global.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Diario (USD)">{(id) => <NumberInput id={id} value={daily} min={0} step={0.5} allowEmpty onChange={(v) => { setMessage(null); setDaily(v); }} />}</Field>
          <Field label="Mensual (USD)">{(id) => <NumberInput id={id} value={monthly} min={0} step={1} allowEmpty onChange={(v) => { setMessage(null); setMonthly(v); }} />}</Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const r = await updateWorkspaceAiLimits({ dailyUsd: daily, monthlyUsd: monthly });
                if (!r.ok) return setMessage({ tone: "error", text: r.error });
                setMessage({ tone: "success", text: "Topes del workspace guardados." });
                router.refresh();
              })
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Guardar topes
          </button>
          {message && (
            <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-emerald-700 dark:text-emerald-400"}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

function PricingSection({ pricing, canEdit }: { pricing: NonNullable<AgentScreenData["costs"]>["pricing"]; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ provider: "anthropic", model: "", input: 0, output: 0, cached: 0, note: "" });
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <Section
      title="Tabla de precios por modelo"
      description="USD por millón de tokens. Un precio nuevo es una fila nueva con vigencia desde ahora: los runs viejos conservan el precio con el que se calcularon. Revisala cada vez que cambies de modelo."
    >
      {pricing.length === 0 ? (
        <Notice tone="warning">No hay precios cargados: todos los runs quedan con el costo sin calcular. Cargalos abajo (o corré el seed supabase/seeds/00_model_pricing.sql).</Notice>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Modelo</th>
              <th className="py-1 text-right font-medium">Entrada</th>
              <th className="py-1 text-right font-medium">Salida</th>
              <th className="py-1 text-right font-medium">Caché</th>
              <th className="py-1 text-right font-medium">Vigente desde</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pricing.map((p) => (
              <tr key={p.id}>
                <td className="py-1.5">
                  {p.provider}/{p.model}
                  {p.note && <span className="ml-2 text-[11px] text-muted-foreground">{p.note}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.inputPerMtok}</td>
                <td className="py-1.5 text-right tabular-nums">{p.outputPerMtok}</td>
                <td className="py-1.5 text-right tabular-nums">{p.cachedInputPerMtok}</td>
                <td className="py-1.5 text-right text-xs text-muted-foreground">{formatDateTime(p.validFrom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit ? (
        <form
          className="rounded-lg border border-dashed border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            start(async () => {
              const r = await addModelPrice({ provider: form.provider, model: form.model, inputPerMtok: form.input, outputPerMtok: form.output, cachedInputPerMtok: form.cached, note: form.note });
              if (!r.ok) return setMessage({ tone: "error", text: r.error });
              setMessage({ tone: "success", text: "Precio cargado." });
              setForm((f) => ({ ...f, model: "", note: "" }));
              router.refresh();
            });
          }}
        >
          <p className="text-sm font-medium">Cargar un precio (solo Owner)</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Proveedor">{(id) => <input id={id} list="providers-list" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={inputClass} required />}</Field>
            <datalist id="providers-list">
              {["anthropic", "openai", "google", "voyage"].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <Field label="Modelo">{(id) => <input id={id} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputClass} placeholder="claude-sonnet-5" required />}</Field>
            <Field label="Nota (opcional)">{(id) => <input id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputClass} maxLength={200} />}</Field>
            <Field label="Entrada (USD / M tokens)">{(id) => <NumberInput id={id} value={form.input} min={0} step={0.01} onChange={(v) => setForm({ ...form, input: v ?? 0 })} />}</Field>
            <Field label="Salida (USD / M tokens)">{(id) => <NumberInput id={id} value={form.output} min={0} step={0.01} onChange={(v) => setForm({ ...form, output: v ?? 0 })} />}</Field>
            <Field label="Caché (USD / M tokens)">{(id) => <NumberInput id={id} value={form.cached} min={0} step={0.01} onChange={(v) => setForm({ ...form, cached: v ?? 0 })} />}</Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Cargar precio
            </button>
            {message && (
              <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-emerald-700 dark:text-emerald-400"}>
                {message.text}
              </span>
            )}
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Solo el Owner del workspace puede cargar precios.</p>
      )}
    </Section>
  );
}
