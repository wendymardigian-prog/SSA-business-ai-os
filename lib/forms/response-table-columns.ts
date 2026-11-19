// @plantilla-quitar(formularios)
/**
 * Las columnas de la tabla de respuestas de un formulario para la tabla común (`DataTable`, docs/tablas.md): Fecha,
 * Contacto (arranca fijo), Estado, Puntaje (encuestas) y las de `response-columns.ts` (preguntas y atribución). PURO.
 *
 * Una sola clave para todos los formularios (la regla de `table_key` no admite el id): las preguntas de otro formulario se
 * ignoran al leer lo elegido. Nunca renombrar una `key`.
 */
import { attributionColumnMetas, type AttributionColumnMeta } from "@/lib/attribution/table-columns";
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";
import { RESPONSE_COLUMN_GROUPS, responseColumnDefs, type ResponseCellSource } from "./response-columns";
import type { ResponseColumn } from "./responses";

export const RESPONSES_TABLE_KEY = "form_responses";

const BASE = "Respuesta";

export function responseBaseColumns(showScore: boolean): ColumnMeta[] {
  return [
    { key: "date", label: "Fecha", group: BASE, defaultWidth: 170 },
    { key: "contact", label: "Contacto", group: BASE, defaultWidth: 200, hideable: false, defaultPinned: true },
    { key: "status", label: "Estado", group: BASE, defaultWidth: 150 },
    ...(showScore ? [{ key: "score", label: "Puntaje", group: BASE, defaultWidth: 100 }] : []),
  ];
}

/** Preguntas y atribución; una pregunta que ya no está en el formulario lo aclara al pasar el mouse. */
export function responseDataColumns(answers: readonly ResponseColumn[]): AttributionColumnMeta<ResponseCellSource>[] {
  return attributionColumnMetas(responseColumnDefs(answers), RESPONSE_COLUMN_GROUPS).map((m) =>
    m.def.removed ? { ...m, hint: [m.hint, "Ya no está en la versión vigente del formulario"].filter(Boolean).join(" · ") } : m,
  );
}
