"use client";

import { Suspense, use, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, BarChart3, Eye, Plug, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "@/components/dashboards/dashboard-switcher";
import type { DashboardOption } from "@/lib/dashboards/available";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import { dashboardFiltersToParams, type DashboardFilters } from "@/lib/dashboards/url-state";
import { formatAgo } from "@/lib/dashboards/chat/comparisons";
import { formatCivil, isoRangeToCivil } from "@/lib/dashboards/chat/date-range";
import { agentSectionMode, hiddenAuthorNotice } from "@/lib/dashboards/chat/agent";
import type { AgentVisibilityResult } from "@/lib/dashboards/chat/agent-visibility";
import { showDraftAlert } from "@/lib/dashboards/chat/drafts";
import type { RepliesPanel } from "@/lib/dashboards/chat/patterns";
import type { BlockResult } from "@/lib/dashboards/chat/types";
import { cn } from "@/lib/utils";
import type {
  AgentBlock as AgentData, CardsBlock, FirstResponderBlock, PatternsBlock, TrendsBlock as TrendsData,
} from "@/lib/dashboards/chat/loaders";
import type { AgentActionRow, EscalationReason, RuleResultRow } from "@/lib/dashboards/chat/escalations";
import type { DraftsCard } from "@/lib/dashboards/chat/drafts";
import { Block, BlockSkeleton, ChatBlockQueryContext, DeferredBlock, EmptyBlock, SectionHeading } from "./block";
import { ChannelMenu, channelColor, type ChannelOption } from "./filters/channel-menu";
import { AuthorMenu, authorLabel as authorLabelFor, type AuthorMember } from "./filters/author-menu";
import { PeriodPopover } from "./filters/period-popover";
import { KpiCards } from "./kpi-cards";
import { DraftAlert } from "./draft-alert";
import { TrendsBlock } from "./trends-block";
import { AgentActionsCard, AgentConnectionWarning, AgentHidden, AgentNoRuns, AgentRates, ApprovalCard, EscalationReasonsCard, FirstResponderCard, RuleResultsCard } from "./agent-block";
import { TeamBlock } from "./team-block";
import { PatternsSection, QualityLineRow } from "./patterns-block";
import { fetchRepliesAction, refreshChatDashboardAction } from "@/lib/actions/chat-dashboard";

/**
 * El dashboard de Chat.
 *
 * Recibe una promesa por bloque y no las espera: cada pedazo aparece cuando
 * llega el suyo. Antes la pantalla entera esperaba a que terminaran las siete
 * consultas, y la mas lenta marcaba el tiempo de todas. "Quién responde" y
 * "Patrones" ni siquiera vienen con la pagina: se piden al llegar con el scroll.
 *
 * Los filtros viven en la URL: compartir un link es compartir la vista.
 */

/** Los bloques de la seccion "El agente". null cuando la seccion no se muestra: ni se consultan (O). */
export interface AgentSectionBlocks {
  agent: Promise<BlockResult<AgentData>>;
  firstResponder: Promise<BlockResult<FirstResponderBlock>>;
  escalations: Promise<BlockResult<EscalationReason[]>>;
  actions: Promise<BlockResult<AgentActionRow[]>>;
  rules: Promise<BlockResult<RuleResultRow[]>> | null;
}

export interface ChatDashboardBlocks {
  cards: Promise<BlockResult<CardsBlock>>;
  trends: Promise<BlockResult<TrendsData>>;
  agentSection: AgentSectionBlocks | null;
  drafts: Promise<BlockResult<DraftsCard>>;
}

export function ChatDashboardShell({
  blocks,
  generation,
  patternsGeneration,
  setupWarning,
  filters,
  channels,
  members,
  dashboards,
  comingSoon,
  isAdmin,
  timezone,
  draftChannelsLabel,
  hasDraftChannels,
  draftsHref,
  agentVisibility,
  agentHref,
  agentActionsHref,
}: {
  blocks: ChatDashboardBlocks;
  /** Cambia con "Actualizar": es parte del `key` de cada bloque. */
  generation: number;
  /** Cambia con una correccion de categorias: Patrones se vuelve a pedir sin parpadear. */
  patternsGeneration: number;
  /** Si no se pudieron leer los canales o los agentes: algunos filtros o secciones pueden faltar. */
  setupWarning: string | null;
  filters: DashboardFilters;
  channels: ChannelOption[];
  members: AuthorMember[];
  dashboards: DashboardOption[];
  comingSoon: DashboardOption[];
  isAdmin: boolean;
  timezone: string;
  draftChannelsLabel: string;
  hasDraftChannels: boolean;
  draftsHref: string;
  /** Cuando se muestra la seccion del agente y con que aviso (O). */
  agentVisibility: AgentVisibilityResult;
  agentHref: string | null;
  agentActionsHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const agentSection = blocks.agentSection;
  const query = dashboardFiltersToParams(filters).toString();
  // El `key` de cada bloque: filtros nuevos o "Actualizar" son un bloque nuevo, con su skeleton.
  const loadKey = `${query}|${generation}`;
  const authorHidesAgent = agentSectionMode(filters.author, 1) === "hidden-author";

  function setFilter(patch: Partial<DashboardFilters>) {
    const next = { ...filters, ...patch };
    const params = dashboardFiltersToParams(next);
    const qs = params.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const authorName = filters.author === null ? null : authorLabelFor(filters.author, members);
  const shortAuthorName =
    filters.author === null ? null : (members.find((m) => m.id === filters.author)?.label.split(" ")[0] ?? authorName);
  const customRange = isoRangeToCivil(filters.from, filters.to, timezone);
  const rangeChip = customRange
    ? `${formatCivil(customRange.from)} – ${formatCivil(customRange.to)}`
    : PERIOD_LABELS[filters.period as PeriodPreset];

  const waChannel = channels.find((c) => c.platform === "whatsapp");
  const filteredChannelDisconnected = filters.channel
    ? channels.find((c) => c.id === filters.channel && !c.connected)
    : undefined;

  return (
    <ChatBlockQueryContext.Provider value={query}>
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/chat"
        left={<DashboardSwitcher options={dashboards} comingSoon={comingSoon} />}
        filters={
          <>
            <ChannelMenu channels={channels} value={filters.channel} onChange={(channel) => setFilter({ channel })} />
            <AuthorMenu members={members} value={filters.author} onChange={(author) => setFilter({ author })} />
            <PeriodPopover
              preset={filters.period as PeriodPreset}
              presets={PERIOD_PRESETS}
              labels={PERIOD_LABELS}
              from={filters.from}
              to={filters.to}
              timezone={timezone}
              onApply={(next) =>
                setFilter({ period: (next.preset ?? filters.period) as PeriodPreset, from: next.from, to: next.to })
              }
            />
          </>
        }
      />

      <div data-dashboard-scroll className="min-h-0 flex-1 overflow-auto px-4 pb-24 pt-4 md:px-6">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
          {/* Franja de contexto */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1">
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {isAdmin ? "Todo el workspace" : "Solo tus leads asignados"}
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 tabular-nums">{rangeChip}</span>
            {filters.channel && (
              <Chip
                label={channels.find((c) => c.id === filters.channel)?.label ?? "Canal"}
                color={channelColor(channels.find((c) => c.id === filters.channel)?.platform ?? "")}
                onClear={() => setFilter({ channel: null })}
              />
            )}
            {filters.author && <Chip label={`Respondido por ${authorName}`} onClear={() => setFilter({ author: null })} />}
            <span className="ml-auto flex items-center gap-2">
              <Suspense key={loadKey} fallback={<span className="text-muted-foreground/80">Actualizando…</span>}>
                <UpdatedAgo promise={blocks.cards} pending={pending} />
              </Suspense>
              <RefreshButton />
            </span>
          </div>

          {setupWarning && (
            <p role="alert" className="flex items-start gap-2 rounded-[14px] border border-dashed border-bad/50 bg-card p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-bad" aria-hidden />
              {setupWarning}
            </p>
          )}

          {/* Aviso de borradores (F17) */}
          <Block key={`drafts|${loadKey}`} block="drafts" promise={blocks.drafts} label="los borradores pendientes" skeleton={null}>
            {(card) =>
              showDraftAlert({ hasDraftChannels, author: filters.author, pendingNow: card.pendingNow }) ? (
                <DraftAlert card={card} href={draftsHref} />
              ) : null
            }
          </Block>

          {/* Las cinco cifras */}
          <Block key={`cards|${loadKey}`} block="cards" promise={blocks.cards} label="los números principales" skeleton={<BlockSkeleton kind="kpis" />}>
            {(data) =>
              data.current.messagesIn + data.current.messagesOut === 0 ? (
                <EmptyState
                  channelDisconnected={Boolean(filteredChannelDisconnected)}
                  channelLabel={filteredChannelDisconnected?.label ?? waChannel?.label ?? "WhatsApp"}
                  rangeChip={rangeChip}
                  authorName={authorName}
                  onLast30={() => setFilter({ period: "30d", from: null, to: null })}
                />
              ) : (
                <KpiCards data={data} authorLabel={shortAuthorName} />
              )
            }
          </Block>

          {/* Tendencias */}
          <Block key={`trends|${loadKey}`} block="trends" promise={blocks.trends} label="las tendencias" skeleton={<BlockSkeleton kind="chart" />}>
            {(data) => <TrendsBlock data={data} filteredByAuthor={filters.author !== null} />}
          </Block>

          {/* El agente: se muestra segun el estado real del sistema (O). Oculta, completa o completa con aviso. */}
          {agentVisibility.mode !== "hidden" && (
            <SectionHeading
              title="El agente"
              subtitle="Cómo trabaja con las conversaciones nuevas"
              action={
                agentHref ? (
                  <Link href={agentHref} className="text-xs font-medium text-primary-ink underline-offset-2 hover:underline">
                    Ver runs y acciones en Agentes →
                  </Link>
                ) : null
              }
            />
          )}
          {/* Con el filtro en una persona, estos numeros no dicen nada sobre lo que se
              filtró: se avisa y no se consultan. */}
          {agentVisibility.mode !== "hidden" && authorHidesAgent && (
            <>
              {agentVisibility.warning && <AgentConnectionWarning message={agentVisibility.warning} />}
              <AgentHidden notice={hiddenAuthorNotice(authorName ?? "esa persona")} onClear={() => setFilter({ author: null })} />
            </>
          )}
          {agentSection && (
            <>
              {agentVisibility.warning && <AgentConnectionWarning message={agentVisibility.warning} />}
              <Block key={`agent|${loadKey}`} block="agent" promise={agentSection.agent} label="las métricas del agente" skeleton={<BlockSkeleton kind="cards3" />}>
                {(data) =>
                  agentSectionMode(filters.author, data.newConversations) === "no-runs" ? (
                    <AgentNoRuns agentHref={agentHref} />
                  ) : (
                    <AgentRates data={data} />
                  )
                }
              </Block>

              <div className="row2">
                <Block key={`firstResponder|${loadKey}`} block="firstResponder" promise={agentSection.firstResponder} label="quién respondió primero" skeleton={<BlockSkeleton kind="panel" />}>
                  {(data) => <FirstResponderCard data={data} />}
                </Block>
                <Block key={`escalations|${loadKey}`} block="escalations" promise={agentSection.escalations} label="por qué derivó" skeleton={<BlockSkeleton kind="panel" />}>
                  {(reasons) => <EscalationReasonsCard reasons={reasons} />}
                </Block>
              </div>

              <div className="row2">
                <Block key={`drafts|${loadKey}`} block="drafts" promise={blocks.drafts} label="la aprobación de respuestas" skeleton={<BlockSkeleton kind="panel" />}>
                  {(card) => (
                    <ApprovalCard
                      card={card}
                      channelsLabel={draftChannelsLabel}
                      hasDraftChannels={hasDraftChannels}
                      queueHref={draftsHref}
                      agentHref={agentHref}
                    />
                  )}
                </Block>
                <Block key={`actions|${loadKey}`} block="actions" promise={agentSection.actions} label="las acciones del agente" skeleton={<BlockSkeleton kind="panel" />}>
                  {(actions) => <AgentActionsCard actions={actions} actionsHref={agentActionsHref} />}
                </Block>
              </div>

              {agentSection.rules && (
                <Block key={`rules|${loadKey}`} block="rules" promise={agentSection.rules} label="los resultados de las reglas" skeleton={<BlockSkeleton kind="panel" />}>
                  {(rows) => <RuleResultsCard rows={rows} />}
                </Block>
              )}
            </>
          )}

          {/* Quién responde */}
          <SectionHeading title="Quién responde" subtitle="Tocá una fila para filtrar todo el dashboard por esa persona" />
          <DeferredBlock key={`team|${loadKey}`} block="team" label="la tabla de quién responde" skeleton={<BlockSkeleton kind="table" />}>
            {(rows) => <TeamBlock rows={rows} activeAuthor={filters.author} onPick={(author) => setFilter({ author })} />}
          </DeferredBlock>

          {/* Patrones */}
          <DeferredBlock key={`patterns|${loadKey}`} block="patterns" label="los patrones de mensajes" skeleton={<BlockSkeleton kind="table" />} refreshToken={patternsGeneration}>
            {(data) => (
              <PatternsWithReplies
                data={data}
                isAdmin={isAdmin}
                authorLabel={authorName}
                filters={filters}
                quality={
                  <DeferredBlock key={`quality|${loadKey}`} block="quality" label="la calidad de la clasificación" skeleton={null} refreshToken={patternsGeneration}>
                    {(q) => (
                      <QualityLineRow
                        lastRunAt={q.lastRunAt}
                        classifiedToday={q.classifiedToday}
                        unclassifiedPending={q.unclassifiedPending}
                        accuracyPct={q.accuracyPct}
                        reviewedCount={q.reviewedCount}
                        correctedPct={q.correctedPct}
                      />
                    )}
                  </DeferredBlock>
                }
              />
            )}
          </DeferredBlock>
        </div>
      </div>
    </div>
    </ChatBlockQueryContext.Provider>
  );
}

/**
 * "Qué le responden" se pide cuando se toca una categoria, no antes: son tantas
 * consultas como categorias y casi ninguna se mira.
 */
function PatternsWithReplies({
  data,
  isAdmin,
  authorLabel,
  filters,
  quality,
}: {
  data: PatternsBlock;
  isAdmin: boolean;
  authorLabel: string | null;
  filters: DashboardFilters;
  quality: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Lo cargado guarda de QUE categoria es: asi "esta cargando" se deduce
  // (lo elegido no coincide con lo cargado) en vez de ser otro estado que hay
  // que prender y apagar a mano.
  const [loaded, setLoaded] = useState<{ categoryId: string; data: RepliesPanel | null; error: string | null } | null>(null);
  const loading = selected !== null && loaded?.categoryId !== selected;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // Los filtros van como los tiene la URL: el servidor los vuelve a validar.
    const query = Object.fromEntries(dashboardFiltersToParams(filters).entries());
    fetchRepliesAction(selected, query).then((result) => {
      if (cancelled) return;
      setLoaded(
        result.ok
          ? { categoryId: selected, data: result.data, error: null }
          : { categoryId: selected, data: null, error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selected, filters]);

  return (
    <PatternsSection
      outbound={data.outbound}
      inbound={data.inbound}
      selectedCategoryId={selected}
      onSelectCategory={setSelected}
      replies={selected && loaded?.categoryId === selected ? loaded.data : null}
      repliesLoading={loading}
      repliesError={selected && loaded?.categoryId === selected ? loaded.error : null}
      isAdmin={isAdmin}
      authorLabel={authorLabel}
      quality={quality}
    />
  );
}

function Chip({ label, color, onClear }: { label: string; color?: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      {label}
      <button type="button" onClick={onClear} aria-label={`Quitar el filtro ${label}`} className="text-muted-foreground hover:text-foreground">
        ✕
      </button>
    </span>
  );
}

/**
 * "Actualizado hace …", contado desde que se calcularon las cifras (puede ser de la
 * cache, y entonces lo dice).
 *
 * El texto se escribe recien en el navegador: al renderizar en el servidor, ahi y
 * aca darian horas distintas y React se quejaria de la hidratacion.
 */
function UpdatedAgo({ promise, pending }: { promise: Promise<BlockResult<CardsBlock>>; pending: boolean }) {
  const result = use(promise);
  const loadedAt = result.ok ? result.loadedAt : null;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!loadedAt) return;
    const tick = () => setText(formatAgo(loadedAt));
    const timer = setInterval(tick, 60_000);
    // El primer texto va en el proximo turno del navegador: escribir estado en
    // el cuerpo del efecto encadena renders.
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [loadedAt]);

  if (pending) return <span className="text-muted-foreground/80">Actualizando…</span>;
  // Si fallaron las cifras no se dice "Actualizado": no seria cierto.
  if (!result.ok) return null;
  return <span className="text-muted-foreground/80">{text}</span>;
}

/** Vuelve a pedir todo, sin esperar a que venza lo guardado. */
function RefreshButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => refreshChatDashboardAction())}
      disabled={pending}
      aria-label="Actualizar los datos"
      className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2 py-1 font-medium transition-colors hover:bg-accent disabled:opacity-50"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden />
      Actualizar
    </button>
  );
}

function EmptyState({
  channelDisconnected,
  channelLabel,
  rangeChip,
  authorName,
  onLast30,
}: {
  channelDisconnected: boolean;
  channelLabel: string;
  rangeChip: string;
  authorName: string | null;
  onLast30: () => void;
}) {
  if (channelDisconnected) {
    return (
      <EmptyBlock
        icon={<Plug className="h-6 w-6" aria-hidden />}
        title={`${channelLabel} todavía no está conectado`}
        text={`Cuando conectes ${channelLabel}, acá vas a ver sus conversaciones y sus mensajes.`}
        action={
          <Link href="/dashboard/channels" className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
            Conectar {channelLabel}
          </Link>
        }
      />
    );
  }
  return (
    <EmptyBlock
      icon={<BarChart3 className="h-6 w-6" aria-hidden />}
      title="No hubo conversaciones en este período"
      text={`En ${rangeChip.toLowerCase()} no hubo mensajes${authorName ? ` respondidos por ${authorName}` : ""}. Probá con un período más largo o sacá algún filtro.`}
      action={
        <button type="button" onClick={onLast30} className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
          Ver últimos 30 días
        </button>
      }
    />
  );
}
