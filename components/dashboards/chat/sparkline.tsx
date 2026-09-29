"use client";

/**
 * La mini linea de ocho semanas de las tarjetas del agente.
 *
 * SVG a mano, como el resto de los graficos del proyecto. Con una referencia
 * opcional punteada (el 85 % de aprobados sin cambios, el 90 % de precision):
 * sin ella, "64 %" no dice si va bien o mal.
 *
 * Un hueco (`null`) corta la linea: una semana sin datos no es un cero.
 */

const W = 110;
const H = 36;

export function Sparkline({
  values,
  color = "var(--c-agent)",
  goal,
  label,
}: {
  values: Array<number | null>;
  color?: string;
  /** Linea punteada de referencia, en la misma unidad que los valores. */
  goal?: number | null;
  label?: string;
}) {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (real.length < 2) {
    return <svg className="h-9 w-[110px] shrink-0" viewBox={`0 0 ${W} ${H}`} aria-hidden />;
  }

  const candidates = goal != null ? [...real, goal] : real;
  const max = Math.max(...candidates);
  const min = Math.min(...candidates) * 0.9;
  const span = max - min || 1;
  const x = (i: number) => 2 + (i * (W - 6)) / Math.max(1, values.length - 1);
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 10);

  // Tramos: cada corte por un hueco es un `polyline` propio.
  const segments: string[][] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current);
      current = [];
      return;
    }
    current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current);

  let lastIndex = -1;
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) lastIndex = i;
  });
  const lastValue = lastIndex >= 0 ? (values[lastIndex] as number) : null;

  return (
    <svg
      className="h-9 w-[110px] shrink-0"
      viewBox={`0 0 ${W} ${H}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {goal != null && (
        <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} stroke="currentColor" strokeDasharray="3 3" strokeWidth={1} className="text-muted-foreground/60" />
      )}
      {segments.map((points, i) => (
        <polyline key={i} points={points.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {lastValue !== null && (
        <circle cx={x(lastIndex)} cy={y(lastValue)} r={3.5} fill={color} stroke="var(--card)" strokeWidth={2} />
      )}
    </svg>
  );
}
