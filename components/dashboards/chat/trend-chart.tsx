"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChartLegend, type ChartSeries } from "@/components/dashboards/charts";
import { axisTicks, axisTop, labelEvery, niceStep } from "@/lib/dashboards/chat/scale";

/**
 * El grafico de Tendencias del dashboard de Chat (F16).
 *
 * Cuatro formas con un solo componente, porque las cuatro pestañas comparten
 * ejes, grilla, tooltip y leyenda: barras simples, barras agrupadas, barras
 * apiladas (con 2 px de separacion, como el prototipo) y una linea con una
 * referencia punteada en 1 hora.
 *
 * SVG a mano, sin libreria, igual que `DualAxisChart`. La diferencia es que
 * este si dibuja los ejes y tiene tooltip por columna: sin numeros en el eje,
 * una barra no se puede leer.
 *
 * Un hueco se dibuja como hueco: un `null` corta la linea y no dibuja barra.
 */

const W = 1000;
const H = 240;
const L = 44; // lugar para los numeros del eje
const B = 26; // lugar para las fechas
const T = 12;

export type TrendMode = "single" | "group" | "stack" | "line";

/**
 * Envuelve una barra o un tramo en un `<a>` cuando hay href (A4): un SVG `<a>`
 * con `href` es un link real, con clic derecho y abrir en pestaña nueva
 * incluidos. Sin href, un `Fragment` deja el DOM igual que antes de este prop.
 */
function wrapWithLink(key: string, href: string | null | undefined, node: ReactNode): ReactNode {
  if (!href) return <Fragment key={key}>{node}</Fragment>;
  return (
    <a key={key} href={href} className="cursor-pointer">
      {node}
    </a>
  );
}

export interface TrendPoint {
  /** Clave del grupo (un dia o una semana), ya formateada para el eje. */
  bucket: string;
  /** Lo que dice el tooltip arriba ("miércoles 24 sept", "Semana 22 – 28 sept"). */
  label: string;
}

