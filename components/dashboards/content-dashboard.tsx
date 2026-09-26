"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "./dashboard-switcher";
import { BarList, DualAxisChart, colorFor, type ChartSeries } from "./charts";
import { TrendExplorer } from "./trend-explorer";
import { PostsTable, toRows } from "./posts-table";
import { PostAnalysisPanel } from "./post-analysis-panel";
import { refreshMetricsNow } from "@/lib/actions/metrics";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import { platformLabel } from "@/lib/platforms";
import {
  computeKpis,
  followerGrowth,
  formatPerformance,
  freshness,
  publishActivity,
  sumByBucket,
  unavailableMetricsNote,
  weeklyD7,
  type AccountDailyRow,
  type Grouping,
  type PostDailyRow,
  type PublishedPost,
} from "@/lib/dashboards/content";

/**
 * El dashboard de contenido organico (F48, F50, F53).
 *
 * Todas las cuentas salen de `lib/dashboards/content.ts`, que es puro. Aca
 * solo se elige que mostrar y se dibuja.
 *
 * Cada seccion tiene su propio estado vacio con una frase que dice por que
 * esta vacia. Una tarjeta en cero se lee como "no funciono"; una que dice
 * "todavia no hay datos" se lee como lo que es.
 */

export interface ContentDashboardProps {
  posts: PublishedPost[];
  postDaily: PostDailyRow[];
  accountDaily: AccountDailyRow[];
  latestByPost: Array<[string, PostDailyRow]>;
  previous: { posts: PublishedPost[]; postDaily: PostDailyRow[]; accountDaily: AccountDailyRow[] };
  accounts: Array<{ platform: string; syncedAt: string | null; error: string | null }>;
  lastDataByPlatform: Array<[string, string]>;
  /** El caption y la miniatura de cada publicacion, para la tabla. */
  postDetails: Array<[string, { caption: string | null; thumbnailUrl: string | null }]>;
  connectedPlatforms: string[];
  period: PeriodPreset;
  platform: string | null;
  canRefresh: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  reel: "Reel",
  carousel: "Carrusel",
  image: "Imagen",
  story: "Story",
  video: "Video",
  short: "Short",
  text: "Texto",
  document: "Documento",
  otro: "Sin formato",
};

