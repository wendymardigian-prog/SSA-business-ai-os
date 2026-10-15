/**
 * Lo que pasa cuando alguien abre un link con seguimiento `/l/<token>` (Extra I, F40). La ruta (`app/l/[token]/route.ts`)
 * solo conecta esto con la base y con `after()`. Se separa para probarlo sin levantar nada.
 *
 * Orden: tope por IP → leer el secreto del workspace que dice el token → verificar (formato, firma, vencimiento) →
 * si es un previsualizador, redirigir SIN registrar → si no, devolver cómo registrar el clic (la ruta lo corre DESPUÉS
 * de responder, sin demorar la redirección).
 *
 * Seguridad: el destino sale SOLO del token firmado (no existe un `?to=`): no es un open redirect. Un token alterado
 * no tiene `destination` (ver `verifyTrackedLink`) y cae a la URL de la app. NUNCA lanza, NUNCA devuelve un 500, y no
 * loguea el token.
 */
import type { TouchInput } from "@/lib/contacts/touch";
import { isLinkPreviewBot } from "./bots";
import { peekTrackedLinkWorkspace, safeRedirectTarget, verifyTrackedLink, type TrackedLinkPayload } from "./tracked-link";

/** Pedidos por minuto y por IP. */
export const LINK_CLICKS_PER_MINUTE = 120;

export interface LinkClickDeps {
  /** El secreto de ese workspace, o null si nunca se firmó nada ahí. */
  readSecret: (workspaceId: string) => Promise<string | null>;
  /** Cuenta un pedido más de esta IP. */
  limit: (ip: string) => Promise<{ allowed: boolean }>;
  /** La URL de la app (a donde cae todo lo que no se puede resolver). */
  fallbackUrl: string;
  now?: () => number;
}

export interface LinkClickResult {
  status: 302 | 429;
  location: string | null;
  /** El toque a registrar (después de responder). Null si no corresponde registrar nada. */
  touch: { workspaceId: string; contactId: string; input: TouchInput } | null;
}

const param = (url: string, key: string): string | null => {
  try {
    const v = new URL(url).searchParams.get(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
};

/** El toque de un clic: uno por día, por persona y por pieza (o por flujo si el link no es de una pieza). */
export function clickTouchFor(payload: TrackedLinkPayload, now: Date): { workspaceId: string; contactId: string; input: TouchInput } {
  const day = now.toISOString().slice(0, 10);
  const piece = payload.p ?? payload.f;
  return {
    workspaceId: payload.w,
    contactId: payload.c,
    input: {
      occurredAt: now,
      source: param(payload.u, "utm_source") ?? "web",
      medium: "dm_link",
      origin: "link_click",
      campaign: param(payload.u, "utm_campaign"),
      content: param(payload.u, "utm_content"),
      contentPostId: payload.p,
      socialPostId: payload.s,
      landingPage: payload.u,
      dedupeKey: `click:${payload.c}:${payload.f}:${piece}:${day}`,
      raw: { flow_id: payload.f, via: "tracked_link" },
    },
  };
}

export async function resolveLinkClick(args: { token: unknown; userAgent: string | null | undefined; ip: string }, deps: LinkClickDeps): Promise<LinkClickResult> {
  const fallback = deps.fallbackUrl;
  try {
    const limited = await deps.limit(args.ip);
    if (!limited.allowed) return { status: 429, location: null, touch: null };

    const workspaceId = peekTrackedLinkWorkspace(args.token);
    const secret = workspaceId ? await deps.readSecret(workspaceId) : null;
    const now = deps.now?.() ?? Date.now();
    const verified = verifyTrackedLink(args.token, secret, now);

    if (!verified.ok) {
      // Vencido o con una carga que no sirve para registrar pero con firma válida: se redirige igual al destino.
      return { status: 302, location: safeRedirectTarget(verified.destination, fallback), touch: null };
    }
    const location = safeRedirectTarget(verified.payload.u, fallback);
    if (isLinkPreviewBot(args.userAgent)) return { status: 302, location, touch: null };
    return { status: 302, location, touch: clickTouchFor(verified.payload, new Date(now)) };
  } catch {
    return { status: 302, location: fallback, touch: null };
  }
}
