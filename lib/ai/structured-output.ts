/**
 * Opciones por proveedor para pedir una respuesta estructurada (`generateObject`).
 *
 * Con Anthropic se pide la salida por una herramienta JSON (`jsonTool`), no la
 * salida estructurada nativa: la nativa acepta hasta 24 campos opcionales en el
 * esquema y los esquemas grandes (el documento del Diseñador, el análisis de una
 * grabación) tienen más. Anthropic rechaza el pedido con «Schemas contains too
 * many optional parameters». La respuesta se sigue validando con Zod, así que
 * no se pierde ninguna garantía. Los demás proveedores ignoran la clave
 * `anthropic`.
 */
export const STRUCTURED_OUTPUT_PROVIDER_OPTIONS = { anthropic: { structuredOutputMode: "jsonTool" } } as const;
