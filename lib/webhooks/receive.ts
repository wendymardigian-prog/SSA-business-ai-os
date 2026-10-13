/**
 * El receptor de webhooks entrantes (`POST /api/hooks/[token]`), sin framework.
 *
 * Todo lo que decide vive aca como funciones puras o con puertos inyectables
 * (`ReceiveDeps`): la ruta de Next es un envoltorio delgado. Asi el orden de las
 * validaciones se prueba sin base ni red.
 *
 * El orden es parte del contrato (F2): forma del token (sin tocar la base) ->
 * endpoint -> secreto -> tope -> tamano -> parseo -> idempotencia -> guardar ->
 * responder. Se guarda ANTES de procesar; el proceso corre despues (`after()`),
 * y si no llega a correr lo levanta el reaper.
 *
 * Nada de lo que entra se loguea: ni el token, ni el secreto, ni el payload.
 */
import { createHash } from "node:crypto";
import { isListening } from "./listen";
import { getByPath, scalarText } from "./paths";

/** 22 caracteres URL-safe (16 bytes aleatorios en base64url). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const MAX_BODY_BYTES = 256 * 1024;
/** Tope por endpoint y por hora. */
export const HOOKS_PER_HOUR = 600;
export const HOUR_MS = 60 * 60 * 1000;
/** Ventana en la que un cuerpo identico (sin id de envio) cuenta como repetido. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
export const USER_AGENT_MAX = 300;

export type { InboundStatus } from "./types";
import type { InboundStatus } from "./types";

export function isValidTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

// ---------------------------------------------------------------------------
// Parseo del cuerpo
// ---------------------------------------------------------------------------

export interface ParsedBody {
  payload: Record<string, unknown>;
  /** Motivo si el cuerpo no se pudo entender; el envio igual se guarda. */
  error: string | null;
}

/** Un objeto plano a partir de pares clave/valor; una clave repetida pasa a lista. */
export function entriesToObject(entries: Iterable<[string, string]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = value;
    } else if (Array.isArray(out[key])) {
      (out[key] as unknown[]).push(value);
    } else {
      out[key] = [out[key], value];
    }
  }
  return out;
}

const baseType = (contentType: string | null): string => (contentType ?? "").split(";")[0].trim().toLowerCase();

/**
 * El cuerpo como objeto.
 *
 * - JSON: el objeto. Si la raiz no es un objeto (lista, numero) va en `{ _value }`
 *   para que el payload siempre sea un objeto.
 * - form-urlencoded: el objeto plano.
 * - otro tipo: se intenta JSON y, si no, `{ _raw }`.
 * - JSON roto: `{ _raw }` con error "cuerpo no es JSON" (nunca un 400: la persona
 *   lo ve en el historial y puede arreglar el emisor).
 */
