/**
 * Cliente de Evolution API (WhatsApp por Baileys).
 *
 * Evolution corre como servicio aparte (Railway). Este modulo es lo unico que
 * le habla: crear la instancia, pedir el QR, consultar el estado, mandar
 * mensajes y desconectar.
 *
 * Sobre v1 vs v2: los endpoints tienen el mismo nombre pero cambian los cuerpos
 * (sendText, webhook) y algunas respuestas. En vez de pedirle al usuario que
 * sepa que version corre, el cliente lo averigua una vez con GET / y adapta.
 *
 * La instancia de Evolution puede estar compartida con otro sistema, asi que:
 * - Cada instancia que crea este proyecto lleva el prefijo EVOLUTION_INSTANCE_PREFIX.
 * - Nunca se toca configuracion a nivel servidor ni instancias ajenas.
 */

import { toEvolutionNumber } from "@/lib/phone";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;
const REQUEST_TIMEOUT_MS = 20_000;

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instancePrefix: string;
}

/**
 * Lee la configuracion del entorno. Devuelve null si falta algo, para que la
 * UI pueda decir "WhatsApp no esta configurado" en vez de romperse.
 */
export function getEvolutionConfig(): EvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  return {
    baseUrl,
    apiKey,
    instancePrefix: process.env.EVOLUTION_INSTANCE_PREFIX?.trim() || "ssa",
  };
}

/** Nombre de instancia propio de este proyecto, para no chocar con otros sistemas. */
export function instanceNameFor(config: EvolutionConfig, workspaceId: string): string {
  return `${config.instancePrefix}-${workspaceId.slice(0, 8)}`;
}

export interface QrCode {
  /** Imagen del QR lista para <img src>. */
  base64: string | null;
  /** Codigo crudo, por si se quiere renderizar el QR del lado del cliente. */
  code: string | null;
  /** Codigo de vinculacion por numero, cuando Evolution lo ofrece. */
  pairingCode: string | null;
}

export type EvolutionState = "open" | "close" | "connecting" | "unknown";

// ── Transporte ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 5xx y errores de red se reintentan; 4xx no, porque reintentar no los arregla. */
function isRetriable(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429;
}

async function request<T>(
  config: EvolutionConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let lastError: EvolutionError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          apikey: config.apiKey,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (!res.ok) {
        // El mensaje de Evolution se muestra al usuario; la apikey no viaja en
        // el cuerpo asi que no hay riesgo de filtrarla aca.
        const detail =
          typeof parsed === "object" && parsed !== null
            ? ((parsed as { message?: unknown; error?: unknown }).message ??
               (parsed as { error?: unknown }).error ??
               parsed)
            : parsed;
        const err = new EvolutionError(
          `Evolution API respondio ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
          res.status,
          detail,
        );
        if (!isRetriable(res.status) || attempt === MAX_ATTEMPTS) throw err;
        lastError = err;
      } else {
        return parsed as T;
      }
    } catch (err) {
      if (err instanceof EvolutionError) {
        if (!isRetriable(err.status) || attempt === MAX_ATTEMPTS) throw err;
        lastError = err;
      } else {
        const wrapped = new EvolutionError(
          `No se pudo contactar a Evolution API: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt === MAX_ATTEMPTS) throw wrapped;
        lastError = wrapped;
      }
    }

    await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  throw lastError ?? new EvolutionError("Evolution API no respondio");
}

// ── Version ──────────────────────────────────────────────────────────────────

const versionCache = new Map<string, 1 | 2>();

/**
 * 1 o 2 segun la version mayor que corre el servidor. GET / devuelve
 * { version: "2.1.1" } en v2 y { version: "1.7.4" } en v1. Ante la duda asume
 * v2, que es lo que se instala hoy.
 */
export async function getMajorVersion(config: EvolutionConfig): Promise<1 | 2> {
  const cached = versionCache.get(config.baseUrl);
  if (cached) return cached;

  let major: 1 | 2 = 2;
  try {
    const info = await request<{ version?: string }>(config, "GET", "/");
    const parsedMajor = Number.parseInt(info?.version?.split(".")[0] ?? "", 10);
    if (parsedMajor === 1) major = 1;
  } catch (err) {
    console.error("[evolution] no pude leer la version, asumo v2:", (err as Error).message);
  }

  versionCache.set(config.baseUrl, major);
  return major;
}

/** Solo para tests: olvida la version detectada. */
export function resetVersionCache(): void {
  versionCache.clear();
}

// ── Instancias ───────────────────────────────────────────────────────────────

interface RawInstance {
  instance?: { instanceName?: string; state?: string; status?: string };
  instanceName?: string;
  name?: string;
  connectionStatus?: string;
  state?: string;
  status?: string;
}

/** Normaliza el estado, que cambia de nombre y de lugar entre versiones. */
function readState(raw: RawInstance | null | undefined): EvolutionState {
  const value =
    raw?.instance?.state ??
    raw?.instance?.status ??
    raw?.connectionStatus ??
    raw?.state ??
    raw?.status;
  if (value === "open" || value === "close" || value === "connecting") return value;
  return "unknown";
}

