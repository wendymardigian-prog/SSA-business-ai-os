/**
 * "Mandame un link de baja nuevo" (`POST /api/public/email/unsubscribe-link`).
 *
 * La web de un negocio puede tener links de baja viejos que ya no sirven (los de un
 * sistema anterior). Su página de baja le pide el email a la persona y llama acá: si
 * ese email es de un contacto del workspace, le llega un email TRANSACCIONAL con su
 * link `/baja/<token>`.
 *
 * Reglas:
 *  - Responde SIEMPRE `{ ok: true }` (salvo un cuerpo ilegible): no revela quién está
 *    en la lista. El envío va DESPUÉS de responder (`after()`), así la respuesta tarda lo
 *    mismo exista o no el email.
 *  - El workspace sale de su slug (`workspaces.slug`), en el cuerpo o en `?workspace=`. El origen tiene que ser uno de
 *    sus orígenes permitidos, o la propia app, o ninguno (curl); si no, no se hace nada.
 *  - Topes: 5 por hora por IP y 3 por día por email (por workspace). Honeypot.
 *  - Nunca se loguea el email.
 *
 * PURO salvo por los puertos: `createUnsubscribeLinkPorts` (servidor) los arma con la
 * base y Resend; los tests, con simulados.
 */
import { z } from "zod";
import type { LimitResult, LimitSpec } from "@/lib/antispam/rate-limit";
import { corsHeaders, decideOrigin, type OriginDecision } from "@/lib/http/cors";
import type { WebsiteSettings } from "@/lib/settings/website";
import { normalizeEmailAddress } from "./subscription";

export const UNSUBSCRIBE_LINK_LIMITS = {
  perIpPerHour: 5,
  perEmailPerDay: 3,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UNSUBSCRIBE_LINK_METHODS = ["POST"];

const bodySchema = z.object({
  workspace: z.string().max(100).optional(),
  email: z.string().max(320),
  honeypot: z.string().max(500).optional(),
});

export interface UnsubscribeLinkPorts {
  limit(spec: LimitSpec): Promise<LimitResult>;
  /** Hash con sal (el mismo de las IPs): las claves de los topes no guardan el email. */
  hash(value: string): string;
  findWorkspace(slug: string): Promise<{ id: string; settings: WebsiteSettings } | null>;
  /** El token de baja del contacto con ese email en el workspace, o null. Puede lanzar. */
  findToken(workspaceId: string, email: string): Promise<{ contactId: string; token: string } | null>;
  /** Manda el email transaccional. No lanza (lo envuelve quien llama igual). */
  sendLink(input: { workspaceId: string; contactId: string; to: string; token: string }): Promise<void>;
}

export interface UnsubscribeLinkInput {
  /** El cuerpo ya parseado (JSON). `undefined` = ilegible. */
  body: unknown;
  ip: string;
  origin: string | null;
  /** Los orígenes de la propia app (`selfOrigins`). */
  self: string[];
  /**
   * El slug del workspace que vino en la URL (`?workspace=`). El preflight del navegador no
   * trae el cuerpo, así que la web lo pone en la URL; si el cuerpo también lo trae, gana el cuerpo.
   */
  queryWorkspace?: string | null;
}

export interface UnsubscribeLinkOutcome {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** Lo que se hace después de responder (buscar y mandar). `null` = nada. */
  later: (() => Promise<void>) | null;
  /** Por qué no se hizo nada (para los tests y un log sin datos). */
  skipped?: "honeypot" | "invalid_email" | "unknown_workspace" | "origin" | "ip_limit" | "email_limit";
}

const OK = { ok: true } as const;

export async function requestUnsubscribeLink(ports: UnsubscribeLinkPorts, input: UnsubscribeLinkInput): Promise<UnsubscribeLinkOutcome> {
  if (input.body === undefined || input.body === null || typeof input.body !== "object" || Array.isArray(input.body)) {
    return { status: 400, body: { ok: false, error: "invalid_request" }, headers: {}, later: null };
  }
  const parsed = bodySchema.safeParse(input.body);
  if (!parsed.success) return { status: 400, body: { ok: false, error: "invalid_request" }, headers: {}, later: null };
  const { email: rawEmail, honeypot } = parsed.data;
  const slug = parsed.data.workspace?.trim() || input.queryWorkspace?.trim() || "";

  // El workspace primero: sin él no se sabe qué orígenes van con CORS.
  const workspace = slug ? await ports.findWorkspace(slug) : null;
  const decision: OriginDecision = decideOrigin(input.origin, input.self, workspace?.settings ?? { allowedOrigins: [] });
  const headers = corsHeaders(decision, input.origin, UNSUBSCRIBE_LINK_METHODS);
  const done = (skipped?: UnsubscribeLinkOutcome["skipped"]): UnsubscribeLinkOutcome => ({ status: 200, body: { ...OK }, headers, later: null, skipped });

  if (decision === "denied") return done("origin");

  const ip = await ports.limit({ key: `email:unsubscribe-link:ip:${ports.hash(input.ip)}`, max: UNSUBSCRIBE_LINK_LIMITS.perIpPerHour, windowMs: HOUR_MS });
  if (!ip.allowed) return done("ip_limit");

  if (honeypot && honeypot.trim() !== "") return done("honeypot");
  if (!workspace) return done("unknown_workspace");

  const email = normalizeEmailAddress(rawEmail);
  if (!email || !EMAIL_SHAPE.test(email)) return done("invalid_email");

  const perEmail = await ports.limit({
    key: `email:unsubscribe-link:email:${ports.hash(`${workspace.id}:${email}`)}`,
    max: UNSUBSCRIBE_LINK_LIMITS.perEmailPerDay,
    windowMs: DAY_MS,
  });
  if (!perEmail.allowed) return done("email_limit");

  return {
    status: 200,
    body: { ...OK },
    headers,
    later: async () => {
      try {
        const found = await ports.findToken(workspace.id, email);
        if (!found) return;
        await ports.sendLink({ workspaceId: workspace.id, contactId: found.contactId, to: email, token: found.token });
      } catch {
        // Sin el email ni el error (puede traer datos de la persona).
        console.error(`[email] no pude mandar el link de baja pedido (workspace=${workspace.id})`);
      }
    },
  };
}
