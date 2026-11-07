"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadFlowNodeMetrics } from "@/lib/actions/flow-runs";
import {
  METRIC_PERIODS,
  badgeText,
  clickKeyLabel,
  exitLabel,
  formatCount,
  isMetricPeriod,
  percent,
  type MetricPeriod,
  type NodeMetrics,
} from "@/lib/flows/node-metrics";

/**
 * Las metricas de cada paso sobre el lienzo (00316). Viven en un contexto y NUNCA en `node.data`: si estuvieran en el
 * nodo, el lienzo las veria como «cambios sin guardar» y se guardarian con el flujo.
 *
 * Apagadas no consultan nada. Prendidas, una sola consulta por periodo (`flow_node_stats`, con la RLS de quien mira).
 */

interface FlowMetricsState {
  flowId: string;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  period: MetricPeriod;
  setPeriod: (value: MetricPeriod) => void;
  metrics: Record<string, NodeMetrics> | null;
  loading: boolean;
  error: string | null;
}

const FlowMetricsContext = createContext<FlowMetricsState | null>(null);

const STORAGE_KEY = "flow-metrics-period";

function savedPeriod(): MetricPeriod {
  try {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    return isMetricPeriod(saved) ? saved : "30d";
  } catch {
    // Sin localStorage: el periodo por defecto.
    return "30d";
  }
}

export function FlowMetricsProvider({ flowId, children }: { flowId: string; children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  // Al principio esta apagado: el periodo guardado no se ve hasta que se prende (no hay diferencia con el servidor).
  const [period, setPeriodState] = useState<MetricPeriod>(savedPeriod);
  // El resultado lleva el periodo que se pidio: «cargando» es que todavia no llego el del periodo elegido.
  const [result, setResult] = useState<{ period: MetricPeriod; metrics: Record<string, NodeMetrics> | null; error: string | null } | null>(null);

  const setPeriod = (value: MetricPeriod) => {
    setPeriodState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Sin localStorage: no se recuerda, y esta bien.
    }
  };

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadFlowNodeMetrics({ flowId, period })
      .then((r) => {
        if (alive) setResult(r.ok ? { period, metrics: r.metrics, error: null } : { period, metrics: null, error: r.error });
      })
      .catch(() => {
        if (alive) setResult({ period, metrics: null, error: "No pude leer las métricas. Probá de nuevo en un rato." });
      });
    return () => {
      alive = false;
    };
  }, [enabled, period, flowId]);

  const current = result?.period === period ? result : null;
  const value: FlowMetricsState = {
    flowId,
    enabled,
    setEnabled,
    period,
    setPeriod,
    metrics: current?.metrics ?? null,
    loading: enabled && !current,
    error: current?.error ?? null,
  };

  return <FlowMetricsContext.Provider value={value}>{children}</FlowMetricsContext.Provider>;
}

export function useFlowMetrics(): FlowMetricsState | null {
  return useContext(FlowMetricsContext);
}

