/**
 * Exportar respuestas a CSV (F13, F33).
 *
 * Portado de `src/lib/form-responses-export.ts` de prevxcrm: el armado de la
 * matriz de celdas y los nombres de archivo. Cambios para SSA: sale CSV (no
 * xlsx), con BOM UTF-8, y **ninguna celda puede ser una fórmula**: un valor que
 * empieza con `=`, `+`, `-`, `@`, tab o retorno se prefija con `'`.
 *
 * La arma el servidor respetando la RLS de quien exporta: acá no se decide quién
 * ve qué.
 */
import { ATTRIBUTION_KEYS, VISIT_META_KEYS } from "@/lib/attribution/keys";
import { FORM_LIMITS } from "./limits";
import {
  cellFor,
  emailStatusLabel,
  statusLabel,
  type ResponseColumn,
  type ResponseRow,
} from "./responses";

const FORMULA_START = /^[=+\-@\t\r]/;
const BOM = "﻿";

/** Neutraliza una celda que Excel o Sheets interpretarían como fórmula. */
export function protectCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Una celda entre comillas si hace falta (coma, comilla, salto de línea). */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(matrix: string[][]): string {
  return BOM + matrix.map((row) => row.map((cell) => csvEscape(protectCell(cell))).join(",")).join("\r\n") + "\r\n";
}

/** Las claves de atribución que tienen algún valor en estas filas, en el orden canónico. */
export function attributionColumns(rows: Array<Pick<ResponseRow, "attribution">>): string[] {
  const order = [...ATTRIBUTION_KEYS, ...VISIT_META_KEYS];
  return order.filter((key) => rows.some((r) => typeof r.attribution?.[key] === "string" && r.attribution[key] !== ""));
}

export interface ExportOptions {
  /** Fecha ya en la zona del workspace. */
  formatDate: (iso: string) => string;
  /** Encuestas: suma puntaje y categoría. */
  includeScore?: boolean;
  /** Contratos: suma el estado del email con la copia. */
  includeEmailStatus?: boolean;
}

export interface ExportResult {
  csv: string;
  rows: number;
  truncated: boolean;
}

export function buildResponsesMatrix(
  rows: ResponseRow[],
  columns: ResponseColumn[],
  options: ExportOptions,
): string[][] {
  const attrKeys = attributionColumns(rows);
  const header = [
    "Fecha",
    "Contacto",
    "Email del contacto",
    "Estado",
    ...(options.includeScore ? ["Puntaje", "Categoría NPS"] : []),
    ...(options.includeEmailStatus ? ["Email del contrato"] : []),
    ...columns.map((c) => c.label),
    ...attrKeys.map((k) => `Atribución: ${k}`),
  ];

  const body = rows.map((row) => [
    options.formatDate(row.created_at),
    row.contact_name ?? "",
    row.contact_email ?? "",
    statusLabel(row.status),
    ...(options.includeScore
      ? [row.score === null || row.score === undefined ? "" : String(row.score), row.nps_category ?? ""]
      : []),
    ...(options.includeEmailStatus ? [emailStatusLabel(row.email_status)] : []),
    ...columns.map((c) => cellFor(row, c, "; ")),
    ...attrKeys.map((k) => {
      const v = row.attribution?.[k];
      return typeof v === "string" ? v : "";
    }),
  ]);

  return [header, ...body];
}

export function buildResponsesCsv(
  rows: ResponseRow[],
  columns: ResponseColumn[],
  options: ExportOptions,
): ExportResult {
  const limit = FORM_LIMITS.exportMaxRows;
  const truncated = rows.length > limit;
  const used = truncated ? rows.slice(0, limit) : rows;
  return { csv: toCsv(buildResponsesMatrix(used, columns, options)), rows: used.length, truncated };
}

/** `aplicacion-al-programa_todos_2026-10-10.csv` */
export function buildExportFilename(formName: string, scope: string, dateStr: string): string {
  const slug = formName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "respuestas";
  return `${slug}_${scope}_${dateStr}.csv`;
}
