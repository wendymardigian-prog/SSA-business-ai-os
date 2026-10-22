/**
 * Zernio avisa cuando se conecta o se desconecta una cuenta (`account.connected` /
 * `account.disconnected`).
 *
 * Antes no se escuchaba ese aviso: el sistema solo le preguntaba a Zernio que
 * cuentas habia al guardar la clave o al apretar «Sincronizar canales» /
 * «Sincronizar cuentas». Una segunda Instagram conectada despues no tenia canal
 * (sus DMs rebotaban con 404 en el receptor) ni fila en `social_accounts` (no
 * aparecia en el selector de Social).
 *
 * Con el aviso se vuelve a leer la lista COMPLETA de Zernio y se pasa por los
 * mismos caminos que el boton: `syncZernioChannels` (la bandeja) y
 * `syncAccountsAfterChange` (Social y Contenido). No se arma nada a partir del
 * aviso: la lista es la fuente de verdad, y releerla hace que un aviso repetido,
 * atrasado o fuera de orden deje lo mismo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { resolveWebhookSecret, verifyWebhookSignature } from "@/lib/zernio-webhook";
import { getZernioKeyState } from "@/lib/integrations/zernio-key";
import { createZernioClient } from "@/lib/zernio-client";
import { syncZernioChannels, type ZernioListedAccount } from "@/lib/channels/zernio-channels";
import { backfillInboxConversations } from "@/lib/inbox-sync";
import { syncAccountsAfterChange } from "@/lib/social/sync-hook";

type Db = SupabaseClient<Database>;

export const ACCOUNT_EVENTS = ["account.connected", "account.disconnected"] as const;
export type AccountEventName = (typeof ACCOUNT_EVENTS)[number];

export interface AccountEvent {
  event: AccountEventName;
  /** El id de la cuenta en Zernio (`account.accountId`): el mismo que `channels.late_account_id`. */
  accountId: string | null;
}

export const isAccountEvent = (event: string | undefined): event is AccountEventName =>
  (ACCOUNT_EVENTS as readonly string[]).includes(event ?? "");

/** Lo que importa del aviso. Defensivo: un campo que falta no rompe nada. Puro. */
export function parseAccountEvent(parsed: unknown): AccountEvent | null {
  const body = parsed as { event?: string; account?: { accountId?: unknown } } | null;
  if (!body || !isAccountEvent(body.event)) return null;
  const id = body.account?.accountId;
  return { event: body.event, accountId: typeof id === "string" && id ? id : null };
}

/** Tope de negocios contra los que se prueba la firma. El sistema es de un solo negocio: sobra. */
const MAX_CANDIDATES = 50;

/**
 * De que negocio es el aviso. Una cuenta recien conectada todavia no tiene canal,
 * asi que no se la puede buscar como en un DM: el aviso viene firmado con el
 * secreto del webhook de UN negocio (`zernio_webhook_secret`, Vault), y el
 * negocio es aquel cuyo secreto valida la firma. Se prueba primero el dueño del
 * canal de esa cuenta, si ya existe (una desconexion).
 *
 * Null si ninguno valida: el que llama responde 401. Nunca lanza.
 */
export async function findWorkspaceForSignedEvent(
  service: Db,
  rawBody: string,
  signature: string | null,
  accountId: string | null,
): Promise<string | null> {
  if (!signature) return null;
  try {
    const candidates: string[] = [];

    if (accountId) {
      const { data: owners } = await service
        .from("channels")
        .select("workspace_id")
        .eq("late_account_id", accountId)
        .limit(MAX_CANDIDATES);
      for (const row of owners ?? []) candidates.push(row.workspace_id);
    }

    const { data: workspaces, error } = await service
      .from("workspaces")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(MAX_CANDIDATES);
    if (error) console.error("[webhook] no pude leer los workspaces para el aviso de cuenta:", error.message);
    for (const row of workspaces ?? []) candidates.push(row.id);

    for (const workspaceId of [...new Set(candidates)]) {
      const secret = await resolveWebhookSecret(service, { workspace_id: workspaceId, webhook_secret: null });
      if (secret && verifyWebhookSignature(secret, rawBody, signature)) return workspaceId;
    }
    return null;
  } catch (err) {
    console.error("[webhook] no pude identificar el negocio del aviso de cuenta:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Vuelve a armar los canales y las cuentas sociales del negocio desde la lista de
 * Zernio. Nunca lanza: corre en el `after()` del receptor, y un fallo deja todo
 * como estaba (el boton de Integraciones y el cron de la noche lo vuelven a intentar).
 *
 * Si Zernio no responde, NO se tocan los canales: desactivar la bandeja entera por
 * una caida de red seria mucho peor que esperar al siguiente intento.
 */
export async function refreshZernioAccounts(service: Db, workspaceId: string, motivo: string): Promise<void> {
  try {
    const key = await getZernioKeyState(workspaceId, { supabase: service as unknown as SupabaseClient });
    if (key.state === "present") {
      const zernio = createZernioClient(key.key);
      let accounts: ZernioListedAccount[] | null = null;
      try {
        const res = await zernio.accounts.listAccounts();
        accounts = (res.data?.accounts ?? []) as ZernioListedAccount[];
      } catch (err) {
        console.error(`[webhook] no pude leer las cuentas de Zernio (${motivo}):`, err instanceof Error ? err.message : err);
      }

      if (accounts) {
        const channels = await syncZernioChannels({
          supabase: service,
          service: async () => service,
          workspaceId,
          accounts,
        });

        // Los DMs que la cuenta nueva recibio antes de tener canal: lo mismo que
        // hace el boton, pero solo para los canales recien creados.
        if (channels.createdChannels.length > 0) {
          try {
            await backfillInboxConversations({
              supabase: service,
              service,
              zernio,
              workspaceId,
              channels: channels.createdChannels,
            });
          } catch (err) {
            console.error(`[webhook] no pude traer las conversaciones anteriores (${motivo}):`, err instanceof Error ? err.message : err);
          }
        }
      }
    }

    // Social y Contenido: corre siempre (tambien sin clave, que marca las cuentas
    // como «no disponibles»). Nunca lanza.
    const warnings = await syncAccountsAfterChange(service, workspaceId, motivo);
    for (const warning of warnings) console.warn(`[webhook] cuentas sociales (${motivo}): ${warning}`);
  } catch (err) {
    console.error(`[webhook] no pude actualizar las cuentas (${motivo}):`, err instanceof Error ? err.message : err);
  }
}
