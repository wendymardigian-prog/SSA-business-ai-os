/**
 * Los dominios de la cuenta de Resend (E8): `GET https://api.resend.com/domains`.
 *
 * La key se lee SIEMPRE en el servidor (Vault, con el cliente de servicio) y nunca
 * llega al navegador: lo que sale de aca es el nombre y el estado de cada dominio.
 * Las keys "solo envio" de Resend no pueden listar dominios (401/403): eso no es un
 * error de la pantalla, es "escribi el dominio a mano". Si Resend no contesta,
 * tampoco se bloquea nada. La lista se guarda unos minutos en memoria (por
 * workspace); "Actualizar dominios" la vuelve a pedir.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import type { ResendDomain } from "./senders";

const DOMAINS_ENDPOINT = "https://api.resend.com/domains";
const CACHE_MS = 5 * 60_000;

export type DomainList =
  | { ok: true; domains: ResendDomain[] }
  | { ok: false; reason: "no_key" | "forbidden" | "failed" };

/** Pide los dominios. Nunca lanza y nunca devuelve ni loguea la key. */
export async function listResendDomains(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<DomainList> {
  try {
    const res = await fetchImpl(DOMAINS_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden" };
    if (!res.ok) return { ok: false, reason: "failed" };
    const body = (await res.json().catch(() => null)) as { data?: Array<{ name?: unknown; status?: unknown }> } | null;
    const domains = (body?.data ?? [])
      .filter((d) => typeof d?.name === "string" && d.name)
      .map((d) => ({ name: String(d.name).toLowerCase(), status: typeof d.status === "string" ? d.status : "not_started" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, domains };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

const cache = new Map<string, { at: number; result: DomainList }>();

/**
 * Los dominios de un workspace, con la key de Vault. `refresh` saltea la memoria.
 * Un error de Vault cuenta como "no se pudo" (no como "no hay key").
 */
export async function workspaceResendDomains(
  service: SupabaseClient,
  workspaceId: string,
  opts: { refresh?: boolean; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<DomainList> {
  const now = opts.now ?? Date.now();
  const cached = cache.get(workspaceId);
  if (!opts.refresh && cached && now - cached.at < CACHE_MS) return cached.result;

  let apiKey: string | null;
  try {
    apiKey = await readSecret(service, workspaceId, SECRET_NAMES.resendApiKey);
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!apiKey) return { ok: false, reason: "no_key" };

  const result = await listResendDomains(apiKey, opts.fetchImpl);
  // Una caida no se guarda: el proximo pedido vuelve a probar.
  if (result.ok || result.reason === "forbidden") cache.set(workspaceId, { at: now, result });
  return result;
}

/** Solo tests: vacia la memoria. */
export function clearResendDomainsCache(): void {
  cache.clear();
}
