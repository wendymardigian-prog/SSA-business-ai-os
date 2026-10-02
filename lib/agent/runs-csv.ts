/**
 * El export a CSV de Corridas (R3). Puro: arma el texto, no toca la red.
 *
 * Las columnas de costo y tokens solo van si `includeCost` es true —
 * decidido por quien llama ANTES de pedirle los runs al servidor (el
 * permiso se respeta pidiendo o no, nunca ocultando una columna que ya
 * viajo).
 */

import type { RunRow } from "./screen";
import { RUN_SOURCE_LABELS, RUN_STATUS_LABELS, TRIGGER_LABELS, describeModelError, describeRunDetail } from "./run-labels";

const BASE_HEADER = ["id", "fecha", "origen", "disparador", "contacto", "canal", "modelo", "estado", "motivo", "pasos", "duracion_ms"];
const COST_HEADER = ["tokens_in", "tokens_out", "costo_usd"];

function csvCell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function motivoOf(run: RunRow): string {
  const detail = describeRunDetail(run.statusDetail);
  const error = run.error ? describeModelError(run.error) : null;
  return [...detail, error].filter((v): v is string => Boolean(v))[0] ?? "";
}

export function runsToCsv(rows: RunRow[], args: { includeCost: boolean }): string {
  const header = args.includeCost ? [...BASE_HEADER, ...COST_HEADER] : BASE_HEADER;
  const lines = rows.map((r) => {
    const base = [
      r.id,
      r.createdAt,
      RUN_SOURCE_LABELS[r.source] ?? r.source,
      TRIGGER_LABELS[r.trigger] ?? r.trigger,
      r.contactName ?? "",
      r.channelLabel ?? "",
      r.model ? `${r.provider}/${r.model}` : "",
      RUN_STATUS_LABELS[r.status] ?? r.status,
      motivoOf(r),
      r.stepCount,
      r.latencyMs,
    ];
    const cost = args.includeCost ? [r.cost?.inputTokens ?? null, r.cost?.outputTokens ?? null, r.cost?.usd ?? null] : [];
    return [...base, ...cost].map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\r\n");
}
