/**
 * El único lugar que habla con la API de Conversiones de Meta: `POST /{pixel}/events` y la prueba del Pixel.
 *
 * Nunca lanza: un fallo vuelve como resultado, con `transient` diciendo si vale la pena reintentar (límite de uso, un
 * error del servidor de Meta, la red). Nunca se loguea el cuerpo (lleva datos de la persona, aunque con hash) ni el
 * token: el token viaja en el cuerpo del pedido, no en la URL, para que no quede en ningún log de acceso.
 *
 * Tiene su propia versión de la Graph API (no la de los insights de anuncios, `lib/meta/graph.ts`): la API de
 * Conversiones se mueve aparte y un cambio de versión de uno no tiene que tocar al otro.
 */

import { humanizeGraphError, isTransientGraphError, type GraphError } from "@/lib/meta/graph";
import type { MetaServerEvent } from "./build-event";

export const CAPI_GRAPH_VERSION = "v26.0";
const CAPI_GRAPH = `https://graph.facebook.com/${CAPI_GRAPH_VERSION}`;
/** Meta recomienda 1,5 s; se deja margen porque corre en la cola, no frente a una persona. */
const TIMEOUT_MS = 10_000;

export type CapiSendResult =
  | { ok: true; eventsReceived: number; fbtraceId: string | null }
  | { ok: false; transient: boolean; error: string; code: number | null };

const PIXEL_ID_RE = /^\d{5,25}$/;

export function isPixelId(value: unknown): value is string {
  return typeof value === "string" && PIXEL_ID_RE.test(value.trim());
}

async function postJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; json: Record<string, unknown> | null } | { networkError: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (err) {
    return { networkError: err instanceof Error && err.name === "AbortError" ? "Meta no respondió a tiempo." : "No pude comunicarme con Meta." };
  } finally {
    clearTimeout(timer);
  }
}

function failureFrom(status: number, json: Record<string, unknown> | null): CapiSendResult {
  const raw = (json?.error ?? null) as GraphError | null;
  const error: GraphError = raw ?? { message: `HTTP ${status}`, code: status };
  const transient = isTransientGraphError(error) || status >= 500 || status === 429;
  return { ok: false, transient, error: describeCapiError(error), code: typeof error.code === "number" ? error.code : status };
}

/** El error de Meta en palabras, para la lista de envíos. */
export function describeCapiError(error: GraphError): string {
  if (error.code === 190) return "El token de la API de Conversiones no sirve más. Generá uno nuevo en Events Manager.";
  if (error.code === 200 || error.code === 10) return "El token no tiene permiso para mandar eventos a este Pixel.";
  if (error.code === 100) return `Meta rechazó el evento: ${(error.message ?? "un dato no es válido").slice(0, 200)}`;
  return humanizeGraphError(error).slice(0, 300);
}

/** Manda los eventos a un Pixel. Con `testEventCode`, Meta los muestra solo en «Probar eventos» de Events Manager. */
export async function sendCapiEvents(input: {
  pixelId: string;
  token: string;
  events: MetaServerEvent[];
  testEventCode?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CapiSendResult> {
  if (!isPixelId(input.pixelId)) return { ok: false, transient: false, error: "El ID del Pixel no es válido.", code: null };
  if (input.events.length === 0 || input.events.length > 1000) return { ok: false, transient: false, error: "Un envío lleva entre 1 y 1000 eventos.", code: null };
  const body: Record<string, unknown> = { data: input.events, access_token: input.token };
  const testCode = (input.testEventCode ?? "").trim();
  if (testCode) body.test_event_code = testCode;

  const res = await postJson(`${CAPI_GRAPH}/${input.pixelId.trim()}/events`, body, input.fetchImpl ?? fetch);
  if ("networkError" in res) return { ok: false, transient: true, error: res.networkError, code: null };
  if (res.status >= 400 || res.json?.error) return failureFrom(res.status, res.json);

  const received = Number(res.json?.events_received ?? 0);
  const fbtrace = typeof res.json?.fbtrace_id === "string" ? res.json.fbtrace_id : null;
  if (!Number.isFinite(received) || received < input.events.length) {
    return { ok: false, transient: false, error: "Meta no recibió el evento.", code: null };
  }
  return { ok: true, eventsReceived: received, fbtraceId: fbtrace };
}

/**
 * «Probar y guardar»: que el token sirva para ESE Pixel antes de guardarlo. Pide el Pixel por su id; un token sin
 * acceso al Pixel devuelve error, y uno vencido, el 190.
 */
export async function probeCapiPixel(pixelId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
  if (!isPixelId(pixelId)) return { ok: false, error: "El ID del Pixel tiene que ser un número (lo ves en Events Manager, arriba del nombre del Pixel)." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(`${CAPI_GRAPH}/${pixelId.trim()}`);
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", token);
    const res = await fetchImpl(url.toString(), { signal: controller.signal });
    const json = (await res.json().catch(() => null)) as { id?: string; name?: string; error?: GraphError } | null;
    if (json?.error) {
      if (isTransientGraphError(json.error)) return { ok: false, error: "Meta está limitando los pedidos. Probá de nuevo en unos minutos." };
      if (json.error.code === 100 || json.error.code === 803) return { ok: false, error: "Ese token no tiene acceso a ese Pixel, o el ID no es de un Pixel." };
      return { ok: false, error: describeCapiError(json.error) };
    }
    if (!res.ok || !json?.id) return { ok: false, error: "Meta no reconoció el Pixel con ese token." };
    return { ok: true, name: json.name ?? null };
  } catch {
    return { ok: false, error: "No pude comunicarme con Meta. Probá de nuevo." };
  } finally {
    clearTimeout(timer);
  }
}
