/**
 * Probar una API key de IA contra el proveedor, y de paso saber que modelos ve.
 *
 * Hasta ahora las keys de IA se guardaban sin probar: el comentario de
 * test-connection.ts decia que no habia una llamada gratis y sin efectos. No es
 * cierto. Los tres proveedores tienen un endpoint para LISTAR MODELOS que no
 * cobra tokens, no deja nada escrito y devuelve 401 cuando la key no sirve.
 *
 * Costo de no hacerlo: una key revocada se guardaba igual, la card quedaba en
 * verde, y el agente recien fallaba el dia que un lead escribia. Paso.
 *
 * Lo que devuelve tiene dos partes y las dos importan:
 *
 *   1. Si la key sirve. Un 401/403 no se guarda: es la unica forma de que la
 *      pantalla no mienta.
 *   2. Que modelos ve ESA cuenta. Una lista escrita a mano en el codigo
 *      envejece con cada modelo nuevo; esta la dice el proveedor. Se guarda en
 *      integration_configs.config.models y el selector del agente la suma a la
 *      lista sugerida del catalogo.
 *
 * Una caida del proveedor NO bloquea el guardado. Un 429 o un 500 no dicen nada
 * sobre la key, y dejar a alguien sin poder guardar porque Anthropic esta lento
 * es peor que guardar una key que probablemente este bien. En ese caso se
 * guarda con un aviso y sin lista de modelos.
 *
 * Solo servidor: recibe la key en claro. Nunca la loguea, nunca la devuelve, y
 * nunca la manda por la URL (query string) —solo por header.
 */

import type { FetchLike } from "@/lib/oauth/types";

export type AiKeyCheck =
  | {
      ok: true;
      /** Los ids de modelo de texto que ve la cuenta. Vacio si no se pudo verificar. */
      models: string[];
      /** Aviso para mostrar cuando la verificacion no se pudo hacer. */
      detail?: string;
    }
  | { ok: false; error: string };

/** Cuanto se espera al proveedor antes de dar la verificacion por no hecha. */
const TIMEOUT_MS = 10_000;

/**
 * Los proveedores de IA que se pueden probar asi. Voyage queda afuera a
 * proposito: no publica un endpoint gratis para listar modelos.
 */
export function isCheckableAiProvider(providerId: string): boolean {
  return providerId === "anthropic" || providerId === "openai" || providerId === "google_ai";
}

const LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google_ai: "Google",
};

/**
 * Modelos de OpenAI que no sirven para conversar. El endpoint devuelve todo lo
 * que la cuenta puede usar —audio, imagenes, embeddings, moderacion—, y
 * ofrecerlos en el selector del agente seria ofrecer algo que falla al usarlo.
 */
const OPENAI_NOT_CHAT =
  /(realtime|audio|tts|whisper|transcribe|image|dall-e|embedding|moderation|rerank|codex-mini|instruct)/;

/**
 * Prueba la key y devuelve los modelos de texto que ve la cuenta.
 *
 * `fetchImpl` existe para los tests: nunca se llama al proveedor de verdad
 * desde una prueba automatica.
 */
export async function checkAiProviderKey(input: {
  providerId: string;
  apiKey: string;
  fetchImpl?: FetchLike;
}): Promise<AiKeyCheck> {
  const { providerId, apiKey } = input;
  const label = LABELS[providerId] ?? providerId;
  const doFetch = input.fetchImpl ?? fetch;

  let url: string;
  let headers: Record<string, string>;

  switch (providerId) {
    case "anthropic":
      // limit=1000: el default es 20 y la respuesta viene paginada. Con el tope
      // alto entra todo de una y no hace falta seguir `has_more`.
      url = "https://api.anthropic.com/v1/models?limit=1000";
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
      break;
    case "openai":
      url = "https://api.openai.com/v1/models";
      headers = { authorization: `Bearer ${apiKey}` };
      break;
    case "google_ai":
      // La key va por header, NO en la query string: una URL con la key adentro
      // termina en los logs del proxy y en el historial del navegador.
      url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
      headers = { "x-goog-api-key": apiKey };
      break;
    default:
      // Voyage y cualquier otro: no hay prueba, no hay veredicto.
      return { ok: true, models: [] };
  }

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Sin red, DNS caido o se acabo el tiempo. No dice nada sobre la key.
    return { ok: true, models: [], detail: softFailNote(label, "no se pudo contactar al proveedor") };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: `${label} rechazo la API key (HTTP ${response.status}). Puede estar revocada, ser de otra cuenta o estar copiada a medias. Generá una nueva en el panel de ${label} y pegala completa.`,
    };
  }

  if (response.status === 400 || response.status === 404) {
    return {
      ok: false,
      error: `${label} no acepto el pedido de verificacion (HTTP ${response.status}). Revisá que la key sea de ${label} y no de otro proveedor.`,
    };
  }

  if (!response.ok) {
    // 429, 5xx: es el proveedor, no la key.
    console.warn(`[ai-key-check] ${providerId} respondio ${response.status} al verificar la key`);
    return { ok: true, models: [], detail: softFailNote(label, `respondio HTTP ${response.status}`) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: true, models: [], detail: softFailNote(label, "devolvio una respuesta que no se pudo leer") };
  }

  const models = extractModels(providerId, body);
  return {
    ok: true,
    models,
    detail:
      models.length > 0
        ? `Key verificada contra ${label}: la cuenta ve ${models.length} modelo(s) de texto.`
        : `Key verificada contra ${label}, pero no devolvio ningun modelo de texto.`,
  };
}

function softFailNote(label: string, reason: string): string {
  return `No se pudo verificar la key contra ${label} (${reason}). Se guardo igual: si no sirve, el agente lo va a avisar en el primer intento.`;
}

/** Los ids de modelo de texto que devuelve cada proveedor, ya normalizados. */
function extractModels(providerId: string, body: unknown): string[] {
  const asObject = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  if (providerId === "anthropic") {
    const data = asObject(body).data;
    if (!Array.isArray(data)) return [];
    return dedupe(
      data
        .map((m) => asObject(m).id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
  }

  if (providerId === "openai") {
    const data = asObject(body).data;
    if (!Array.isArray(data)) return [];
    return dedupe(
      data
        .map((m) => asObject(m).id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        // Solo los de chat: gpt-*, o1/o3/o4 y sucesores numerados.
        .filter((id) => /^(gpt-|o\d)/.test(id))
        .filter((id) => !OPENAI_NOT_CHAT.test(id)),
    );
  }

  if (providerId === "google_ai") {
    const models = asObject(body).models;
    if (!Array.isArray(models)) return [];
    return dedupe(
      models
        .filter((m) => {
          const methods = asObject(m).supportedGenerationMethods;
          return Array.isArray(methods) && methods.includes("generateContent");
        })
        .map((m) => asObject(m).name)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        // Vienen como "models/gemini-2.5-flash"; el SDK quiere el id pelado.
        .map((name) => name.replace(/^models\//, "")),
    );
  }

  return [];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