/** Nombres de las instancias que ya existen en el servidor. Solo lectura. */
export async function listInstanceNames(config: EvolutionConfig): Promise<string[]> {
  const raw = await request<RawInstance[] | { instances?: RawInstance[] }>(
    config,
    "GET",
    "/instance/fetchInstances",
  );
  const list = Array.isArray(raw) ? raw : (raw?.instances ?? []);
  return list
    .map((i) => i.instance?.instanceName ?? i.instanceName ?? i.name)
    .filter((n): n is string => !!n);
}

/**
 * Crea la instancia si no existe. Idempotente: si Evolution contesta que ya
 * existe, se toma como exito, porque el estado que importa es "existe y es
 * nuestra", no "la cree yo en esta llamada".
 */
export async function createInstance(
  config: EvolutionConfig,
  instanceName: string,
  webhookUrl: string,
  webhookToken: string,
): Promise<void> {
  const major = await getMajorVersion(config);

  const body =
    major === 2
      ? {
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }
      : {
          instanceName,
          qrcode: true,
          token: undefined,
        };

  try {
    await request(config, "POST", "/instance/create", body);
  } catch (err) {
    const alreadyExists =
      err instanceof EvolutionError &&
      (err.status === 403 || err.status === 409) &&
      /already in use|already exists|ya existe/i.test(JSON.stringify(err.detail ?? err.message));
    if (!alreadyExists) throw err;
  }

  // El webhook se configura aparte a proposito: asi la forma del cuerpo de
  // /instance/create no depende de la version, y reconfigurarlo (cambio de URL
  // al pasar a Railway) es una sola llamada.
  await setWebhook(config, instanceName, webhookUrl, webhookToken);
}

/**
 * Apunta el webhook de ESTA instancia a nuestra URL. No toca configuracion
 * global ni la de otras instancias.
 */
export async function setWebhook(
  config: EvolutionConfig,
  instanceName: string,
  url: string,
  token: string,
): Promise<void> {
  const major = await getMajorVersion(config);
  const events = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

  // El token va como header porque el webhook queda expuesto en internet: es lo
  // unico que separa un evento real de cualquiera que descubra la URL.
  const headers = { "x-webhook-token": token };

  const body =
    major === 2
      ? { webhook: { enabled: true, url, byEvents: false, base64: false, headers, events } }
      : { enabled: true, url, webhook_by_events: false, webhook_base64: false, events };

  await request(config, "POST", `/webhook/set/${encodeURIComponent(instanceName)}`, body);
}

/**
 * QR para vincular el telefono. Si la instancia ya esta conectada, Evolution
 * no devuelve QR: eso se detecta con getConnectionState antes de llamar aca.
 */
export async function getQrCode(
  config: EvolutionConfig,
  instanceName: string,
): Promise<QrCode> {
  const raw = await request<{
    base64?: string;
    code?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; code?: string; pairingCode?: string };
  }>(config, "GET", `/instance/connect/${encodeURIComponent(instanceName)}`);

  const qr = raw?.qrcode ?? raw ?? {};
  return {
    base64: qr.base64 ?? null,
    code: qr.code ?? null,
    pairingCode: qr.pairingCode ?? null,
  };
}

export async function getConnectionState(
  config: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionState> {
  try {
    const raw = await request<RawInstance>(
      config,
      "GET",
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    return readState(raw);
  } catch (err) {
    // 404 = la instancia no existe (la borraron del lado de Evolution).
    if (err instanceof EvolutionError && err.status === 404) return "close";
    throw err;
  }
}

/** Cierra la sesion de WhatsApp pero conserva la instancia, para reconectar por QR. */
export async function logoutInstance(
  config: EvolutionConfig,
  instanceName: string,
): Promise<void> {
  try {
    await request(config, "DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  } catch (err) {
    // Ya estaba desconectada: el resultado buscado igual se cumple.
    if (err instanceof EvolutionError && (err.status === 404 || err.status === 400)) return;
    throw err;
  }
}

/** Borra la instancia del servidor. Solo para instancias con nuestro prefijo. */
export async function deleteInstance(
  config: EvolutionConfig,
  instanceName: string,
): Promise<void> {
  if (!instanceName.startsWith(`${config.instancePrefix}-`)) {
    throw new EvolutionError(
      `Me niego a borrar "${instanceName}": no lleva el prefijo de este proyecto (${config.instancePrefix}-). Puede ser de otro sistema.`,
    );
  }
  try {
    await request(config, "DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  } catch (err) {
    if (err instanceof EvolutionError && err.status === 404) return;
    throw err;
  }
}

// ── Mensajes ─────────────────────────────────────────────────────────────────

export interface SentMessage {
  /** Id del mensaje en WhatsApp, para guardarlo y no duplicarlo con el webhook. */
  id: string | null;
}

/**
 * Manda un texto. `to` puede ser un telefono o un JID entero.
 */
export async function sendText(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
  text: string,
): Promise<SentMessage> {
  const number = toEvolutionNumber(to);
  if (!number) {
    throw new EvolutionError(`Numero de WhatsApp invalido: "${to}"`);
  }

  const major = await getMajorVersion(config);
  const body =
    major === 2
      ? { number, text }
      : { number, textMessage: { text } };

  const raw = await request<{ key?: { id?: string }; messageId?: string }>(
    config,
    "POST",
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    body,
  );

  return { id: raw?.key?.id ?? raw?.messageId ?? null };
}
