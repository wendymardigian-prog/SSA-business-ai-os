"use client";

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { DualAxisChart, colorFor, type ChartSeries } from "./charts";
import { platformLabel } from "@/lib/platforms";
import {
  buildSeries,
  canMarkPosts,
  canStack,
  DEFAULT_CONFIG,
  EXPLORER_METRICS,
  explorerConfigToParams,
  METRIC_LABELS,
  SHORTCUTS,
  type ExplorerConfig,
  type ExplorerMetric,
} from "@/lib/dashboards/explorer";
import { sumByBucket, lastByBucket, type AccountDailyRow, type PostDailyRow, type PublishedPost } from "@/lib/dashboards/content";

/**
 * El explorador de tendencias (F49).
 *
 * Dos ejes y cualquier metrica en cada uno, para la pregunta que ningun
 * grafico fijo contesta. La configuracion vive en la URL, asi que compartir
 * una vista es copiar un link.
 */
export function TrendExplorer({
  postDaily,
  accountDaily,
  posts,
  connectedPlatforms,
}: {
  postDaily: PostDailyRow[];
  accountDaily: AccountDailyRow[];
  posts: PublishedPost[];
  connectedPlatforms: string[];
}) {
  const [config, setConfig] = useState<ExplorerConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);

  const stackDecision = canStack(config.bars);
  const markDecision = canMarkPosts(config.grouping);

  const resolve = useMemo(
    () =>
      (platform: string, metric: ExplorerMetric) => {
        const postRows = postDaily.filter((r) => r.platform === platform);
        const accountRows = accountDaily.filter((r) => r.platform === platform);

        const sum = (pick: (row: PostDailyRow) => number | null) =>
          sumByBucket(postRows.map((r) => ({ date: r.date, value: pick(r) })), config.grouping);

        switch (metric) {
          case "followers":
            return lastByBucket(
              accountRows.map((r) => ({ date: r.date, value: r.followers })),
              config.grouping,
            );
          case "followers_gained":
            return sumByBucket(
              accountRows.map((r) => ({ date: r.date, value: r.followersGained })),
              config.grouping,
            );
          case "reach":
            return sum((r) => r.reach ?? r.views ?? r.impressions);
          case "likes":
            return sum((r) => r.likes);
          case "comments":
            return sum((r) => r.comments);
          case "shares":
            return sum((r) => r.shares);
          case "saves":
            return sum((r) => r.saves);
          case "interactions":
            return sum((r) => {
              const parts = [r.likes, r.comments, r.shares, r.saves].filter(
                (v): v is number => v !== null,
              );
              return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
            });
          case "posts":
            return sumByBucket(
              posts
                .filter((p) => p.platform === platform && p.publishedAt)
                .map((p) => ({ date: (p.publishedAt as string).slice(0, 10), value: 1 })),
              config.grouping,
            );
          case "engagement_d7":
            return sumByBucket(
              posts
                .filter((p) => p.platform === platform && p.publishedAt && p.engagementD7 !== null)
                .map((p) => ({ date: (p.publishedAt as string).slice(0, 10), value: p.engagementD7 })),
              config.grouping,
            );
          case "engagement_rate":
            return sum((r) => {
              const parts = [r.likes, r.comments, r.shares, r.saves].filter(
                (v): v is number => v !== null,
              );
              const denominator = r.reach ?? r.views;
              if (parts.length === 0 || !denominator) return null;
              return Number(((parts.reduce((a, b) => a + b, 0) / denominator) * 100).toFixed(2));
            });
          case "watch_time":
            return sum((r) => (typeof r.extra?.watch_time === "number" ? r.extra.watch_time : null));
          default:
            return [];
        }
      },
    [postDaily, accountDaily, posts, config.grouping],
  );

  const series = useMemo(
    () => buildSeries({ config, platforms: connectedPlatforms, resolve }),
    [config, connectedPlatforms, resolve],
  );

  const toChart = (kind: "bar" | "line"): ChartSeries[] =>
    series
      .filter((s) => s.kind === kind && !s.unavailableReason)
      .map((s) => ({
        key: `${s.kind}-${s.platform}-${s.metric}`,
        label: `${platformLabel(s.platform)} · ${METRIC_LABELS[s.metric]}`,
        color: colorFor(s.platform),
        points: s.points,
      }));

  const unavailable = series.filter((s) => s.unavailableReason);

  function copyLink() {
    const params = explorerConfigToParams(config);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Explorador de tendencias</h2>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copiado" : "Copiar link"}
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.key}
            type="button"
            onClick={() => setConfig((c) => ({ ...c, ...shortcut.config }))}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-accent/50"
          >
            {shortcut.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs">
          Barras
          <select
            value={config.bars}
            onChange={(e) => setConfig((c) => ({ ...c, bars: e.target.value as ExplorerMetric }))}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {EXPLORER_METRICS.map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_LABELS[metric]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs">
          Lineas
          <select
            value={config.lines}
            onChange={(e) => setConfig((c) => ({ ...c, lines: e.target.value as ExplorerMetric }))}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {EXPLORER_METRICS.map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_LABELS[metric]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs">
          Agrupar
          <select
            value={config.grouping}
            onChange={(e) =>
              setConfig((c) => ({ ...c, grouping: e.target.value as ExplorerConfig["grouping"] }))
            }
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </label>

        <label
          className="flex items-center gap-1 text-xs"
          title={stackDecision.reason}
        >
          <input
            type="checkbox"
            checked={config.barMode === "stacked"}
            disabled={!stackDecision.allowed}
            onChange={(e) =>
              setConfig((c) => ({ ...c, barMode: e.target.checked ? "stacked" : "grouped" }))
            }
            className="h-3.5 w-3.5"
          />
          Apilar barras
        </label>

        <label className="flex items-center gap-1 text-xs" title={markDecision.reason}>
          <input
            type="checkbox"
            checked={config.markPosts}
            disabled={!markDecision.allowed}
            onChange={(e) => setConfig((c) => ({ ...c, markPosts: e.target.checked }))}
            className="h-3.5 w-3.5"
          />
          Marcar publicaciones
        </label>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {connectedPlatforms.map((platform) => {
          const active = config.platforms.length === 0 || config.platforms.includes(platform);
          return (
            <button
              key={platform}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  platforms: c.platforms.includes(platform)
                    ? c.platforms.filter((p) => p !== platform)
                    : [...c.platforms, platform],
                }))
              }
              className={
                active
                  ? "rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  : "rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
              }
              style={active ? { borderColor: colorFor(platform) } : undefined}
            >
              {platformLabel(platform)}
            </button>
          );
        })}
      </div>

      <DualAxisChart
        bars={toChart("bar")}
        lines={toChart("line")}
        stacked={config.barMode === "stacked" && stackDecision.allowed}
        markers={
          config.markPosts
            ? posts
                .filter((p) => p.publishedAt)
                .map((p) => ({
                  bucket: (p.publishedAt as string).slice(0, 10),
                  label: `${platformLabel(p.platform)} · ${p.mediaType ?? "publicacion"}`,
                  color: colorFor(p.platform),
                }))
            : []
        }
      />

      {(!stackDecision.allowed || unavailable.length > 0) && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {!stackDecision.allowed && <li>{stackDecision.reason}</li>}
          {unavailable.map((s) => (
            <li key={`${s.platform}-${s.metric}`}>{s.unavailableReason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
