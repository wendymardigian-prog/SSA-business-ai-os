import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * La confirmación extra de lo delicado (docs/mcp.md). Solo servidor.
 *
 * Una acción delicada (borrar, mandar, invitar, permisos, publicar…) pedida SIN confirmación no hace nada: devuelve un
 * resumen y un token. El token firma (persona, negocio, acción, argumentos) y vence a los 5 minutos: solo sirve para
 * repetir EXACTAMENTE lo mismo. La firma se anota en `mcp_used_confirmations` al usarse, así que sirve una sola vez.
 *
 * La clave de la firma se deriva de la service role key (secreto del servidor que ya existe): no hace falta otro
 * secreto en Vault, y si se rota la clave solo se invalidan tokens de 5 minutos.
 */

export const CONFIRM_TTL_MS = 5 * 60_000;

export interface ConfirmSubject {
  userId: string;
  workspaceId: string;
  action: string;
  args: unknown;
}

function key(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createHmac("sha256", base).update("mcp-confirm-v1").digest();
}

/** JSON estable (claves ordenadas): el mismo pedido da siempre el mismo hash. Pura. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

function digest(subject: ConfirmSubject, expiresAt: number): string {
  const argsHash = createHash("sha256").update(stableJson(subject.args)).digest("hex");
  return createHmac("sha256", key()).update(`${subject.userId}|${subject.workspaceId}|${subject.action}|${argsHash}|${expiresAt}`).digest("base64url");
}

export function issueConfirmation(subject: ConfirmSubject, now = Date.now()): string {
  const expiresAt = now + CONFIRM_TTL_MS;
  return `${expiresAt.toString(36)}.${digest(subject, expiresAt)}`;
}

export type ConfirmCheck = { ok: true; signature: string } | { ok: false; reason: "malformed" | "expired" | "mismatch" };

export function checkConfirmation(token: unknown, subject: ConfirmSubject, now = Date.now()): ConfirmCheck {
  if (typeof token !== "string" || !/^[0-9a-z]+\.[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, reason: "malformed" };
  const [exp36, sig] = token.split(".");
  const expiresAt = parseInt(exp36, 36);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };
  if (now > expiresAt) return { ok: false, reason: "expired" };
  const expected = Buffer.from(digest(subject, expiresAt));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: "mismatch" };
  return { ok: true, signature: sig };
}
