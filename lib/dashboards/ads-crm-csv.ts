/**
 * La tabla «Meta vs CRM» como CSV (Extra L, AT4, F33).
 *
 * Exporta lo que se ve: las columnas visibles, en el orden elegido, con la fila de total. «Estado» ya no es una columna
 * fija: es una columna mas (Información), y sale solo si esta visible. Los numeros van tal cual
 * (punto decimal, sin simbolo de moneda) y lo que no se puede calcular va vacio. Un valor con coma, comillas o
 * salto de linea se entrecomilla; y uno que empieza con `=`, `+`, `-` o `@` se prefija con `'` para que una
 * planilla no lo ejecute como formula (inyeccion de formulas en CSV).
 */

import { csvCell, type ColumnDef } from "./ads-crm-columns";
import type { CrmRow } from "./ads-crm";

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvEscape(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(params: { firstColumnLabel: string; columns: ColumnDef[]; rows: CrmRow[]; total: CrmRow }): string {
  const header = [params.firstColumnLabel, ...params.columns.map((c) => c.label)];
  const line = (row: CrmRow) => [row.name ?? row.objectId, ...params.columns.map((c) => csvCell(c, row))];
  const lines = [header, ...params.rows.map(line), line(params.total)];
  // Con BOM: Excel abre bien los acentos.
  return "﻿" + lines.map((cells) => cells.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

/** `anuncios-<nivel>-<desde>_<hasta>.csv`: el periodo va en el nombre. */
export function csvFilename(level: "campaign" | "adset" | "ad", since: string, until: string): string {
  const label = level === "campaign" ? "campanas" : level === "adset" ? "conjuntos" : "anuncios";
  const range = since && until ? `${since}_${until}` : "periodo";
  return `${label}-meta-vs-crm-${range}.csv`;
}
