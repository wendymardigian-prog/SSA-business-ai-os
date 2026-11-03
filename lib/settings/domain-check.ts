/**
 * Comprobar que un dominio propio llega a ESTE sistema antes de guardarlo (Ajustes → General → Dominio).
 *
 * Un dominio mal apuntado rompería todos los links públicos del negocio (agenda, formularios, bajas), así que no se
 * guarda a ciegas: se le pide `<dominio>/api/public/instance` y se compara la huella con la propia. La huella sale de
 * la URL del proyecto de Supabase, que ya es pública (`NEXT_PUBLIC_SUPABASE_URL`): no revela nada nuevo, y dos
 * instalaciones distintas nunca dan la misma.
 *
 * Solo servidor (crypto y la red). El pedido pasa por `safeFetch`: sin direcciones internas, con tope de tiempo.
 */

import { createHash } from "node:crypto";
import { BlockedUrlError, safeFetch } from "@/lib/net/safe-fetch";

export const INSTANCE_PATH = "/api/public/instance";

/** La huella de esta instalación. */
export function instanceFingerprint(): string {
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "sin-proyecto";
  return createHash("sha256").update(`ssa-instance:${project}`).digest("hex").slice(0, 24);
}

export type DomainCheck = { ok: true } | { ok: false; error: string };

/** `checkDomainPointsHere("https://links.empresa.com")`: abre el dominio y mira si responde este sistema. */
export async function checkDomainPointsHere(
  origin: string,
  deps: { fetchImpl?: typeof fetch; checkUrl?: (url: string) => Promise<URL>; fingerprint?: string } = {},
): Promise<DomainCheck> {
  const host = new URL(origin).host;
  const notReachable = {
    ok: false as const,
    error: `No pude abrir ${host}. Revisá que esté agregado en Railway (Settings → Networking → Custom Domain) y que el DNS apunte ahí; un cambio de DNS puede tardar hasta una hora.`,
  };
  let text: string;
  try {
    const result = await safeFetch(`${origin}${INSTANCE_PATH}`, { method: "GET", headers: { accept: "application/json" } }, {
      timeoutMs: 8_000,
      maxBytes: 4_096,
      fetchImpl: deps.fetchImpl,
      checkUrl: deps.checkUrl,
    });
    if (!result.ok) {
      return result.status === 404
        ? { ok: false, error: `${host} abre otra página, no este sistema. Revisá a dónde apunta el DNS.` }
        : notReachable;
    }
    text = result.text;
  } catch (error) {
    if (error instanceof BlockedUrlError) return { ok: false, error: "Ese dominio apunta a una dirección interna: no la puede abrir un lead." };
    return notReachable;
  }

  let instance: unknown;
  try {
    instance = (JSON.parse(text) as { instance?: unknown }).instance;
  } catch {
    instance = undefined;
  }
  if (instance !== (deps.fingerprint ?? instanceFingerprint())) {
    return { ok: false, error: `${host} abre otra página, no este sistema. Revisá a dónde apunta el DNS.` };
  }
  return { ok: true };
}