export function parseBody(raw: string, contentType: string | null): ParsedBody {
  const type = baseType(contentType);
  if (type === "application/x-www-form-urlencoded") {
    return { payload: entriesToObject(new URLSearchParams(raw).entries()), error: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { payload: {}, error: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { payload: parsed as Record<string, unknown>, error: null };
    }
    return { payload: { _value: parsed }, error: null };
  } catch {
    if (type === "application/json" || type.endsWith("+json")) {
      return { payload: { _raw: raw.slice(0, MAX_BODY_BYTES) }, error: "cuerpo no es JSON" };
    }
    // Un tipo desconocido que no es JSON: se guarda el texto, sin marcarlo como error.
    return { payload: { _raw: raw.slice(0, MAX_BODY_BYTES) }, error: null };
  }
}

/** Los parametros de la URL como objeto plano. */
export function queryToObject(searchParams: URLSearchParams): Record<string, unknown> {
  return entriesToObject(searchParams.entries());
}

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

/** JSON con las claves ordenadas: dos cuerpos iguales con otro orden dan la misma huella. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function bodyHash(payload: unknown, query: unknown): string {
  return createHash("sha256").update(canonicalJson({ payload, query })).digest("hex");
}

/** El id del envio segun la ruta configurada en el endpoint, o null. */
export function externalEventId(payload: unknown, query: unknown, path: string | null | undefined): string | null {
  if (!path) return null;
  const fromPayload = scalarText(getByPath(payload, path), 200);
  if (fromPayload) return fromPayload;
  // Algunos emisores mandan el id en la URL: "query.event_id" tambien vale.
  const fromQuery = path.startsWith("query.") ? scalarText(getByPath({ query }, path), 200) : null;
  return fromQuery;
}

// ---------------------------------------------------------------------------
// IP truncada
// ---------------------------------------------------------------------------

/** IPv4 -> a.b.c.0/24. IPv6 -> los primeros 48 bits. Lo que no se entiende, null. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(first);
  if (v4) {
    const parts = v4.slice(1, 5).map(Number);
    if (parts.some((n) => n > 255)) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (first.includes(":") && /^[0-9a-fA-F:.]+$/.test(first)) {
    const groups = expandIpv6(first);
    if (!groups) return null;
    return `${groups.slice(0, 3).map((g) => g.toString(16)).join(":")}::/48`;
  }
  return null;
}

function expandIpv6(ip: string): number[] | null {
  // Un IPv6 con IPv4 incrustado (::ffff:1.2.3.4) -> se reemplaza la cola por dos grupos.
  let text = ip;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const nums = tail.slice(1, 5).map(Number);
    if (nums.some((n) => n > 255)) return null;
    text = text.slice(0, tail.index) + ((nums[0] << 8) | nums[1]).toString(16) + ":" + ((nums[2] << 8) | nums[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const all = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill("0"), ...rest];
  const nums = all.map((g) => parseInt(g, 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

// ---------------------------------------------------------------------------
// El flujo del receptor
// ---------------------------------------------------------------------------

export interface EndpointRow {
  id: string;
  workspace_id: string;
  status: "active" | "paused";
  secret_vault_name: string | null;
  event_id_path: string | null;
  listen_until: string | null;
}

export interface InboundInsert {
  workspaceId: string;
  endpointId: string;
  status: InboundStatus;
  payload: Record<string, unknown>;
  query: Record<string, unknown>;
  contentType: string | null;
  sizeBytes: number;
  ipPrefix: string | null;
  userAgent: string | null;
  externalEventId: string | null;
  bodyHash: string;
  errorMessage: string | null;
  summary: string | null;
}

export type InsertOutcome = { kind: "inserted"; id: string } | { kind: "duplicate" };

export interface ReceiveDeps {
  now: () => Date;
  /** null si no existe; lanza si la lectura falla (-> 500 para que el emisor reintente). */
  findEndpoint: (token: string) => Promise<EndpointRow | null>;
  /** El secreto guardado; null si no hay. */
  readSecret: (endpoint: EndpointRow) => Promise<string | null>;
  equals: (a: string, b: string) => boolean;
  /** Suma uno al tope de la hora y dice si se paso. */
  limit: (endpointId: string) => Promise<{ allowed: boolean }>;
  /** El cuerpo ya leido, o `tooLarge` si pasa el maximo. Se llama DESPUES del tope. */
  readBody: () => Promise<{ text: string; bytes: number; asContentType?: string } | { tooLarge: true }>;
  hasRecentSameBody: (endpointId: string, hash: string, since: Date) => Promise<boolean>;
  insertInbound: (row: InboundInsert) => Promise<InsertOutcome>;
  /** Guarda el ejemplo del endpoint y apaga la escucha. */
  captureSample: (endpointId: string, sample: { payload: Record<string, unknown>; query: Record<string, unknown>; captured_at: string }) => Promise<void>;
}

export interface ReceiveInput {
  token: string;
  secretHeader: string | null;
  contentType: string | null;
  searchParams: URLSearchParams;
  ip: string | null;
  userAgent: string | null;
}