/** El boton «Métricas» de la barra del editor y, prendido, el periodo. */
export function FlowMetricsToggle() {
  const state = useFlowMetrics();
  if (!state) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => state.setEnabled(!state.enabled)}
        aria-pressed={state.enabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
          state.enabled ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border bg-background hover:bg-accent",
        )}
        title="Métricas: cuántas personas pasaron por cada paso, cuántas fallaron, los clics y las respuestas"
        aria-label="Métricas"
      >
        {state.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
        <span className="hidden 2xl:inline">Métricas</span>
      </button>
      {state.enabled && (
        <select
          value={state.period}
          onChange={(e) => isMetricPeriod(e.target.value) && state.setPeriod(e.target.value)}
          aria-label="Período de las métricas"
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        >
          {METRIC_PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** El aviso de error de las metricas, arriba del lienzo. */
export function FlowMetricsError() {
  const state = useFlowMetrics();
  if (!state?.enabled || !state.error) return null;
  return (
    <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      {state.error}
    </div>
  );
}

/**
 * La insignia de un paso con sus metricas. Un clic abre el detalle (sin abrir el panel de configuracion del paso).
 * Sin metricas prendidas, o sin nadie que haya pasado, no dibuja nada.
 */
export function NodeMetricsBadge({ nodeId, data }: { nodeId: string; data?: Record<string, unknown> }) {
  const state = useFlowMetrics();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!state?.enabled || !state.metrics) return null;
  const m = state.metrics[nodeId];
  const text = badgeText(m);

  return (
    <div ref={ref} className="nodrag nowheel relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
          !text
            ? "border-border bg-muted text-muted-foreground"
            : m && m.failed > 0
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
              : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100",
        )}
        title="Ver las métricas de este paso"
      >
        {text ?? "0"}
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Métricas del paso"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-3 text-left text-xs text-popover-foreground shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Métricas del paso</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded p-0.5 text-muted-foreground hover:bg-accent">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <NodeMetricsDetail metrics={m} data={data} flowId={state.flowId} nodeId={nodeId} />
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">
        {value}
        {hint && <span className="ml-1 font-normal text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

function NodeMetricsDetail({ metrics: m, data, flowId, nodeId }: { metrics: NodeMetrics | undefined; data?: Record<string, unknown>; flowId: string; nodeId: string }) {
  if (!m || m.passed === 0) return <p className="text-muted-foreground">Nadie pasó por este paso en este período.</p>;
  const buttons = Array.isArray(data?.buttons) ? (data!.buttons as Array<{ title?: unknown }>) : undefined;
  const hasButtons = (buttons?.length ?? 0) > 0;
  const tracking = (data?.attribution as { trackClicks?: unknown } | undefined)?.trackClicks === true;
  const exits = Object.entries(m.exits);

  return (
    <div className="space-y-2">
      <div>
        <Row label="Pasaron" value={formatCount(m.passed)} />
        <Row label="Salieron bien" value={formatCount(m.ok)} hint={percent(m.ok, m.passed)} />
        {m.failed > 0 && <Row label="Fallaron" value={formatCount(m.failed)} hint={percent(m.failed, m.passed)} />}
        {m.skipped > 0 && <Row label="Se saltearon" value={formatCount(m.skipped)} />}
        {m.waiting > 0 && <Row label="Esperando" value={formatCount(m.waiting)} />}
        {m.deferred > 0 && <Row label="Para reintentar" value={formatCount(m.deferred)} />}
      </div>

      {m.failed > 0 && m.failedReasons.length > 0 && (
        <div className="rounded-md bg-red-50 p-2 dark:bg-red-950/30">
          <p className="mb-1 font-medium text-red-900 dark:text-red-200">Por qué fallaron</p>
          <ul className="space-y-1">
            {m.failedReasons.slice(0, 3).map((r) => (
              <li key={r.reason} className="text-red-900 dark:text-red-200">
                {formatCount(r.count)} · {r.reason}
              </li>
            ))}
          </ul>
          <Link href={`/dashboard/flows/${flowId}/ejecuciones?paso_fallido=${encodeURIComponent(nodeId)}`} className="mt-1.5 inline-block font-medium text-red-900 underline underline-offset-2 dark:text-red-200">
            Ver las que fallaron
          </Link>
        </div>
      )}

      {m.sent > 0 && (
        <div className="border-t border-border pt-2">
          <Row label="Mensajes enviados" value={formatCount(m.sent)} />
          <Row label="Respondieron (24 h)" value={formatCount(m.replied)} hint={percent(m.replied, m.sent)} />
        </div>
      )}

      {(hasButtons || m.clicks.length > 0) && (
        <div className="border-t border-border pt-2">
          {m.clicks.length > 0 ? (
            <>
              <Row label="Personas que hicieron clic" value={formatCount(m.clickersAny)} hint={percent(m.clickersAny, m.sent || m.ok)} />
              {m.clicks.map((c) => (
                <Row key={c.key} label={clickKeyLabel(c.key, buttons)} value={`${formatCount(c.people)} personas`} hint={`${formatCount(c.total)} clics`} />
              ))}
            </>
          ) : tracking ? (
            <p className="text-muted-foreground">Todavía nadie tocó los botones.</p>
          ) : (
            <p className="text-muted-foreground">Para contar los clics de los botones, prendé «Registrar el clic» en «Atribución de links» de este paso.</p>
          )}
        </div>
      )}

      {m.emailSent > 0 && (
        <div className="border-t border-border pt-2">
          <Row label="Emails enviados" value={formatCount(m.emailSent)} />
          <Row label="Abiertos" value={formatCount(m.emailOpened)} hint={percent(m.emailOpened, m.emailSent)} />
          <Row label="Con clic" value={formatCount(m.emailClicked)} hint={percent(m.emailClicked, m.emailSent)} />
        </div>
      )}

      {exits.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="mb-1 font-medium">Por dónde siguieron</p>
          {exits.map(([handle, count]) => (
            <Row key={handle} label={pathName(handle, data)} value={formatCount(count)} hint={percent(count, m.passed)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** El nombre de un camino de «Condiciones» o de un A/B por su id; si no, el nombre generico de la salida. */
function pathName(handle: string, data?: Record<string, unknown>): string {
  const paths = Array.isArray(data?.paths) ? (data!.paths as Array<{ id?: unknown; label?: unknown; name?: unknown }>) : [];
  const split = /^split-(\d+)$/.exec(handle);
  const path = split ? paths[Number(split[1])] : paths.find((p) => p?.id === handle);
  const label = typeof path?.label === "string" && path.label.trim() ? path.label : typeof path?.name === "string" && path.name.trim() ? path.name : null;
  return label ?? exitLabel(handle);
}
