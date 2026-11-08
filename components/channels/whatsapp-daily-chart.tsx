"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { loadWhatsappDailyMessages } from "@/lib/actions/whatsapp-stats";
import { SENT_KINDS, dailyTotals, niceMax, projectedTotal, type DailyPoint } from "@/lib/whatsapp-stats/daily";

/**
 * Mensajes por día de un número de WhatsApp (00348/00349), en la sección Historial de su tarjeta: los últimos 30 días y
 * lo programado para los próximos 7.
 *
 * Dos gráficos con su propia escala (nunca dos medidas en un eje): arriba los ENVIADOS, apilados por quién los mandó
 * (lo que mira WhatsApp para bloquear un número), con lo programado como barra punteada sin relleno; abajo los
 * RECIBIDOS en chats privados. Los colores son fijos por origen. Pasar el mouse (o tocar) un día abre un recuadro con
 * todos sus números.
 */

const CHART_HEIGHT = 120;
const RECEIVED_HEIGHT = 56;

export function WhatsappDailyChart({ channelId }: { channelId: string }) {
  const [series, setSeries] = useState<DailyPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    loadWhatsappDailyMessages(channelId).then((res) => {
      if (!alive) return;
      if (res.ok) setSeries(res.series);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [channelId]);

  if (error) return <p className="text-red-700 dark:text-red-300">{error}</p>;
  if (!series) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando el gráfico" />;

  const totals = dailyTotals(series);
  const sentMax = niceMax(Math.max(...series.map((p) => p.sent + projectedTotal(p.projected))));
  const receivedMax = niceMax(Math.max(...series.map((p) => p.received)));
  const firstFuture = series.findIndex((p) => p.future);

  return (
    <div className="wa-daily space-y-2">
      <style>{PALETTE_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <p className="font-semibold text-foreground">Mensajes enviados · últimos 30 días</p>
        <p className="text-muted-foreground">
          {totals.sent} en total · {formatAvg(totals.avgSent)} por día
          {totals.maxSentDay ? ` · el día más alto: ${totals.maxSentDay.sent} (${totals.maxSentDay.label})` : ""}
          {totals.projected > 0 ? ` · ${totals.projected} programados para los próximos días` : ""}
        </p>
      </div>

      {totals.sent === 0 && totals.received === 0 && totals.projected === 0 ? (
        <p className="text-muted-foreground">Todavía no hay mensajes de este número en los últimos 30 días ni programados.</p>
      ) : (
        <>
          <Bars
            series={series}
            max={sentMax}
            height={CHART_HEIGHT}
            active={active}
            onActive={setActive}
            firstFuture={firstFuture}
            segments={(p) => SENT_KINDS.map((k) => ({ value: p[k.key], color: k.color }))}
            projected={(p) => projectedTotal(p.projected)}
            tooltip={(p) => <SentTooltip point={p} />}
          />

          <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Quién los mandó">
            {SENT_KINDS.map((kind) => (
              <li key={kind.key} className="flex items-center gap-1.5" title={kind.hint}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: kind.color }} aria-hidden />
                <span className="text-foreground">{kind.label}</span>
                <span className="tabular-nums text-muted-foreground">{totals.byKind[kind.key]}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5" title="Broadcasts en cola, pasos de secuencias y automatizaciones programadas a grupos">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed" style={{ borderColor: "var(--wa-projected)" }} aria-hidden />
              <span className="text-foreground">Programado</span>
              <span className="tabular-nums text-muted-foreground">{totals.projected}</span>
            </li>
          </ul>

          <p className="pt-1 font-semibold text-foreground">
            Mensajes recibidos en chats <span className="font-normal text-muted-foreground">· {totals.received} en total</span>
          </p>
          <Bars
            series={series}
            max={receivedMax}
            height={RECEIVED_HEIGHT}
            active={active}
            onActive={setActive}
            firstFuture={firstFuture}
            segments={(p) => [{ value: p.received, color: "var(--wa-received)" }]}
            projected={() => 0}
            tooltip={(p) => (
              <>
                <p className="font-semibold">{p.label}</p>
                <p className="tabular-nums">{p.future ? "Todavía no llegó" : `${p.received} recibidos`}</p>
              </>
            )}
          />

          <p className="text-muted-foreground">
            Los mensajes a grupos cuentan como enviados (para WhatsApp es lo mismo). Los recibidos son solo de chats privados. Lo
            programado es una estimación con el ritmo de envíos del número.
          </p>

          <table className="sr-only">
            <caption>Mensajes por día: últimos 30 días y lo programado para los próximos</caption>
            <thead>
              <tr>
                <th>Día</th>
                {SENT_KINDS.map((k) => (
                  <th key={k.key}>{k.label}</th>
                ))}
                <th>Enviados</th>
                <th>Programados</th>
                <th>Recibidos</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.day}>
                  <td>{p.label}</td>
                  {SENT_KINDS.map((k) => (
                    <td key={k.key}>{p[k.key]}</td>
                  ))}
                  <td>{p.sent}</td>
                  <td>{projectedTotal(p.projected)}</td>
                  <td>{p.received}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function SentTooltip({ point }: { point: DailyPoint }) {
  const kinds = SENT_KINDS.filter((k) => point[k.key] > 0);
  const projected = point.projected;
  return (
    <>
      <p className="font-semibold">
        {point.label}
        {point.future ? " · programado" : ""}
      </p>
      {!point.future && (
        <>
          <p className="tabular-nums">{point.sent} enviados</p>
          {kinds.map((k) => (
            <p key={k.key} className="flex items-center gap-1.5 tabular-nums">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: k.color }} aria-hidden />
              {k.label}: {point[k.key]}
            </p>
          ))}
        </>
      )}
      {projected && projectedTotal(projected) > 0 && (
        <>
          <p className="mt-1 tabular-nums">
            {point.future ? "" : "Falta salir: "}
            {projectedTotal(projected)} programados
          </p>
          {projected.broadcast > 0 && <p className="tabular-nums text-muted-foreground">Broadcasts: {projected.broadcast}</p>}
          {projected.sequence > 0 && <p className="tabular-nums text-muted-foreground">Secuencias: {projected.sequence}</p>}
          {projected.scheduled > 0 && <p className="tabular-nums text-muted-foreground">Programadas a grupos: {projected.scheduled}</p>}
        </>
      )}
      {point.future && (!projected || projectedTotal(projected) === 0) && <p className="text-muted-foreground">Nada programado</p>}
    </>
  );
}

function Bars({
  series,
  max,
  height,
  active,
  onActive,
  firstFuture,
  segments,
  projected,
  tooltip,
}: {
  series: DailyPoint[];
  max: number;
  height: number;
  active: number | null;
  onActive: (index: number | null) => void;
  firstFuture: number;
  segments: (point: DailyPoint) => Array<{ value: number; color: string }>;
  projected: (point: DailyPoint) => number;
  tooltip: (point: DailyPoint) => ReactNode;
}) {
  const n = series.length;
  const shown = active !== null ? series[active] : null;
  // Hoy es el ultimo dia que ya paso (los que siguen son proyeccion).
  const todayIndex = firstFuture > 0 ? firstFuture - 1 : n - 1;
  // El recuadro se alinea con la barra, sin salirse por los costados.
  const tipStyle =
    active === null
      ? undefined
      : active < n * 0.2
        ? { left: `${(active / n) * 100}%` }
        : active > n * 0.8
          ? { right: `${((n - 1 - active) / n) * 100}%` }
          : { left: `${((active + 0.5) / n) * 100}%`, transform: "translateX(-50%)" };

  return (
    <div className="flex gap-1.5" aria-hidden>
      <div className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-muted-foreground" style={{ height }}>
        <span>{max}</span>
        <span>0</span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div
          className="relative flex items-end gap-[2px] border-b border-border"
          style={{ height, backgroundImage: "linear-gradient(to bottom, var(--wa-grid) 1px, transparent 1px)", backgroundSize: `100% ${height / 2}px` }}
          onMouseLeave={() => onActive(null)}
        >
          {series.map((point, index) => {
            const parts = segments(point).filter((s) => s.value > 0);
            const done = parts.reduce((sum, s) => sum + s.value, 0);
            const ahead = projected(point);
            const dim = active !== null && active !== index;
            return (
              <button
                key={point.day}
                type="button"
                tabIndex={-1}
                onMouseEnter={() => onActive(index)}
                onClick={() => onActive(active === index ? null : index)}
                className={`flex h-full min-w-0 flex-1 flex-col justify-end ${dim ? "opacity-50" : ""}`}
              >
                {ahead > 0 && (
                  <span
                    className={`w-full shrink-0 border border-dashed ${done > 0 ? "border-b-0" : ""}`}
                    style={{
                      height: `${Math.max(3, (ahead / max) * height)}px`,
                      borderColor: "var(--wa-projected)",
                      background: "var(--wa-projected-fill)",
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                    }}
                  />
                )}
                {done > 0 && (
                  <span
                    className={`flex w-full flex-col-reverse gap-[2px] overflow-hidden ${ahead > 0 ? "" : "rounded-t-[4px]"}`}
                    style={{ height: `${Math.max(2, (done / max) * height)}px` }}
                  >
                    {parts.map((part, i) => (
                      <span key={i} className="w-full shrink-0" style={{ background: part.color, flexGrow: part.value, flexBasis: 0, minHeight: 1 }} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {shown && (
          <div
            className="pointer-events-none absolute top-full z-20 mt-4 min-w-[9rem] max-w-[14rem] rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] text-popover-foreground shadow-lg"
            style={tipStyle}
            role="tooltip"
          >
            {tooltip(shown)}
          </div>
        )}
        <div className="relative mt-0.5 h-3 text-[10px] text-muted-foreground">
          <span className="absolute left-0">{series[0]?.label}</span>
          {todayIndex > 0 && todayIndex < n - 1 && (
            <span className="absolute -translate-x-1/2 whitespace-nowrap font-medium text-foreground" style={{ left: `${((todayIndex + 0.5) / n) * 100}%` }}>
              Hoy
            </span>
          )}
          <span className="absolute right-0">{series[n - 1]?.label}</span>
        </div>
      </div>
    </div>
  );
}

function formatAvg(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toLocaleString("es", { maximumFractionDigits: 1 });
}

/**
 * La paleta categórica de referencia, en su orden fijo (validada para daltonismo en pares contiguos, claro y oscuro).
 * El tema lo maneja la clase `.dark` del <html>, no `prefers-color-scheme`.
 */
const PALETTE_CSS = `
.wa-daily {
  --wa-series-1: #2a78d6;
  --wa-series-2: #eb6834;
  --wa-series-3: #1baf7a;
  --wa-series-4: #eda100;
  --wa-series-5: #e87ba4;
  --wa-series-6: #008300;
  --wa-received: #6250d6;
  --wa-projected: #8c8b86;
  --wa-projected-fill: rgb(140 139 134 / 0.08);
  --wa-grid: rgb(0 0 0 / 0.06);
}
.dark .wa-daily {
  --wa-series-1: #3987e5;
  --wa-series-2: #d95926;
  --wa-series-3: #199e70;
  --wa-series-4: #c98500;
  --wa-series-5: #d55181;
  --wa-series-6: #008300;
  --wa-received: #9085e9;
  --wa-projected: #a3a29b;
  --wa-projected-fill: rgb(163 162 155 / 0.1);
  --wa-grid: rgb(255 255 255 / 0.07);
}
`;
