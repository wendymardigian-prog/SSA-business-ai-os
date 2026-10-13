/**
 * Reglas puras de los endpoints de webhooks entrantes (F3, F5): el token, la URL, las
 * validaciones de lo que escribe la persona y la regla de borrado. Sin base ni red.
 */
import { randomBytes } from "node:crypto";
import { TOKEN_RE } from "./receive";

/** 16 bytes aleatorios en base64url = 22 caracteres URL-safe (~128 bits). */
export function generateToken(): string {
  return randomBytes(16).toString("base64url");
}

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/** La URL que se pega en el formulario externo. */
export function hookUrl(baseUrl: string | null | undefined, token: string): string {
  const base = (baseUrl ?? "").replace(/\/+$/, "");
  return `${base}/api/hooks/${token}`;
}

/** Cuantos envios se reprocesan a la vez como maximo. */
export const MAX_REPROCESS_BATCH = 100;

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const EVENT_PATH_MAX = 200;

export interface EndpointInput {
  name: string;
  description: string | null;
  eventIdPath: string | null;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Valida y normaliza lo que escribe la persona al crear o editar un endpoint. */
export function validateEndpointInput(input: { name?: unknown; description?: unknown; eventIdPath?: unknown }): Validation<EndpointInput> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Poné un nombre para el endpoint." };
  if (name.length > NAME_MAX) return { ok: false, error: `El nombre no puede pasar de ${NAME_MAX} caracteres.` };

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > DESCRIPTION_MAX) return { ok: false, error: `La descripción no puede pasar de ${DESCRIPTION_MAX} caracteres.` };

  const eventIdPath = typeof input.eventIdPath === "string" ? input.eventIdPath.trim() : "";
  if (eventIdPath.length > EVENT_PATH_MAX) return { ok: false, error: "La ruta del id del envío es demasiado larga." };
  // Una ruta con puntos: "event_id", "data.id", "items.0.id". Nada de espacios ni símbolos raros.
  if (eventIdPath && !/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/.test(eventIdPath)) {
    return { ok: false, error: "La ruta del id del envío tiene que ser algo como event_id o data.id (letras, números y puntos)." };
  }

  return { ok: true, value: { name, description: description || null, eventIdPath: eventIdPath || null } };
}

const SAMPLE_MAX_BYTES = 256 * 1024;

/** Un JSON pegado a mano como ejemplo: tiene que ser un objeto. */
export function parseSampleJson(text: unknown): Validation<Record<string, unknown>> {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "Pegá un JSON de ejemplo." };
  if (Buffer.byteLength(text) > SAMPLE_MAX_BYTES) return { ok: false, error: "El ejemplo pesa más de 256 KB." };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "El ejemplo tiene que ser un objeto JSON, por ejemplo {\"email\": \"ana@mail.com\"}." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: `El JSON no es válido: ${err instanceof Error ? err.message : "no se pudo leer"}` };
  }
}

export interface FlowUsingEndpoint {
  id: string;
  name: string;
  status: string;
}

/** Un endpoint no se borra si un flujo PUBLICADO lo usa: se ofrece pausarlo. */
export function deleteBlockedBy(flows: FlowUsingEndpoint[]): { ok: true } | { ok: false; error: string; flowNames: string[] } {
  const published = flows.filter((f) => f.status === "published");
  if (published.length === 0) return { ok: true };
  const names = published.map((f) => `«${f.name}»`);
  return {
    ok: false,
    flowNames: published.map((f) => f.name),
    error: `No se puede borrar: lo usa ${published.length === 1 ? "el flujo" : "los flujos"} ${names.join(", ")}. Pausá el endpoint o despublicá el flujo primero.`,
  };
}
