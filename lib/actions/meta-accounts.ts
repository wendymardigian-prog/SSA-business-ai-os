"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  applySelection,
  fetchAdAccounts,
  mergeAdAccounts,
  parseMetaConfig,
  type AdAccount,
} from "@/lib/meta/accounts";
import { getMetaToken, resolveIgAccount } from "@/lib/meta/token";
import type { Json } from "@/lib/types/database";

/**
 * Elegir que cuentas publicitarias se sincronizan (F40).
 *
 * Las cuentas no se cargan a mano: se descubren con el token y se muestran
 * con una casilla. Pedirle a alguien que copie un `act_1234567` del Business
 * Manager es pedirle que se equivoque en un digito y despues no entienda por
 * que no hay datos.
 *
 * Viven en `integration_configs.config.ad_accounts`, no en una tabla: son
 * cinco filas que describen que sincronizar.
 */

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";

export type MetaActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function loadMeta() {
  const ctx = await getAdminContext();
  if (!ctx) return null;

  const { data: row } = await ctx.supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", ctx.workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  return { ctx, config: parseMetaConfig(row?.config) };
}

async function saveConfig(
  ctx: NonNullable<Awaited<ReturnType<typeof getAdminContext>>>,
  config: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await ctx.supabase
    .from("integration_configs")
    .update({ config: config as Json })
    .eq("workspace_id", ctx.workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta");

  if (error) {
    console.error("[meta] no pude guardar la config:", error.message);
    return false;
  }
  return true;
}

/**
 * Vuelve a preguntarle al grafo que cuentas alcanza el token.
 *
 * Tambien resuelve la cuenta de Instagram, que es lo que necesita el lector
 * de Graph (F43). Las dos cosas salen del mismo token y de la misma vuelta
 * al Business Manager: separarlas serian dos botones para una sola idea.
 */
export async function refreshMetaAccounts(): Promise<MetaActionResult<{ accounts: AdAccount[] }>> {
  const loaded = await loadMeta();
  if (!loaded) return { ok: false, error: "Solo Owner y Admin pueden configurar integraciones" };

  const { ctx, config } = loaded;
  // Con el de servicio: desde la 00143 `read_secret` solo la ejecuta el
  // servidor. El workspace sale del guard de Admin, no del pedido.
  const token = await getMetaToken(await createServiceClient(), ctx.workspace.id);
  if (!token) return { ok: false, error: "Todavia no hay un token de Meta guardado" };

  const fetched = await fetchAdAccounts(token);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const accounts = mergeAdAccounts(fetched.accounts, config.ad_accounts);

  // La cuenta de Instagram es opcional: si el token solo tiene ads_read, las
  // metricas de anuncios funcionan igual y las de Instagram no. Eso no es un
  // error que tenga que frenar el guardado.
  const ig = await resolveIgAccount(token, fetch, config.page_id);

  const saved = await saveConfig(ctx, {
    ...config,
    ad_accounts: accounts,
    ...(ig.ok
      ? {
          ig_business_account_id: ig.account.igId,
          ig_username: ig.account.username,
          page_id: ig.account.pageId,
        }
      : {}),
  });

  if (!saved) return { ok: false, error: "No pude guardar las cuentas" };

  revalidatePath(INTEGRATIONS_PATH);
  return { ok: true, data: { accounts } };
}

/** Deja sincronizando exactamente las elegidas. */
export async function setMetaAccountSync(
  selected: string[],
): Promise<MetaActionResult<{ accounts: AdAccount[] }>> {
  const loaded = await loadMeta();
  if (!loaded) return { ok: false, error: "Solo Owner y Admin pueden configurar integraciones" };

  const { ctx, config } = loaded;
  const accounts = applySelection(config.ad_accounts, selected);

  const saved = await saveConfig(ctx, { ...config, ad_accounts: accounts });
  if (!saved) return { ok: false, error: "No pude guardar la eleccion" };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: {
      provider: "meta",
      kind: "ad_accounts_selection",
      enabled: accounts.filter((a) => a.sync_enabled).length,
    },
    performedBy: ctx.user.id,
  });

  revalidatePath(INTEGRATIONS_PATH);
  return { ok: true, data: { accounts } };
}
