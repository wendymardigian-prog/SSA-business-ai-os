"use client";

/**
 * Los graficos del dashboard (F48, F49).
 *
 * SVG a mano, sin libreria: el dashboard de Chat ya dibuja barras con divs y
 * sumar una libreria de graficos por cuatro tarjetas es medio mega de
 * JavaScript para el navegador de alguien que solo quiere ver si subio el
 * alcance.
 *
 * La regla que define estos componentes: **un hueco se dibuja como hueco**.
 * Un punto `null` corta la linea y no dibuja barra. Unir los puntos por
 * arriba de un dia sin dato es inventar una tendencia.
 */

export interface ChartPoint {
  bucket: string;
  value: number | null;
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: ChartPoint[];
}

/** Los colores de cada red, para que una serie sea siempre del mismo color. */
export const PLATFORM_COLORS: Record<string, string> = {
  instagram: "#d946ef",
  tiktok: "#0ea5e9",
  youtube: "#ef4444",
  linkedin: "#0a66c2",
  threads: "#64748b",
};

export function colorFor(platform: string, fallback = "var(--primary)"): string {
  return PLATFORM_COLORS[platform] ?? fallback;
}

/** Los grupos de todas las series, ordenados y sin repetir. */
function bucketsOf(series: ChartSeries[]): string[] {
  return [...new Set(series.flatMap((s) => s.points.map((p) => p.bucket)))].sort();
}

function maxOf(series: ChartSeries[], stacked: boolean, buckets: string[]): number {
  if (!stacked) {
    const values = series.flatMap((s) => s.points.map((p) => p.value ?? 0));
    return Math.max(1, ...values);
  }
  const totals = buckets.map((bucket) =>
    series.reduce((sum, s) => sum + (s.points.find((p) => p.bucket === bucket)?.value ?? 0), 0),
  );
  return Math.max(1, ...totals);
}

const HEIGHT = 180;
const PADDING = { top: 8, bottom: 22, left: 0, right: 0 };

export function DualAxisChart({
  bars,
  lines,
  stacked = false,
  markers = [],
  formatBucket = (b: string) => b.slice(5),
  emptyMessage = "Todavia no hay datos para este periodo.",
}: {
  bars: ChartSeries[];
  lines: ChartSeries[];
  stacked?: boolean;
  /** Puntos bajo el eje: una publicacion. */
  markers?: Array<{ bucket: string; label: string; color: string; onSelect?: () => void }>;
  formatBucket?: (bucket: string) => string;
  emptyMessage?: string;
}) {
  const buckets = bucketsOf([...bars, ...lines]);

  if (buckets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const barMax = maxOf(bars, stacked, buckets);
  const lineMax = maxOf(lines, false, buckets);
  const slot = 100 / buckets.length;

  const y = (value: number, max: number) => PADDING.top + plotHeight - (value / max) * plotHeight;

  return (
    <div className="rounded-xl border border-border p-3">
      <svg
        viewBox={`0 0 100 ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-[180px] w-full"
        role="img"
        aria-label="Grafico de tendencias"
      >
        {/* Barras */}
        {buckets.map((bucket, index) => {
          const x = index * slot;
          let stackTop = PADDING.top + plotHeight;

          return bars.map((series, seriesIndex) => {
            const value = series.points.find((p) => p.bucket === bucket)?.value;
            // Un hueco no dibuja barra: no es una barra de altura cero.
            if (value === null || value === undefined) return null;

            const height = (value / barMax) * plotHeight;
            const width = stacked ? slot * 0.7 : (slot * 0.7) / bars.length;
            const barX = stacked ? x + slot * 0.15 : x + slot * 0.15 + seriesIndex * width;
            const barY = stacked ? stackTop - height : PADDING.top + plotHeight - height;
            if (stacked) stackTop -= height;

            return (
              <rect
                key={`${series.key}-${bucket}`}
                x={barX}
                y={barY}
                width={Math.max(width, 0.4)}
                height={Math.max(height, 0.5)}
                fill={series.color}
                opacity={0.8}
              >
                <title>{`${series.label} · ${bucket}: ${value}`}</title>
              </rect>
            );
          });
        })}

        {/* Lineas: cada tramo se corta en los huecos. */}
        {lines.map((series) => {
          const segments: string[] = [];
          let current: string[] = [];

          buckets.forEach((bucket, index) => {
            const value = series.points.find((p) => p.bucket === bucket)?.value;
            if (value === null || value === undefined) {
              if (current.length > 1) segments.push(current.join(" "));
              current = [];
              return;
            }
            current.push(`${index * slot + slot / 2},${y(value, lineMax)}`);
          });
          if (current.length > 1) segments.push(current.join(" "));

          return segments.map((points, index) => (
            <polyline
              key={`${series.key}-${index}`}
              points={points}
              fill="none"
              stroke={series.color}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ));
        })}

        {/* Puntos por publicacion, bajo el eje. */}
        {markers.map((marker, index) => {
          const bucketIndex = buckets.indexOf(marker.bucket);
          if (bucketIndex < 0) return null;
          return (
            <circle
              key={`${marker.bucket}-${index}`}
              cx={bucketIndex * slot + slot / 2}
              cy={HEIGHT - 12}
              r={2}
              fill={marker.color}
              className={marker.onSelect ? "cursor-pointer" : undefined}
              onClick={marker.onSelect}
            >
              <title>{marker.label}</title>
            </circle>
          );
        })}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatBucket(buckets[0])}</span>
        {buckets.length > 2 && <span>{formatBucket(buckets[Math.floor(buckets.length / 2)])}</span>}
        <span>{formatBucket(buckets[buckets.length - 1])}</span>
      </div>

      <ChartLegend series={[...bars, ...lines]} />
    </div>
  );
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  if (series.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Barras horizontales, para comparar formatos o redes. */
export function BarList({
  items,
  emptyMessage = "Todavia no hay datos.",
}: {
  items: Array<{ key: string; label: string; value: number | null; hint?: string }>;
  emptyMessage?: string;
}) {
  const withValue = items.filter((i) => i.value !== null);
  if (withValue.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  const max = Math.max(1, ...withValue.map((i) => i.value as number));

  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {item.value === null ? "sin dato" : item.value.toLocaleString("es-AR")}
              {item.hint ? ` · ${item.hint}` : ""}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary/70"
              style={{ width: `${item.value === null ? 0 : Math.round(((item.value as number) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
