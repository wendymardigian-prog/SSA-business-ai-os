/**
 * Reemplazo de variables en los templates de respuesta rapida (F17).
 *
 * Tres decisiones que valen la pena explicar:
 *
 * 1. Una variable sin valor se borra, no queda como {{contact.email}}. Un
 *    template es texto que se le manda a un lead: mostrarle el nombre interno
 *    de un campo vacio es peor que no decir nada.
 * 2. Una sola pasada. Si un contacto se llama "{{workspace.name}}" —o si
 *    alguien lo carga a proposito— el resultado no se vuelve a expandir. Sin
 *    esto, el contenido de un campo del contacto podria leer datos de otro.
 * 3. La lista de variables es cerrada. Lo que no esta en la lista se deja tal
 *    cual, para que un texto con llaves (codigo, JSON) no se coma pedazos.
 */

/** Datos que se pueden interpolar. Todo opcional: un contacto puede no tener nada. */
export interface TemplateContext {
  contact?: {
    display_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  workspace?: {
    name?: string | null;
  } | null;
}

export interface TemplateVariable {
  /** Como se escribe adentro de las llaves. */
  key: string;
  /** Que es, para la ayuda del formulario. */
  label: string;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: "contact.display_name", label: "Nombre del contacto" },
  { key: "contact.email", label: "Email del contacto" },
  { key: "contact.phone", label: "Telefono del contacto" },
  { key: "workspace.name", label: "Nombre del negocio" },
];

const VALID_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

/** Acepta espacios adentro de las llaves: {{ contact.email }} es lo mismo. */
const PLACEHOLDER = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi;

function valueFor(key: string, context: TemplateContext): string {
  switch (key) {
    case "contact.display_name":
      return context.contact?.display_name ?? "";
    case "contact.email":
      return context.contact?.email ?? "";
    case "contact.phone":
      return context.contact?.phone ?? "";
    case "workspace.name":
      return context.workspace?.name ?? "";
    default:
      return "";
  }
}

/**
 * Devuelve el contenido con las variables reemplazadas. Lo que no es una
 * variable conocida queda intacto.
 */
export function interpolateTemplate(content: string, context: TemplateContext): string {
  return content.replace(PLACEHOLDER, (original, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return VALID_KEYS.has(key) ? valueFor(key, context) : original;
  });
}

/**
 * Las variables que usa un template, sin repetir y en orden de aparicion.
 * La pantalla de gestion la usa para avisar cuando alguien escribio una
 * variable que no existe.
 */
export function usedVariables(content: string): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];

  for (const match of content.matchAll(PLACEHOLDER)) {
    const key = match[1].toLowerCase();
    const bucket = VALID_KEYS.has(key) ? known : unknown;
    if (!bucket.includes(key)) bucket.push(key);
  }

  return { known, unknown };
}

/** Datos de ejemplo para la vista previa del formulario. */
export const PREVIEW_CONTEXT: TemplateContext = {
  contact: {
    display_name: "Ana Gomez",
    email: "ana@ejemplo.com",
    phone: "+5491122334455",
  },
  workspace: { name: "Mi Negocio" },
};
