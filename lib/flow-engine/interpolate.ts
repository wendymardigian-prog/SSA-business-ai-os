/**
 * Interpolacion de variables en los textos de los nodos.
 *
 * Vivia adentro de engine.ts, pero ahora cada nodo es un modulo aparte y todos
 * la necesitan, asi que se mudo aca. El simulador tiene su propia copia (corre
 * en el navegador y no puede importar codigo de servidor); si se toca esta,
 * hay que tocar la de simulator.ts — lo cubre un test que compara las dos.
 */

import { EMPTY_NAME_MARK, fallbackText, isEmptyName, needsFallback, tidyEmptyNames } from "@/lib/templates/fallback";

/**
 * Sigue un dot-path adentro de un objeto de variables.
 *
 * `{{pedido.cliente.nombre}}` sirve para leer adentro de la respuesta JSON que
 * dejo un nodo HTTP Request. Devuelve undefined si el camino se corta.
 */
export function resolveVariablePath(
  variables: Record<string, unknown>,
  path: string
): unknown {
  let value: unknown = variables;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Reemplaza los `{{tokens}}` de un texto por el valor de la variable.
 *
 * Un token que no resuelve queda tal cual, a proposito: es preferible que el
 * operador vea `{{nombre}}` en la conversacion y entienda que falto configurar
 * algo, antes que mandarle al lead un mensaje con un hueco vacio. Quien prefiera otra cosa escribe un respaldo:
 * `{{contact.first_name|hola}}` (lib/templates/fallback.ts).
 *
 * El token admite guiones porque el link de un evento los lleva:
 * `{{scheduling.link.ana.llamada-de-diagnostico}}`. Sin eso, el token se
 * cortaba en el guion y el mensaje salia con media variable pegada al texto.
 */
export function interpolateVariables(
  text: string,
  variables: Record<string, unknown>
): string {
  const out = text.replace(/\{\{([\w-]+(?:\.[\w-]+)*)(?:\s*\|([^{}]*))?\}\}/g, (token, path: string, fallback?: string) => {
    const value = resolveVariablePath(variables, path);
    if (fallback !== undefined && needsFallback(path, value)) return fallbackText(fallback);
    if (value === null || value === undefined) return token;
    // Un nombre vacío o de relleno sin respaldo no se pega: el saludo queda sin nombre («¡Hola!», no «¡Hola Contacto!»).
    if (isEmptyName(path, value)) return EMPTY_NAME_MARK;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
  return tidyEmptyNames(out);
}

/**
 * Interpola TODOS los textos de un valor (objetos y listas adentro), sin tocar las claves ni lo que no es texto. Lo usa
 * «Enviar mensaje» para los botones, las respuestas rapidas, los links, el carrusel y la media: antes solo se
 * interpolaba el texto y un boton «Hola {{contact.first_name}}» llegaba con la llave literal.
 */
export function interpolateDeep<T>(value: T, variables: Record<string, unknown>): T {
  if (typeof value === "string") return interpolateVariables(value, variables) as T;
  if (Array.isArray(value)) return value.map((item) => interpolateDeep(item, variables)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = interpolateDeep(item, variables);
    return out as T;
  }
  return value;
}
