/**
 * Las 7 secciones del editor de un evento (F18), como datos puros.
 *
 * Viven fuera del componente porque las lee tambien la pagina (Server
 * Component): importar un valor de un modulo "use client" desde el servidor
 * devuelve una referencia al cliente, no el array.
 */
import type { EditorSection } from "./event-validation";

export const EDITOR_SECTIONS: Array<{ key: EditorSection; label: string }> = [
  { key: "details", label: "Detalles" },
  { key: "availability", label: "Disponibilidad y calendarios" },
  { key: "form", label: "Formulario" },
  { key: "limits", label: "Límites y buffers" },
  { key: "unavailable", label: "Si no se puede agendar" },
  { key: "flows", label: "Flujos" },
  { key: "share", label: "Compartir y embed" },
];

export function isEditorSection(value: unknown): value is EditorSection {
  return EDITOR_SECTIONS.some((s) => s.key === value);
}
