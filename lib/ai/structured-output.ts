/**
 * Opciones por proveedor para pedir una respuesta estructurada (`generateObject`).
 *
 * Con Anthropic se pide la salida por una herramienta JSON (`jsonTool`), no la
 * salida estructurada nativa: la nativa acepta hasta 24 campos opcionales en el
 * esquema y los esquemas grandes (el documento del Diseñador, el análisis de una
 * grabación) tienen más. Anthropic rechaza el pedido con «Schemas contains too
 * many optional parameters».
 *
 * Con OpenAI se apaga el modo ESTRICTO del esquema (`strictJsonSchema: false`;
 * el AI SDK lo prende por defecto): el modo estricto exige que TODAS las claves
 * estén en `required`, así que cualquier campo opcional (`.nullish()`) hace que
 * OpenAI rechace el pedido ANTES de leer nada («Invalid schema for
 * response_format … Missing '<campo>'»). Traído de RER-BAIOS #141, donde pasó
 * con GPT-5 al clasificar grabaciones.
 *
 * En los dos casos la respuesta se sigue validando con Zod, así que no se pierde
 * ninguna garantía. Cada proveedor ignora la clave del otro.
 */
export const STRUCTURED_OUTPUT_PROVIDER_OPTIONS = {
  anthropic: { structuredOutputMode: "jsonTool" },
  openai: { strictJsonSchema: false },
} as const;
