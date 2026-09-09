import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/auth/guards";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import {
  ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations } from "@/lib/inbox-sync";
import { isSupportedPlatform } from "@/lib/platforms";
import { channelWebhookUrl } from "@/lib/webhook-url";

/**
 * POST /api/v1/channels/sync
 *
 * Syncs all Zernio accounts as channels for the current workspace.
 * Creates new channels for accounts not yet in the DB.
 * Deactivates channels whose Zernio accounts no longer exist.
 */
export async function POST() {
  // Sincronizar canales toca la configuracion del workspace entero, igual que
  // conectarlos: no es parte del rol de un Member. La ruta hermana test-key ya
  // lo exigia; esta se habia quedado con un guard propio que solo pedia estar
  // en el workspace.
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden sincronizar canales" },
      { status: 403 }
    );
  }
  const { supabase, workspace } = ctx;

  const apiKey = await getZernioApiKey(workspace.id);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta la API key de Zernio. Cargala en Integraciones." },
      { status: 400 }
    );
  }

  const zernio = createZernioClient(apiKey);

  try {
    const res = await zernio.accounts.listAccounts();
    const lateAccounts = res.data?.accounts ?? [];

    // Solo los canales de Zernio: este sync sale de la lista de cuentas de
    // Zernio, asi que un canal de WhatsApp (Evolution) no aparece ahi y el
    // barrido de abajo lo desactivaria.
    const { data: existingChannels } = await supabase
      .from("channels")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("provider", "zernio");

    const existingByZernioId = new Map(
      (existingChannels ?? []).map((c) => [c.late_account_id, c])
    );

    // The SDK type doesn't declare profilePicture but the API returns it
    const lateAccountIds = new Set(lateAccounts.map((a: { _id?: string }) => a._id).filter(Boolean));
    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    const failed: string[] = [];

    for (const account of lateAccounts) {
      if (!account._id) continue;
      // A Zernio key also carries accounts we can't drive (TikTok, YouTube,
      // ads accounts...). Inserting those hit the channels platform check
      // constraint and, since the error was discarded, vanished silently.
      if (!isSupportedPlatform(account.platform)) {
        if (account.platform) skipped.push(account.platform);
        continue;
      }
      const acc = account as typeof account & { profilePicture?: string };
      const profilePic = acc.profilePicture || null;

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
          updated++;
        }
      } else {
        const { error: insertErr } = await supabase.from("channels").insert({
          workspace_id: workspace.id,
          platform: account.platform,
          provider: "zernio",
          late_account_id: account._id,
          username: account.username || null,
          display_name: account.displayName || account.username || null,
          profile_picture: profilePic,
          is_active: true,
        });
        if (insertErr) {
          // Reporting a channel we did not store is how #16 stayed hidden:
          // the platform check constraint rejected the row and the UI said OK.
          console.error("[channels/sync] channel insert failed:", insertErr);
          failed.push(`${account.platform}: ${insertErr.message}`);
          continue;
        }
        created++;
      }
    }

    // Deactivate channels whose Zernio accounts no longer exist
    let deactivated = 0;
    for (const channel of existingChannels ?? []) {
      if (!lateAccountIds.has(channel.late_account_id) && channel.is_active) {
        await supabase
          .from("channels")
          .update({ is_active: false })
          .eq("id", channel.id);
        deactivated++;
      }
    }

    // Registrar (o corregir) el webhook en Zernio, que es lo que hace que los
    // DMs entren a la bandeja. No bloquea el sync si falla, pero el resultado
    // vuelve en la respuesta: el webhook estuvo apuntando a localhost durante
    // semanas porque este error se escribia en la consola del servidor y nada
    // se lo decia a quien tocaba el boton.
    let webhook: { url?: string; action?: string; error?: string };
    try {
      const secret = await getOrCreateWorkspaceWebhookSecret(supabase, workspace.id);
      const url = channelWebhookUrl("zernio");
      const { action } = await ensureWebhookRegistered(zernio, {
        url,
        secret,
        events: ["message.received", "comment.received"],
      });
      webhook = { url, action };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[channels/sync] webhook auto-registration failed:", message);
      webhook = { error: message };
    }

    // Backfill conversations that predate webhook registration (best-effort).
    let conversationsImported = 0;
    try {
      const { data: activeChannels } = await supabase
        .from("channels")
        .select("id, late_account_id, platform")
        .eq("workspace_id", workspace.id)
        .eq("provider", "zernio")
        .eq("is_active", true);

      const { imported } = await backfillInboxConversations({
        supabase,
        service: await createServiceClient(),
        zernio,
        workspaceId: workspace.id,
        channels: activeChannels ?? [],
      });
      conversationsImported = imported;
    } catch (err) {
      console.error("[channels/sync] inbox backfill failed:", err);
    }

    // La lista que vuelve a la UI si lleva todos los canales, no solo los de
    // Zernio: la pantalla los muestra juntos.
    const { data: channels } = await supabase
      .from("channels")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      channels: channels ?? [],
      webhook,
      synced: {
        created,
        updated,
        deactivated,
        conversationsImported,
        skipped: [...new Set(skipped)],
        failed,
      },
    });
  } catch (error) {
    console.error("Failed to sync channels:", error);
    return NextResponse.json(
      { error: `Failed to sync channels: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
