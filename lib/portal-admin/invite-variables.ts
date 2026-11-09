// @plantilla-quitar(servicios)
/**
 * Las variables del email de invitación al portal y de la pantalla de inicio. Usan las claves del catálogo de
 * Automatizaciones (`contact.*`, `workspace.name`), no unas propias. Puro: lo leen la pantalla y la plantilla.
 */
export interface TextVariable {
  /** La clave que va entre llaves: `{{contact.first_name}}`. */
  name: string;
  /** Lo que ve la persona en el menú. */
  label: string;
}

export const PORTAL_TEXT_VARIABLES: readonly TextVariable[] = [
  { name: "contact.first_name", label: "Nombre del cliente" },
  { name: "contact.name", label: "Nombre completo del cliente" },
  { name: "workspace.name", label: "Nombre del negocio" },
];

/** `{nombre}`, la forma vieja (antes de las variables), es lo mismo que `{{contact.first_name}}`. */
export function legacyNameToVariable(text: string): string {
  return text.replace(/\{nombre\}/g, "{{contact.first_name}}");
}

/** Los valores de las variables para un cliente. Sin nombre, vacío (el saludo queda «Hola.», no «Hola Contacto»). */
export function portalTextValues(input: { workspaceName: string; studentName?: string | null }): Record<string, unknown> {
  const full = input.studentName?.trim() ?? "";
  return {
    contact: { first_name: full.split(/\s+/)[0] ?? "", name: full },
    workspace: { name: input.workspaceName },
  };
}

/**
 * Para abrir en el editor un texto guardado: `{nombre}` y cada `{{variable}}` escrita a mano pasan a ser fichas (lo que
 * ya es ficha no se toca). Recibe el HTML que va al editor.
 */
export function variablesToChips(html: string): string {
  if (/data-variable=/.test(html)) return legacyNameToVariable(html);
  return legacyNameToVariable(html).replace(/\{\{([\w-]+(?:\.[\w-]+)*)\}\}/g, (_, name: string) => `<span data-variable="${name}">{{${name}}}</span>`);
}