export function ContentDashboard(props: ContentDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const [growthGrouping, setGrowthGrouping] = useState<Grouping>("day");
  const [activityGrouping, setActivityGrouping] = useState<Grouping>("week");
  const [engagementMetric, setEngagementMetric] = useState<"saves" | "shares" | "comments" | "likes">("saves");
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  const latestByPost = useMemo(() => new Map(props.latestByPost), [props.latestByPost]);
  const lastDataByPlatform = useMemo(() => new Map(props.lastDataByPlatform), [props.lastDataByPlatform]);
  const now = useMemo(() => new Date(), []);

  const kpis = useMemo(
    () =>
      computeKpis({
        posts: props.posts,
        postDaily: props.postDaily,
        accountDaily: props.accountDaily,
        previous: props.previous,
      }),
    [props.posts, props.postDaily, props.accountDaily, props.previous],
  );

  const growth = useMemo(
    () => followerGrowth(props.accountDaily, growthGrouping),
    [props.accountDaily, growthGrouping],
  );

  const activity = useMemo(
    () => publishActivity(props.posts, activityGrouping),
    [props.posts, activityGrouping],
  );

  const formats = useMemo(
    () => formatPerformance(props.posts, latestByPost),
    [props.posts, latestByPost],
  );

  const d7 = useMemo(() => weeklyD7(props.posts, now), [props.posts, now]);

  const tableRows = useMemo(
    () => toRows(props.posts, latestByPost, new Map(props.postDetails)),
    [props.posts, latestByPost, props.postDetails],
  );

  /** El orden de la tabla manda para las flechas del panel. */
  const openIndex = openPostId ? tableRows.findIndex((r) => r.socialPostId === openPostId) : -1;

  const fresh = useMemo(
    () => freshness(props.accounts, lastDataByPlatform, now),
    [props.accounts, lastDataByPlatform, now],
  );

  const unavailable = props.platform
    ? unavailableMetricsNote(props.platform, props.posts.length)
    : null;

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/dashboard/dashboards/content?${params.toString()}`);
  }

  function refresh() {
    setNotice(null);
    start(async () => {
      const result = await refreshMetricsNow();
      setNotice(
        result.ok
          ? "Se esta actualizando. Recarga en un minuto para ver los datos nuevos."
          : result.error,
      );
    });
  }

  const growthSeries: ChartSeries[] = [
    {
      key: "gained",
      label: "Ganados",
      color: "#10b981",
      points: growth.map((g) => ({ bucket: g.bucket, value: g.gained })),
    },
    {
      key: "lost",
      label: "Perdidos",
      color: "#f43f5e",
      points: growth.map((g) => ({ bucket: g.bucket, value: g.lost })),
    },
  ];

  const totalSeries: ChartSeries[] = [
    {
      key: "total",
      label: "Total de seguidores",
      color: "#6366f1",
      points: growth.map((g) => ({ bucket: g.bucket, value: g.total })),
    },
  ];

  const formatsInActivity = [...new Set(activity.flatMap((a) => Object.keys(a.byFormat)))];
  const activitySeries: ChartSeries[] = formatsInActivity.map((format, index) => ({
    key: format,
    label: FORMAT_LABELS[format] ?? format,
    color: ["#6366f1", "#d946ef", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444"][index % 6],
    points: activity.map((a) => ({ bucket: a.bucket, value: a.byFormat[format] ?? null })),
  }));

  const engagementSeries: ChartSeries[] = [
    {
      key: engagementMetric,
      label: { saves: "Guardados", shares: "Compartidos", comments: "Comentarios", likes: "Me gusta" }[
        engagementMetric
      ],
      color: "#6366f1",
      points: sumByBucket(
        props.postDaily.map((r) => ({ date: r.date, value: r[engagementMetric] })),
        "day",
      ),
    },
  ];

  const d7Platforms = [...new Set(d7.flatMap((w) => Object.keys(w.byPlatform)))];
  const d7Series: ChartSeries[] = d7Platforms.map((platform) => ({
    key: platform,
    label: platformLabel(platform),
    color: colorFor(platform),
    points: d7.map((w) => ({ bucket: w.week, value: w.byPlatform[platform] ?? null })),
  }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/content"
        left={<DashboardSwitcher />}
        right={
          <div className="flex items-center gap-2">
            <select
              aria-label="Red"
              value={props.platform ?? "all"}
              onChange={(e) => setParam("red", e.target.value === "all" ? null : e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="all">Todas las redes</option>
              {props.connectedPlatforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platformLabel(platform)}
                </option>
              ))}
            </select>
            <select
              aria-label="Periodo"
              value={props.period}
              onChange={(e) => setParam("periodo", e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {PERIOD_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {PERIOD_LABELS[preset]}
                </option>
              ))}
            </select>
            {props.canRefresh && (
              <button
                type="button"
                onClick={refresh}
                disabled={pending}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                Actualizar ahora
              </button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {notice && (
          <p role="status" className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        {unavailable && (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {unavailable}
          </p>
        )}

        {/* Datos al dia (F53) */}
        {fresh.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {fresh.map((row) => (
              <li key={row.platform} className={row.error ? "text-amber-600 dark:text-amber-400" : undefined}>
                <span className="font-medium">{platformLabel(row.platform)}:</span> {row.label}
              </li>
            ))}
          </ul>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpis.map((kpi) => (
            <div key={kpi.key} className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {kpi.value === null ? "—" : kpi.value.toLocaleString("es-AR")}
              </p>
              {kpi.changePercent !== null && (
                <p className="text-xs text-muted-foreground">
                  {kpi.changePercent > 0 ? "▲" : kpi.changePercent < 0 ? "▼" : "="}{" "}
                  {Math.abs(kpi.changePercent)}% vs. periodo anterior
                </p>
              )}
            </div>
          ))}
        </div>

        <Section
          title="Crecimiento de seguidores"
          grouping={growthGrouping}
          onGrouping={setGrowthGrouping}
        >
          <DualAxisChart
            bars={growthSeries}
            lines={totalSeries}
            emptyMessage="Todavia no hay seguidores registrados. La serie empieza el dia que se conecta cada cuenta."
          />
        </Section>

        <Section
          title="Actividad de publicacion"
          grouping={activityGrouping}
          onGrouping={setActivityGrouping}
        >
          <DualAxisChart
            bars={activitySeries}
            lines={[]}
            stacked
            emptyMessage="No se publico nada en este periodo."
          />
        </Section>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Engagement en el tiempo</h2>
            <select
              aria-label="Metrica"
              value={engagementMetric}
              onChange={(e) => setEngagementMetric(e.target.value as typeof engagementMetric)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="saves">Guardados</option>
              <option value="shares">Compartidos</option>
              <option value="comments">Comentarios</option>
              <option value="likes">Me gusta</option>
            </select>
          </div>
          <DualAxisChart bars={engagementSeries} lines={[]} />
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Rendimiento por formato</h2>
          <div className="rounded-xl border border-border p-3">
            <BarList
              items={formats.map((f) => ({
                key: f.format,
                label: `${FORMAT_LABELS[f.format] ?? f.format} (${f.posts})`,
                value: f.avgReach,
                hint: f.avgEngagement !== null ? `${f.avgEngagement}% engagement` : undefined,
              }))}
              emptyMessage="Todavia no hay publicaciones con metricas."
            />
          </div>
        </section>

        <TrendExplorer
          postDaily={props.postDaily}
          accountDaily={props.accountDaily}
          posts={props.posts}
          connectedPlatforms={props.connectedPlatforms}
        />

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Engagement a 7 dias, por semana de publicacion</h2>
          <DualAxisChart
            bars={[]}
            lines={d7Series}
            formatBucket={(b) => `sem. ${b.slice(5)}`}
            emptyMessage="Todavia no hay piezas que hayan cumplido 7 dias."
          />
          {d7.some((w) => w.inProgress) && (
            <p className="mt-1 text-xs text-muted-foreground">
              La ultima semana esta en curso: sus piezas todavia no cumplieron 7 dias y el promedio va a subir.
            </p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Tus posts</h2>
          <PostsTable rows={tableRows} onOpen={setOpenPostId} />
        </section>
      </div>

      {openPostId && (
        <PostAnalysisPanel
          socialPostId={openPostId}
          onClose={() => setOpenPostId(null)}
          onPrevious={
            openIndex > 0 ? () => setOpenPostId(tableRows[openIndex - 1].socialPostId) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < tableRows.length - 1
              ? () => setOpenPostId(tableRows[openIndex + 1].socialPostId)
              : undefined
          }
        />
      )}
    </div>
  );
}

function Section({
  title,
  grouping,
  onGrouping,
  children,
}: {
  title: string;
  grouping: Grouping;
  onGrouping: (g: Grouping) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex gap-1" role="group" aria-label={`Agrupar ${title}`}>
          {(["day", "week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onGrouping(option)}
              aria-pressed={grouping === option}
              className={
                grouping === option
                  ? "rounded-md bg-accent px-2 py-0.5 text-xs font-medium"
                  : "rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50"
              }
            >
              {{ day: "Dia", week: "Semana", month: "Mes" }[option]}
            </button>
          ))}
        </div>
      </div>
      {children}
    </section>
  );
}
