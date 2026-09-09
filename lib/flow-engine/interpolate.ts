/**
 * Interpolacion de variables en los textos de los nodos.
 *
 * Vivia adentro de engine.ts, pero ahora cada nodo es un modulo aparte y todos
 * la necesitan, asi que se mudo aca. El simulador tiene su propia copia (corre
 * en el navegador y no puede importar codigo de servidor); si se toca esta,
 * hay que tocar la de simulator.ts — lo cubre un test que compara las dos.
 */

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
 * algo, antes que mandarle al lead un mensaje con un hueco vacio.
 */
export function interpolateVariables(
  text: string,
  variables: Record<string, unknown>
): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (token, path: string) => {
    const value = resolveVariablePath(variables, path);
    if (value === null || value === undefined) return token;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}
