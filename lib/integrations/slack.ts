/**
 * Slack (Servicios A4, F133 y F158): un cliente fino sobre `fetch`, sin SDK.
 *
 * Dos llamadas de la API web de Slack, las dos con el token del bot (`xoxb-…`) del negocio, leído de Vault por quien
 * llama:
 *   - `authTest`: que el token sirva, y el nombre del espacio de trabajo (para la tarjeta).
 *   - `postMessage`: un mensaje directo a una persona (por su ID, `U…`/`W…`) o a un canal (`C…`/`G…`).
 *
 * Nunca loguea el token, el ID ni el texto. Slack contesta 200 con `{ ok: false, error }` cuando algo está mal: eso se
 * traduce a un motivo en palabras. Solo un error de red (o un 5xx / 429) es «temporal»: quien llama decide si
 * reintenta.
 *
 * Solo servidor.
 */

import type { FetchLike } from "@/lib/oauth/types";

const SLACK_API = "https://slack.com/api";

export const SLACK_TOKEN_PATTERN = /^xoxb-[A-Za-z0-9-]{10,}$/;
/** El ID de una persona de Slack (el que se carga en Mi cuenta). */
export const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,}$/;
/** El ID de un canal (para la acción «Enviar a Slack»). */
export const SLACK_CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]{2,}$/;

export type SlackFailure = { ok: false; error: string; temporary: boolean; invalidToken: boolean };

export function isSlackUserId(value: string | null | undefined): boolean {
  return typeof value === "string" && SLACK_USER_ID_PATTERN.test(value.trim());
}

export function isSlackChannelId(value: string | null | undefined): boolean {
  return typeof value === "string" && SLACK_CHANNEL_ID_PATTERN.test(value.trim());
}

const INVALID_TOKEN = new Set(["invalid_auth", "not_authed", "account_inactive", "token_revoked", "token_expired"]);

/** El motivo en palabras de un error de Slack. */
export function slackErrorMessage(code: string): string {
  if (INVALID_TOKEN.has(code)) return "Slack rechazó el token: revisalo en Integraciones.";
  switch (code) {
    case "missing_scope":
      return "A la app de Slack le falta un permiso (chat:write, im:write o users:read).";
    case "channel_not_found":
      return "Slack no encontró ese canal o esa persona.";
    case "user_not_found":
      return "Slack no encontró a esa persona: revisá el ID de Slack.";
    case "not_in_channel":
      return "El bot de Slack no está en ese canal: invitalo primero.";
    case "is_archived":
      return "Ese canal de Slack está archivado.";
    case "msg_too_long":
      return "El mensaje es demasiado largo para Slack.";
    case "ratelimited":
      return "Slack pidió esperar un momento.";
    default:
      return "Slack no aceptó el mensaje.";
  }
}

async function call(
  method: string,
  token: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<{ ok: true; data: Record<string, unknown> } | SlackFailure> {
  let res: Response;
  try {
    res = (await fetchImpl(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    })) as Response;
  } catch {
    return { ok: false, error: "No pude comunicarme con Slack.", temporary: true, invalidToken: false };
  }
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, error: "Slack no respondió. Probá de nuevo en un rato.", temporary: true, invalidToken: false };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Slack respondió algo que no entiendo.", temporary: res.status >= 500, invalidToken: false };
  }
  if (data.ok !== true) {
    const code = typeof data.error === "string" ? data.error : "unknown";
    return { ok: false, error: slackErrorMessage(code), temporary: code === "ratelimited", invalidToken: INVALID_TOKEN.has(code) };
  }
  return { ok: true, data };
}

/** Que el token sirva. Devuelve el espacio de trabajo. */
export async function authTest(token: string, fetchImpl?: FetchLike): Promise<{ ok: true; team: string | null } | SlackFailure> {
  const t = token.trim();
  if (!SLACK_TOKEN_PATTERN.test(t)) {
    return { ok: false, error: "El token del bot empieza con xoxb-.", temporary: false, invalidToken: true };
  }
  const r = await call("auth.test", t, {}, fetchImpl);
  if (!r.ok) return r;
  return { ok: true, team: typeof r.data.team === "string" ? r.data.team : null };
}

/** Un mensaje a una persona (ID `U…`/`W…`) o a un canal. Devuelve el `ts` del mensaje. */
export async function postMessage(
  token: string,
  to: string,
  text: string,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; ts: string | null } | SlackFailure> {
  const dest = to.trim();
  if (!isSlackUserId(dest) && !isSlackChannelId(dest)) {
    return { ok: false, error: "Ese ID de Slack no tiene el formato correcto.", temporary: false, invalidToken: false };
  }
  const body = text.trim().slice(0, 3900);
  if (!body) return { ok: false, error: "El mensaje está vacío.", temporary: false, invalidToken: false };
  const r = await call("chat.postMessage", token.trim(), { channel: dest, text: body, unfurl_links: false }, fetchImpl);
  if (!r.ok) return r;
  return { ok: true, ts: typeof r.data.ts === "string" ? r.data.ts : null };
}

/** El texto de un aviso para Slack: título, cuerpo y link. */
export function slackNotificationText(input: { title: string; body?: string | null; url?: string | null }): string {
  const lines = [`*${input.title.trim()}*`];
  if (input.body?.trim()) lines.push(input.body.trim());
  if (input.url) lines.push(input.url);
  return lines.join("\n");
}