export function TrendChart({
  points,
  series,
  mode,
  formatValue = (v) => Math.round(v).toLocaleString("es-AR"),
  formatAxis,
  reference,
  ariaLabel,
  footer,
  hrefFor,
}: {
  points: TrendPoint[];
  series: ChartSeries[];
  mode: TrendMode;
  /** Como se lee un valor en el tooltip. */
  formatValue?: (value: number) => string;
  /** Como se lee un valor en el eje (por defecto, igual que en el tooltip). */
  formatAxis?: (value: number) => string;
  /** Linea punteada de referencia: la hora en "Primera respuesta". */
  reference?: { value: number; label: string; color?: string } | null;
  ariaLabel: string;
  footer?: ReactNode;
  /**
   * Opcional (Bloque A, A4): a donde lleva un clic en una barra o, en modo
   * "stack", en uno de sus tramos (`seriesKey` presente). `null`/`undefined`
   * deja esa marca sin link. Sin este prop el grafico se comporta exactamente
   * igual que antes: nada se envuelve en un `<a>`.
   */
  hrefFor?: (index: number, seriesKey?: string) => string | null | undefined;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const n = points.length;
  if (n === 0) return null;

  const valueAt = (s: ChartSeries, i: number): number | null => {
    const p = s.points[i];
    return p === undefined ? null : p.value;
  };

  const maxOf = (i: number): number =>
    mode === "stack"
      ? series.reduce((sum, s) => sum + (valueAt(s, i) ?? 0), 0)
      : Math.max(...series.map((s) => valueAt(s, i) ?? 0));

  const rawMax = Math.max(1, ...points.map((_, i) => maxOf(i)), reference?.value ?? 0);
  const step = niceStep(rawMax);
  const top = axisTop(rawMax, step);

  const plot = H - T - B;
  const y = (v: number) => T + plot * (1 - v / top);
  const cw = (W - L) / n;
  const axisFmt = formatAxis ?? formatValue;

  const every = labelEvery(n);

  const barWidth =
    mode === "group"
      ? Math.max(2, Math.min(12, cw * 0.34))
      : Math.max(3, Math.min(22, cw * 0.62));

  const ticks = axisTicks(top, step);

  return (
    <div className="relative px-1.5 pb-3 pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={ariaLabel}>
        {/* Grilla y numeros del eje */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {axisFmt(v)}
            </text>
          </g>
        ))}

        {/* Fechas */}
        {points.map((p, i) =>
          i % every === 0 ? (
            <text key={p.bucket} x={L + cw * i + cw / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {p.bucket}
            </text>
          ) : null,
        )}

        {reference && (
          <line
            x1={L}
            x2={W}
            y1={y(reference.value)}
            y2={y(reference.value)}
            stroke={reference.color ?? "var(--warn)"}
            strokeDasharray="4 4"
            strokeWidth={1.2}
          />
        )}

        {/* Las series */}
        {mode === "line"
          ? series.map((s) => {
              const segments: string[][] = [];
              let cur: string[] = [];
              points.forEach((_, i) => {
                const v = valueAt(s, i);
                if (v === null) {
                  if (cur.length > 1) segments.push(cur);
                  cur = [];
                  return;
                }
                cur.push(`${(L + cw * i + cw / 2).toFixed(1)},${y(v).toFixed(1)}`);
              });
              if (cur.length > 1) segments.push(cur);
              return segments.map((seg, k) => (
                <polyline key={`${s.key}-${k}`} points={seg.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              ));
            })
          : points.map((p, i) => {
              const cx = L + cw * i + cw / 2;
              if (mode === "single") {
                const v = valueAt(series[0], i);
                if (v === null || v <= 0) return null;
                const bar = (
                  <rect x={cx - barWidth / 2} y={y(v)} width={barWidth} height={Math.max(0, y(0) - y(v))} rx={Math.min(4, barWidth / 3)} fill={series[0].color} />
                );
                return wrapWithLink(p.bucket, hrefFor?.(i, series[0].key), bar);
              }
              if (mode === "group") {
                return series.map((s, j) => {
                  const v = valueAt(s, i);
                  if (v === null || v <= 0) return null;
                  const bar = (
                    <rect
                      x={j ? cx + 1 : cx - barWidth - 1}
                      y={y(v)}
                      width={barWidth}
                      height={Math.max(0, y(0) - y(v))}
                      rx={Math.min(3, barWidth / 3)}
                      fill={s.color}
                    />
                  );
                  return wrapWithLink(`${s.key}-${p.bucket}`, hrefFor?.(i, s.key), bar);
                });
              }
              // Apiladas: 2 px de separacion entre tramos, como el prototipo.
              let acc = 0;
              const visible = series.filter((s) => (valueAt(s, i) ?? 0) > 0);
              return visible.map((s, j) => {
                const v = valueAt(s, i) as number;
                const y1 = y(acc + v);
                const y0 = y(acc);
                const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                acc += v;
                const bar = (
                  <rect
                    x={cx - barWidth / 2}
                    y={y1}
                    width={barWidth}
                    height={h}
                    rx={j === visible.length - 1 ? Math.min(3, barWidth / 3) : 0}
                    fill={s.color}
                  />
                );
                return wrapWithLink(`${s.key}-${p.bucket}`, hrefFor?.(i, s.key), bar);
              });
            })}

        {/* Cruz vertical de la columna apuntada */}
        {hover !== null && (
          <line x1={L + cw * hover + cw / 2} x2={L + cw * hover + cw / 2} y1={T} y2={H - B} stroke="var(--grid)" strokeWidth={1} />
        )}

        {/* Zonas sensibles: una por columna, del alto del grafico */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.bucket}`}
            x={L + cw * i}
            y={T}
            width={cw}
            height={plot}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            onBlur={() => setHover((h) => (h === i ? null : h))}
            tabIndex={0}
            role="button"
            aria-label={`${p.label}: ${series.map((s) => `${s.label} ${valueAt(s, i) === null ? "sin datos" : formatValue(valueAt(s, i) as number)}`).join(", ")}`}
          />
        ))}
      </svg>

      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-[170px] rounded-[10px] border border-border bg-popover p-2.5 text-xs shadow-lg"
          // Sigue a la columna: a la derecha, salvo en la ultima mitad, donde se
          // da vuelta para no salirse de la tarjeta.
          style={hover < points.length / 2 ? { left: `${((L + cw * hover + cw) / W) * 100}%` } : { right: `${(1 - (L + cw * hover) / W) * 100}%` }}
        >
          <p className="mb-1 font-semibold">{points[hover].label}</p>
          {series.map((s) => {
            const v = valueAt(s, hover);
            return (
              <p key={s.key} className="flex items-center justify-between gap-3.5 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
                  {s.label}
                </span>
                <b className="font-semibold text-foreground tabular-nums">{v === null ? "sin datos" : formatValue(v)}</b>
              </p>
            );
          })}
        </div>
      )}

      {series.length > 1 || reference ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-2">
          <ChartLegend series={series} />
          {reference && (
            <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-block w-3.5 border-t border-dashed" style={{ borderColor: reference.color ?? "var(--warn)" }} aria-hidden />
              {reference.label}
            </span>
          )}
        </div>
      ) : null}
      {footer}
    </div>
  );
}
