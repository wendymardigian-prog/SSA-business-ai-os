/**
 * Descarga de un diseño publicado (F44). Contenido mínimo de la Ola 1: la construye DS5.
 * Hasta entonces responde 404 (nunca expone el bucket).
 */
export async function GET(): Promise<Response> {
  return new Response("No encontrado", { status: 404 });
}
