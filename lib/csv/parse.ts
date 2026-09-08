/**
 * Parser de CSV (F19).
 *
 * Escrito a mano y no con una libreria por dos motivos: el repo no tiene
 * dependencias de utilidades por decision, y esto tiene que correr igual en el
 * navegador (que muestra la vista previa) y en el servidor (que valida antes de
 * escribir). Las librerias del rubro estan pensadas para el browser, con
 * workers y streams, que a 10.000 filas no hacen falta.
 *
 * Cubre lo que aparece en un archivo real:
 *
 * - Comillas, comillas dobladas ("") y comas o saltos de linea adentro de un
 *   campo entrecomillado.
 * - Finales de linea CRLF y CR sueltos, que es lo que sale de Excel en Windows.
 * - BOM al principio, que Excel escribe siempre y que si no se saca convierte
 *   la primera columna en "﻿email" y rompe el mapeo.
 * - Punto y coma como separador: Excel en español lo usa por defecto, asi que
 *   una parte grande de los archivos reales viene asi y sin detectarlo el
 *   archivo entero parece una sola columna.
 */

export interface ParseResult {
  /** Nombres de columna, ya sin BOM ni espacios. */
  headers: string[];
  /** Una entrada por fila de datos; el largo puede no coincidir con headers. */
  rows: string[][];
  /** El separador que se detecto. */
  delimiter: string;
  /** Filas que se dejaron afuera por el tope. */
  truncated: number;
}

const CANDIDATE_DELIMITERS = [",", ";", "\t"];

/**
 * Elige el separador contando cual aparece mas veces afuera de comillas en la
 * primera linea. Contar solo en el encabezado alcanza y evita que un texto con
 * muchas comas adentro de un campo desempate mal.
 */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r\n|\r|\n/, 1)[0] ?? "";

  let best = ",";
  let bestCount = 0;

  for (const candidate of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const char = firstLine[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (!inQuotes && char === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

export interface ParseOptions {
  /** Tope de filas de datos. Lo que sobra se cuenta en `truncated`. */
  maxRows?: number;
  /** Forzar separador en vez de detectarlo. */
  delimiter?: string;
}

export function parseCsv(input: string, options: ParseOptions = {}): ParseResult {
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;

  // El BOM se saca antes de todo: si sobrevive, se pega al nombre de la primera
  // columna y esa columna no matchea con ningun campo.
  const text = input.replace(/^﻿/, "");
  const delimiter = options.delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let truncated = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    // Una linea vacia (un solo campo vacio) no es una fila: pasa siempre al
    // final del archivo y contarla daria una fila con error de mas.
    const isBlank = row.length === 1 && row[0].trim() === "";
    if (!isBlank) {
      if (rows.length < maxRows + 1) rows.push(row);
      else truncated++;
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      continue;
    }

    if (char === "\n") {
      endRow();
      continue;
    }

    if (char === "\r") {
      // CRLF y CR suelto terminan la fila igual.
      if (text[i + 1] === "\n") i++;
      endRow();
      continue;
    }

    field += char;
  }

  // Lo que quedo sin salto de linea al final es la ultima fila.
  if (field !== "" || row.length > 0) endRow();

  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((h) => h.replace(/^﻿/, "").trim());

  return { headers, rows, delimiter, truncated };
}