export interface ReceiveResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Si es true, la ruta debe procesar el envio (`after()`). */
  process?: { inboundId: string; endpointId: string };
}

export async function receiveWebhook(deps: ReceiveDeps, input: ReceiveInput): Promise<ReceiveResult> {
  // 1. La forma del token: 404 sin tocar la base.
  if (!isValidTokenShape(input.token)) return { status: 404, body: { error: "not_found" } };

  // 2. El endpoint.
  let endpoint: EndpointRow | null;
  try {
    endpoint = await deps.findEndpoint(input.token);
  } catch {
    return { status: 500, body: { error: "internal_error" } };
  }
  if (!endpoint) return { status: 404, body: { error: "not_found" } };

  // 3. El secreto en el header, si el endpoint lo exige.
  if (endpoint.secret_vault_name) {
    let secret: string | null;
    try {
      secret = await deps.readSecret(endpoint);
    } catch {
      return { status: 500, body: { error: "internal_error" } };
    }
    // Exige secreto y en Vault no hay: estado normal mientras se configura -> 404.
    if (!secret) return { status: 404, body: { error: "not_found" } };
    if (!input.secretHeader || !deps.equals(input.secretHeader, secret)) {
      return { status: 401, body: { error: "unauthorized" } };
    }
  }

  // 4. El tope.
  const limited = await deps.limit(endpoint.id);
  if (!limited.allowed) {
    return { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "3600" } };
  }

  // 5. El tamano.
  let body: Awaited<ReturnType<ReceiveDeps["readBody"]>>;
  try {
    body = await deps.readBody();
  } catch {
    return { status: 400, body: { error: "bad_request" } };
  }
  if ("tooLarge" in body) return { status: 413, body: { error: "payload_too_large" } };

  // 6. El parseo.
  const parsed = parseBody(body.text, body.asContentType ?? input.contentType);
  const query = queryToObject(input.searchParams);

  // 7. La idempotencia.
  const now = deps.now();
  const hash = bodyHash(parsed.payload, query);
  const eventId = externalEventId(parsed.payload, query, endpoint.event_id_path);
  let status: InboundStatus;
  let errorMessage: string | null = null;
  let summary: string | null = null;

  if (!eventId && (await deps.hasRecentSameBody(endpoint.id, hash, new Date(now.getTime() - DUPLICATE_WINDOW_MS)))) {
    status = "ignored";
    summary = "Repetido: igual a un envío de los últimos 10 minutos";
  } else if (endpoint.status === "paused") {
    status = "paused";
  } else if (parsed.error) {
    status = "error";
    errorMessage = parsed.error;
  } else if (isListening(now, endpoint.listen_until)) {
    status = "captured";
  } else {
    status = "received";
  }

  // 8. Guardar.
  const outcome = await deps.insertInbound({
    workspaceId: endpoint.workspace_id,
    endpointId: endpoint.id,
    status,
    payload: parsed.payload,
    query,
    contentType: input.contentType ? input.contentType.slice(0, 200) : null,
    sizeBytes: body.bytes,
    ipPrefix: truncateIp(input.ip),
    userAgent: input.userAgent ? input.userAgent.slice(0, USER_AGENT_MAX) : null,
    externalEventId: eventId,
    bodyHash: hash,
    errorMessage,
    summary,
  });
  if (outcome.kind === "duplicate") return { status: 200, body: { ok: true, duplicate: true } };

  if (status === "captured") {
    await deps.captureSample(endpoint.id, { payload: parsed.payload, query, captured_at: now.toISOString() });
  }

  // 9. Responder; 10. procesar despues (solo si quedo "received").
  return {
    status: 200,
    body: { ok: true, id: outcome.id },
    process: status === "received" ? { inboundId: outcome.id, endpointId: endpoint.id } : undefined,
  };
}
