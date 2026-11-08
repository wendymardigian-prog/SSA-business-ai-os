"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadWhatsappDailyMessages } from "@/lib/actions/whatsapp-stats";
import { SENT_KINDS, dailyTotals, niceMax, type DailyPoint } from "@/lib/whatsapp-stats/daily";

/**
 * Mensajes por día de un número de WhatsApp, los últimos 30 días (00348), en la sección Historial de su tarjeta.
 *
 * Dos gráficos con su propia escala (nunca dos medidas en un eje): arriba los ENVIADOS, apilados por quién los mandó
 * (lo que mira WhatsApp para bloquear un número), y abajo los RECIBIDOS en chats privados. Los colores son fijos por
 * origen y nunca dependen de los datos. Pasar el mouse (o el foco) por un día muestra su detalle en la línea de abajo.
 */

const CHART_HEIGHT = 112;
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
  const sentMax = niceMax(Math.max(...series.map((p) => p.sent)));
  const receivedMax = niceMax(Math.max(...series.map((p) => p.received)));
  const shown = series[active ?? series.length - 1];

  return (
    <div className="wa-daily space-y-2">
      <style>{PALETTE_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <p className="font-semibold text-foreground">Mensajes enviados · últimos 30 días</p>
        <p className="text-muted-foreground">
          {totals.sent} en total · {formatAvg(totals.avgSent)} por día
          {totals.maxSentDay ? ` · el día más alto: ${totals.maxSentDay.sent} (${totals.maxSentDay.label})` : ""}
        </p>
      </div>

      {totals.sent === 0 && totals.received === 0 ? (
        <p className="text-muted-foreground">Todavía no hay mensajes de este número en los últimos 30 días.</p>
      ) : (
        <>
          <Bars
            series={series}
            max={sentMax}
            height={CHART_HEIGHT}
            active={active}
            onActive={setActive}
            label="Mensajes enviados por día"
            segments={(p) => SENT_KINDS.map((k) => ({ value: p[k.key], color: k.color }))}
          />

          <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Quién los mandó">
            {SENT_KINDS.map((kind) => (
              <li key={kind.key} className="flex items-center gap-1.5" title={kind.hint}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: kind.color }} aria-hidden />
                <span className="text-foreground">{kind.label}</span>
                <span className="tabular-nums text-muted-foreground">{totals.byKind[kind.key]}</span>
              </li>
            ))}
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
            label="Mensajes recibidos por día"
            segments={(p) => [{ value: p.received, color: "var(--wa-received)" }]}
          />

          <p className="min-h-[1.25rem] rounded-md bg-muted px-2 py-1 tabular-nums text-foreground" aria-live="polite">
            <span className="font-semibold">{shown.label}</span>: {shown.sent} enviados
            {shown.sent > 0 && ` (${SENT_KINDS.filter((k) => shown[k.key] > 0).map((k) => `${k.label.toLowerCase()} ${shown[k.key]}`).join(", ")})`}
            {" · "}
            {shown.received} recibidos
          </p>
          <p className="text-muted-foreground">
            Los mensajes a grupos cuentan como enviados (para WhatsApp es lo mismo). Los recibidos son solo de chats privados.
          </p>

          <table className="sr-only">
            <caption>Mensajes por día, últimos 30 días</caption>
            <thead>
              <tr>
                <th>Día</th>
                {SENT_KINDS.map((k) => (
                  <th key={k.key}>{k.label}</th>
                ))}
                <th>Enviados</th>
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

function Bars({
  series,
  max,
  height,
  active,
  onActive,
  label,
  segments,
}: {
  series: DailyPoint[];
  max: number;
  height: number;
  active: number | null;
  onActive: (index: number | null) => void;
  label: string;
  segments: (point: DailyPoint) => Array<{ value: number; color: string }>;
}) {
  return (
    <div className="flex gap-1.5" aria-hidden>
      <div className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-muted-foreground" style={{ height }}>
        <span>{max}</span>
        <span>0</span>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="relative flex items-end gap-[2px] border-b border-border"
          style={{ height, backgroundImage: "linear-gradient(to bottom, var(--wa-grid) 1px, transparent 1px)", backgroundSize: `100% ${height / 2}px` }}
          onMouseLeave={() => onActive(null)}
          title={label}
        >
          {series.map((point, index) => {
            const parts = segments(point).filter((s) => s.value > 0);
            const total = parts.reduce((sum, s) => sum + s.value, 0);
            return (
              <button
                key={point.day}
                type="button"
                tabIndex={-1}
                onMouseEnter={() => onActive(index)}
                onFocus={() => onActive(index)}
                onClick={() => onActive(index)}
                className="flex h-full min-w-0 flex-1 flex-col justify-end"
                aria-label={`${point.label}: ${total}`}
              >
                <span
                  className={`flex w-full flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] ${active === index ? "opacity-100" : active === null ? "opacity-100" : "opacity-60"}`}
                  style={{ height: total > 0 ? `${Math.max(2, (total / max) * height)}px` : 0 }}
                >
                  {parts.map((part, i) => (
                    <span key={i} className="w-full shrink-0" style={{ background: part.color, flexGrow: part.value, flexBasis: 0, minHeight: 1 }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{series[0]?.label}</span>
          <span>{series[Math.floor(series.length / 2)]?.label}</span>
          <span>{series[series.length - 1]?.label}</span>
        </div>
      </div>
    </div>
  );
}

function formatAvg(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toLocaleString("es", { maximumFractionDigits: 1 });
}

/**
 * La paleta categórica de referencia (validada para daltonismo en pares contiguos, claro y oscuro). El tema lo maneja
 * la clase `.dark` del <html>, no `prefers-color-scheme`.
 */
const PALETTE_CSS = `
.wa-daily {
  --wa-series-1: #2a78d6;
  --wa-series-2: #eb6834;
  --wa-series-3: #1baf7a;
  --wa-series-4: #eda100;
  --wa-series-5: #e87ba4;
  --wa-received: #6250d6;
  --wa-grid: rgb(0 0 0 / 0.06);
}
.dark .wa-daily {
  --wa-series-1: #3987e5;
  --wa-series-2: #d95926;
  --wa-series-3: #199e70;
  --wa-series-4: #c98500;
  --wa-series-5: #d55181;
  --wa-received: #9085e9;
  --wa-grid: rgb(255 255 255 / 0.07);
}
`;
