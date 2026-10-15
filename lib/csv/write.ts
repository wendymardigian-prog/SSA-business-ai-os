/**
 * Escritor de CSV genérico (Extra I, GF13). `lib/csv` hasta ahora solo importaba; la exportación de
 * Corridas tiene su propio `csvCell` privado y no se toca.
 *
 *  - comillas si la celda tiene `,`, `"` o un salto de línea (las comillas internas se duplican);
 *  - NEUTRALIZA FÓRMULAS: un texto que empieza con `=`, `+`, `-` o `@` (o tabulación/retorno) se prefija con
 *    `'` para que Excel y Sheets no lo ejecuten. Los números NO se tocan: `-4.20` es un monto, no una fórmula;
 *  - saltos `\r\n` y BOM UTF-8 al principio, para que Excel lea las tildes.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") text = Number.isFinite(value) ? String(value) : "";
  else if (typeof value === "boolean") text = value ? "si" : "no";
  else {
    text = value;
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_BOM = "﻿";

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
