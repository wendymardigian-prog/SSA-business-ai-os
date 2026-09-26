/**
 * Cuentas publicitarias de Meta (F40).
 *
 * Portado de ScaleOS (`meta-ads-accounts.ts`), con un cambio: no hay tabla
 * propia. Las cuentas viven en `integration_configs.config.ad_accounts`,
 * validadas con Zod. Son cinco o seis filas que solo describen que
 * sincronizar; una tabla con RLS para eso es una tabla de mas.
 *
 * Modulo puro: recibe el token, un `fetch` y lo que ya esta guardado.
 */

import { z } from "zod";
import { GRAPH, humanizeGraphError, type GraphError } from "./graph";

export const adAccountSchema = z.object({
  /** Siempre `act_<n>`: es el formato que espera el grafo. */
  ad_account_id: z.string().min(1),
  name: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  timezone: z.string().nullable().default(null),
  /** Si el cron la sincroniza. Las nuevas nacen apagadas. */
  sync_enabled: z.boolean().default(false),
  last_synced_at: z.string().nullable().default(null),
  last_error: z.string().nullable().default(null),
  /** Cuando se trajo el historial de 90 dias por primera vez. */
  first_sync_completed_at: z.string().nullable().default(null),
});

export type AdAccount = z.infer<typeof adAccountSchema>;

export const adAccountsSchema = z.array(adAccountSchema);

export const metaConfigSchema = z.object({
  business_id: z.string().nullable().default(null),
  /** La cuenta de Instagram que se lee por Graph (F43). */
  ig_business_account_id: z.string().nullable().default(null),
  ig_username: z.string().nullable().default(null),
  page_id: z.string().nullable().default(null),
  ad_accounts: adAccountsSchema.default([]),
});

export type MetaConfig = z.infer<typeof metaConfigSchema>;

/** Lee la config guardada. Si esta rota, devuelve una vacia en vez de lanzar. */
export function parseMetaConfig(value: unknown): MetaConfig {
  const result = metaConfigSchema.safeParse(value ?? {});
  if (result.success) return result.data;
  console.error("[meta] la config guardada no tiene la forma esperada; la trato como vacia");
  return metaConfigSchema.parse({});
}

/** Al formato `act_<n>` que espera el grafo. */
export function normalizeAdAccountId(raw: string): string {
  const id = raw.trim();
  return id.startsWith("act_") ? id : `act_${id}`;
}

export interface GraphAdAccount {
  id: string;
  name?: string | null;
  currency?: string | null;
  timezone_name?: string | null;
  account_status?: number;
}

export type FetchAccountsResult =
  | { ok: true; accounts: GraphAdAccount[] }
  | { ok: false; error: string };

/**
 * `GET /me/adaccounts`, paginado hasta agotar el cursor.
 *
 * Con tope de paginas: un cursor que no termina nunca es un bug de Meta, y
 * sin tope se lleva puesto el tiempo de la funcion.
 */
export async function fetchAdAccounts(
  token: string,
  fetchImpl: typeof fetch = fetch,
  maxPages = 20,
): Promise<FetchAccountsResult> {
  const accounts: GraphAdAccount[] = [];
  let url =
    `${GRAPH}/me/adaccounts?fields=id,name,currency,timezone_name,account_status&limit=100` +
    `&access_token=${encodeURIComponent(token)}`;

  for (let page = 0; page < maxPages && url; page += 1) {
    let body: {
      data?: GraphAdAccount[];
      paging?: { next?: string };
      error?: GraphError;
    };
    try {
      const res = await fetchImpl(url);
      body = await res.json();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (body.error) return { ok: false, error: humanizeGraphError(body.error) };

    for (const acc of body.data ?? []) {
      if (acc?.id) accounts.push({ ...acc, id: normalizeAdAccountId(acc.id) });
    }

    const next = body.paging?.next;
    if (!next) break;
    url = next;
  }

  return { ok: true, accounts };
}

/**
 * Junta lo que devolvio el grafo con lo que ya estaba guardado.
 *
 * Dos reglas: el nombre se refresca (las cuentas se renombran) y
 * `sync_enabled` se CONSERVA. Pisarlo apagaria la sincronizacion cada vez
 * que alguien abre la card.
 *
 * Las cuentas que el token ya no alcanza se conservan visibles: desaparecer
 * sin decir nada es la peor forma de enterarse de que se perdio un permiso.
 */
export function mergeAdAccounts(graphAccounts: GraphAdAccount[], existing: AdAccount[]): AdAccount[] {
  const byId = new Map(existing.map((row) => [row.ad_account_id, row]));

  const merged: AdAccount[] = graphAccounts.map((acc) => {
    const before = byId.get(acc.id);
    return {
      ad_account_id: acc.id,
      name: acc.name ?? before?.name ?? null,
      currency: acc.currency ?? before?.currency ?? null,
      timezone: acc.timezone_name ?? before?.timezone ?? null,
      sync_enabled: before?.sync_enabled ?? false,
      last_synced_at: before?.last_synced_at ?? null,
      last_error: before?.last_error ?? null,
      first_sync_completed_at: before?.first_sync_completed_at ?? null,
    };
  });

  const seen = new Set(merged.map((row) => row.ad_account_id));
  for (const row of existing) {
    if (!seen.has(row.ad_account_id)) merged.push(row);
  }

  // Orden estable: la lista y la cuenta por defecto no pueden cambiar de
  // lugar entre dos cargas de la misma pantalla.
  return merged.sort((a, b) => a.ad_account_id.localeCompare(b.ad_account_id));
}

/** Las que el cron tiene que sincronizar, en orden estable. */
export function syncedAccounts(accounts: AdAccount[]): AdAccount[] {
  return accounts
    .filter((a) => a.sync_enabled)
    .sort((a, b) => a.ad_account_id.localeCompare(b.ad_account_id));
}

export type ResolvedAccount =
  | { ok: true; adAccountId: string }
  | { ok: false; reason: "not_synced" | "no_synced_account" };

/** Sobre que cuenta opera una accion: la pedida, o la primera habilitada. */
export function resolveSyncedAccount(accounts: AdAccount[], requested?: string): ResolvedAccount {
  const enabled = syncedAccounts(accounts);

  if (requested?.trim()) {
    const id = normalizeAdAccountId(requested);
    return enabled.some((a) => a.ad_account_id === id)
      ? { ok: true, adAccountId: id }
      : { ok: false, reason: "not_synced" };
  }

  const first = enabled[0];
  return first ? { ok: true, adAccountId: first.ad_account_id } : { ok: false, reason: "no_synced_account" };
}

/** Deja tildadas exactamente las que se eligieron. */
export function applySelection(accounts: AdAccount[], selected: string[]): AdAccount[] {
  const wanted = new Set(selected.map(normalizeAdAccountId));
  return accounts.map((a) => ({ ...a, sync_enabled: wanted.has(a.ad_account_id) }));
}

/** Anota como le fue a una cuenta en la ultima sincronizacion. */
export function markSync(
  accounts: AdAccount[],
  adAccountId: string,
  outcome: { at: string; error?: string | null; firstSync?: boolean },
): AdAccount[] {
  return accounts.map((a) =>
    a.ad_account_id === adAccountId
      ? {
          ...a,
          // La fecha se actualiza aunque haya fallado: dice cuando se
          // INTENTO, y sin eso no se sabe si el cron esta corriendo.
          last_synced_at: outcome.at,
          last_error: outcome.error ?? null,
          first_sync_completed_at:
            outcome.firstSync && !outcome.error ? outcome.at : a.first_sync_completed_at,
        }
      : a,
  );
}
