"use client";

import { useMemo, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import { dashboardFiltersToParams, activeFilterChips, type DashboardFilters } from "@/lib/dashboards/url-state";
import { compare, firstResponseTone, formatDuration } from "@/lib/dashboards/cards";
import { timeTone, sortTeam } from "@/lib/dashboards/team-table";
import type { ChatDashboardData } from "@/lib/dashboards/load";

const TOOLTIP =
  "Métricas de tus conversaciones: cuánto se habla, quién responde y qué tan rápido, y cómo está trabajando el agente. Filtrá por canal y por quién respondió arriba a la derecha. Un Member ve solo sus leads; Owner y Admin, todo el workspace.";

const AUTHOR_LABELS: Record<string, string> = {
  agent: "Agente IA", external: "Fuera del sistema", automations: "Automatizaciones",
};

export function ChatDashboard({
  data,
  filters,
  channels,
  members,
  isAdmin,
  timezone,
}: {
  data: ChatDashboardData;
  filters: DashboardFilters;
  channels: Array<{ id: string; label: string; platform: string; connected: boolean }>;
  members: Array<{ id: string; label: string; role: string }>;
  isAdmin: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  const memberLabel = useMemo(() => new Map(members.map((m) => [m.id, m.label])), [members]);
  const channelLabel = useMemo(() => new Map(channels.map((c) => [c.id, c.label])), [channels]);

  function setFilter(patch: Partial<DashboardFilters>) {
    const next = { ...filters, ...patch };
    const params = dashboardFiltersToParams(next);
    start(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const chips = activeFilterChips(filters, {
    channel: (id) => channelLabel.get(id) ?? id,
    author: (id) => AUTHOR_LABELS[id] ?? memberLabel.get(id) ?? id,
  });

  const nums = data.numbers;
  const prev = data.previous;
  const cmp = (get: (n: typeof nums) => number) => compare(get(nums), prev ? get(prev) : null);

  const filteredByPerson = filters.author && !AUTHOR_LABELS[filters.author];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Dashboards"
        tooltip={TOOLTIP}
        left={<span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium">Chat</span>}
        right={
          <div className="flex items-center gap-2">
            <select
              aria-label="Canal"
              value={filters.channel ?? "all"}
              onChange={(e) => setFilter({ channel: e.target.value === "all" ? null : e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="all">Todos los canales</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.label}{c.connected ? "" : " (sin conectar)"}</option>
              ))}
            </select>
            <select
              aria-label="Respondido por"
              value={filters.author ?? "all"}
              onChange={(e) => setFilter({ author: e.target.value === "all" ? null : e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="all">Todos</option>
              <option value="agent">Agente IA</option>
              <option value="automations">Automatizaciones</option>
              <option value="external">Fuera del sistema</option>
              {members.map((m) => (<option key={m.id} value={m.id}>{m.label} ({m.role})</option>))}
            </select>
            <select
              aria-label="Período"
              value={filters.from && filters.to ? "custom" : filters.period}
              onChange={(e) => setFilter({ period: e.target.value as PeriodPreset, from: null, to: null })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {PERIOD_PRESETS.map((p) => (<option key={p} value={p}>{PERIOD_LABELS[p]}</option>))}
            </select>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {/* Franja de contexto */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{isAdmin ? "Todo el workspace" : "Tus leads"}</span>
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5">
              {c.label}
              <button aria-label={`Quitar filtro ${c.label}`} onClick={() => setFilter({ [c.key]: null } as Partial<DashboardFilters>)}>✕</button>
            </span>
          ))}
          {pending && <span>Actualizando…</span>}
        </div>

        {/* 5 tarjetas */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card title={filteredByPerson ? "En las que participó" : "Conversaciones nuevas"} value={nums.newConversations} comp={cmp((n) => n.newConversations)} />
          <Card title="Mensajes recibidos" value={nums.messagesIn} comp={cmp((n) => n.messagesIn)} />
          <Card title="Mensajes enviados" value={nums.messagesOut} comp={cmp((n) => n.messagesOut)} />
          <FirstResponseCard seconds={nums.firstResponseMedianSeconds} prevSeconds={prev?.firstResponseMedianSeconds ?? null} />
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Esperando respuesta ahora</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">{data.waitingNow}</p>
            <Link href="/dashboard/inbox?estado=abiertas" className="text-xs text-primary underline underline-offset-2">Ver en Inbox</Link>
          </div>
        </div>

        {/* Tendencias (barras simples de conversaciones nuevas por día) */}
        <Trends trends={data.trends} />

        {/* Sección del agente */}
        {filteredByPerson ? (
          <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            La sección del agente se oculta al filtrar por una persona.{" "}
            <button onClick={() => setFilter({ author: null })} className="text-primary underline underline-offset-2">Ver todos</button>
          </div>
        ) : (
          <AgentSection agent={data.agent} />
        )}

        {/* Quién responde */}
        <TeamTable
          team={data.team}
          memberLabel={memberLabel}
          activeAuthor={filters.author}
          onPick={(author) => setFilter({ author: filters.author === author ? null : author })}
        />

        {/* Patrones de mensajes (Bloque 4) */}
        <PatternsSection patterns={data.patterns} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

function Card({ title, value, comp }: { title: string; value: number; comp: ReturnType<typeof compare> }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {comp.delta !== null && (
        <p className="text-xs text-muted-foreground">
          {comp.delta > 0 ? "▲" : comp.delta < 0 ? "▼" : "="} {Math.abs(comp.delta)} vs. período anterior
        </p>
      )}
    </div>
  );
}

function FirstResponseCard({ seconds, prevSeconds }: { seconds: number | null; prevSeconds: number | null }) {
  const comp = compare(seconds ?? 0, prevSeconds);
  const tone = firstResponseTone(comp);
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">Primera respuesta (mediana)</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-amber-700" : ""}`}>
        {formatDuration(seconds)}
      </p>
      {seconds !== null && prevSeconds !== null && (
        <p className="text-xs text-muted-foreground">{tone === "good" ? "Más rápido" : tone === "bad" ? "Más lento" : "Igual"} que antes</p>
      )}
    </div>
  );
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((100 * n) / total) : 0;
}

function AgentSection({ agent }: { agent: ChatDashboardData["agent"] }) {
  if (agent.newConversations === 0) {
    return (
      <div className="mt-6 rounded-xl border border-border p-4 text-sm text-muted-foreground">
        El agente todavía no respondió ninguna conversación en este período.
      </div>
    );
  }
  const stat = (label: string, n: number) => (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{pct(n, agent.newConversations)}%</p>
      <p className="text-xs text-muted-foreground">{n} de {agent.newConversations}</p>
    </div>
  );
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">El agente</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stat("Actuó", agent.acted)}
        {stat("Tomó desde el primer mensaje", agent.tookFirst)}
        {stat("Derivó a una persona", agent.escalated)}
      </div>
      <Link href="/dashboard/agents?tab=runs" className="mt-2 inline-block text-xs text-primary underline underline-offset-2">
        Ver runs y acciones en Agentes →
      </Link>
    </section>
  );
}

function TeamTable({
  team,
  memberLabel,
  activeAuthor,
  onPick,
}: {
  team: ChatDashboardData["team"];
  memberLabel: Map<string, string>;
  activeAuthor: string | null;
  onPick: (author: string) => void;
}) {
  if (team.length === 0) return null;
  const label = (author: string) => (author === "agent" ? "Agente IA" : author === "external" ? "Fuera del sistema" : author === "flow" || author === "sequence" || author === "broadcast" ? "Automatizaciones" : memberLabel.get(author) ?? "Alguien del equipo");
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Quién responde</h2>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Quién</th>
              <th className="px-3 py-2 text-right">Mensajes</th>
              <th className="px-3 py-2 text-right">Primera respuesta</th>
              <th className="px-3 py-2 text-right">Respuesta</th>
              <th className="px-3 py-2 text-right">&lt; 1 h</th>
            </tr>
          </thead>
          <tbody>
            {sortTeam(team).map((r) => {
              const active = activeAuthor === r.author;
              return (
                <tr
                  key={r.author}
                  onClick={() => onPick(r.author)}
                  className={`cursor-pointer border-t border-border hover:bg-accent/40 ${active ? "bg-accent/60" : ""}`}
                >
                  <td className="px-3 py-2">{label(r.author)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.messagesOut}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${toneClass(timeTone(r.firstResponseMedianSeconds))}`}>{fmtTime(r.firstResponseMedianSeconds)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${toneClass(timeTone(r.replyMedianSeconds))}`}>{fmtTime(r.replyMedianSeconds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.repliesUnder1hPct != null ? `${r.repliesUnder1hPct}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtTime(seconds: number | null): string {
  return formatDuration(seconds);
}
function toneClass(tone: "ok" | "warn" | "bad"): string {
  return tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-700" : "";
}

function Trends({ trends }: { trends: ChatDashboardData["trends"] }) {
  if (trends.length === 0) return null;
  const max = Math.max(1, ...trends.map((t) => t.newConversations));
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Conversaciones nuevas por día</h2>
      <div className="flex items-end gap-0.5 rounded-xl border border-border p-3" style={{ height: 120 }}>
        {trends.map((t) => (
          <div key={t.day} className="flex-1" title={`${t.day}: ${t.newConversations}`}>
            <div className="mx-auto w-full rounded-t bg-primary/70" style={{ height: `${Math.round((t.newConversations / max) * 90)}px` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PatternsSection({ patterns, isAdmin }: { patterns: ChatDashboardData["patterns"]; isAdmin: boolean }) {
  const withVolume = patterns.filter((p) => p.messageCount > 0 || p.textCount > 0);
  if (withVolume.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Todavía no hay patrones clasificados. La clasificación agrupa los mensajes por lo que significan (corre de noche).
      </div>
    );
  }
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Lo que más se recibe</h2>
      <div className="space-y-2">
        {withVolume.map((p) => (
          <details key={p.categoryId} className="rounded-xl border border-border">
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
              <span className="font-medium">{p.name}{p.isFallback ? " (sin clasificar)" : ""}</span>
              <span className="tabular-nums text-muted-foreground">{p.messageCount} mensajes · {p.textCount} textos</span>
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {p.topVariants.map((v, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="truncate">
                    {v.is_button && <span className="mr-1 rounded bg-accent px-1 text-[10px]">botón</span>}
                    {v.text}
                  </span>
                  <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                    {v.count}
                    {v.confidence != null && (
                      <span className={v.confidence < 0.7 ? "ml-2 text-amber-700" : "ml-2"}>{Math.round(v.confidence * 100)}%</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      {isAdmin && (
        <p className="mt-2 text-xs text-muted-foreground">
          Corregí las categorías moviendo textos desde acá (Owner/Admin). La calidad se ajusta en Settings → Tareas en segundo plano.
        </p>
      )}
    </section>
  );
}
