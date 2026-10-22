/**
 * Los canales de la bandeja que salen de la lista de cuentas de Zernio.
 *
 * Era el cuerpo de POST /api/v1/channels/sync («Sincronizar canales») y se movio
 * aca sin cambiarle nada para que lo use tambien el aviso de Zernio de una cuenta
 * conectada o desconectada (`account.connected` / `account.disconnected`, ver
 * `lib/channels/zernio-account-events.ts`). Antes, una segunda Instagram conectada
 * en Zernio despues de guardar la clave no tenia canal hasta que alguien apretara
 * el boton, y sus DMs rebotaban con 404 en el receptor.
 *
 * Crea un canal por cada cuenta nueva que la bandeja sabe manejar, actualiza el
 * nombre y la foto de las que ya estaban, y desactiva las que Zernio ya no lista.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isSupportedPlatform } from "@/lib/platforms";
import { notifyNewChannelAccess } from "@/lib/channels/new-channel-access";
import { accountLabel } from "@/lib/inbox/accounts";

type Db = SupabaseClient<Database>;

/** Una cuenta como la devuelve `accounts.listAccounts` de Zernio, en lo que le importa a la bandeja. */
export interface ZernioListedAccount {
  _id?: string;
  platform?: string;
  username?: string | null;
  displayName?: string | null;
  /** El tipo del SDK no lo declara, pero la API lo devuelve. */
  profilePicture?: string | null;
}

export interface ZernioChannelSyncResult {
  created: number;
  updated: number;
  deactivated: number;
  /** Redes que Zernio conecta pero la bandeja no maneja (TikTok, YouTube, cuentas de anuncios...). */
  skipped: string[];
  /** Cuentas que no se pudieron guardar, con el motivo. */
  failed: string[];
  /** Los canales recien creados: los que hay que llenar con sus conversaciones anteriores. */
  createdChannels: Array<{ id: string; late_account_id: string; platform: string }>;
}

export async function syncZernioChannels(params: {
  /** Con quien se escribe `channels`: el cliente del usuario en el boton, el de servicio en el webhook. */
  supabase: Db;
  /** El cliente de servicio para el aviso de la cuenta nueva (la tabla de avisos no tiene policy de INSERT). */
  service: () => Promise<Db>;
  workspaceId: string;
  accounts: ZernioListedAccount[];
}): Promise<ZernioChannelSyncResult> {
  const { supabase, workspaceId, accounts } = params;

  // Solo los canales de Zernio: este sync sale de la lista de cuentas de
  // Zernio, asi que un canal de WhatsApp (Evolution) no aparece ahi y el
  // barrido de abajo lo desactivaria.
  const { data: existingChannels } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", "zernio");

  const existingByZernioId = new Map((existingChannels ?? []).map((c) => [c.late_account_id, c]));

  const lateAccountIds = new Set(accounts.map((a) => a._id).filter(Boolean));
  const result: ZernioChannelSyncResult = {
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: [],
    failed: [],
    createdChannels: [],
  };

  for (const account of accounts) {
    if (!account._id) continue;
    // A Zernio key also carries accounts we can't drive (TikTok, YouTube,
    // ads accounts...). Inserting those hit the channels platform check
    // constraint and, since the error was discarded, vanished silently.
    if (!isSupportedPlatform(account.platform)) {
      if (account.platform) result.skipped.push(account.platform);
      continue;
    }
    const profilePic = account.profilePicture || null;

    const existing = existingByZernioId.get(account._id);

    if (existing) {
      if (
        existing.username !== (account.username || null) ||
        existing.display_name !== (account.displayName || account.username || null) ||
        existing.profile_picture !== profilePic
      ) {
        await supabase
          .from("channels")
          .update({
            username: account.username || null,
            display_name: account.displayName || account.username || null,
            profile_picture: profilePic,
          })
          .eq("id", existing.id);
        result.updated++;
      }
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("channels")
        .insert({
          workspace_id: workspaceId,
          platform: account.platform,
          provider: "zernio",
          late_account_id: account._id,
          username: account.username || null,
          display_name: account.displayName || account.username || null,
          profile_picture: profilePic,
          is_active: true,
        })
        .select("id")
        .maybeSingle();
      if (insertErr) {
        // Reporting a channel we did not store is how #16 stayed hidden:
        // the platform check constraint rejected the row and the UI said OK.
        console.error("[channels/sync] channel insert failed:", insertErr);
        result.failed.push(`${account.platform}: ${insertErr.message}`);
        continue;
      }
      result.created++;
      if (inserted) {
        result.createdChannels.push({ id: inserted.id, late_account_id: account._id, platform: account.platform });
        // Los roles que eligen cuenta por cuenta no la ven: se avisa (00249). Nunca lanza.
        await notifyNewChannelAccess(await params.service(), {
          workspaceId,
          channelId: inserted.id,
          label: accountLabel({ platform: account.platform, username: account.username ?? null, display_name: account.displayName ?? null }),
        });
      }
    }
  }

  // Deactivate channels whose Zernio accounts no longer exist
  for (const channel of existingChannels ?? []) {
    if (!lateAccountIds.has(channel.late_account_id) && channel.is_active) {
      await supabase.from("channels").update({ is_active: false }).eq("id", channel.id);
      result.deactivated++;
    }
  }

  return result;
}
