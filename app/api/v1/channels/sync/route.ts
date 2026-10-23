import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import {
  ensureWebhookRegistered,
  SUBSCRIBED_EVENTS,
  getOrCreateWorkspaceWebhookSecret,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations } from "@/lib/inbox-sync";
import { channelWebhookUrl } from "@/lib/webhook-url";
import { syncAccountsAfterChange } from "@/lib/social/sync-hook";
import { syncZernioChannels, type ZernioListedAccount } from "@/lib/channels/zernio-channels";

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
  const ctx = await getPermissionAction("channels.manage");
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

    // Crear, actualizar y desactivar los canales: lo mismo que hace el aviso de
    // Zernio cuando se conecta o desconecta una cuenta (account.connected).
    const { created, updated, deactivated, skipped, failed } = await syncZernioChannels({
      supabase,
      service: createServiceClient,
      workspaceId: workspace.id,
      accounts: lateAccounts as ZernioListedAccount[],
    });

    // Registrar (o corregir) el webhook en Zernio, que es lo que hace que los
    // DMs entren a la bandeja. No bloquea el sync si falla, pero el resultado
    // vuelve en la respuesta: el webhook estuvo apuntando a localhost durante
    // semanas porque este error se escribia en la consola del servidor y nada
    // se lo decia a quien tocaba el boton.
    let webhook: { url?: string; action?: string; error?: string };
    try {
      // Con el de servicio: desde la 00143 `read_secret` solo la ejecuta el
      // servidor. El workspace sale de la sesion (channels.manage).
      const secret = await getOrCreateWorkspaceWebhookSecret(await createServiceClient(), workspace.id);
      const url = channelWebhookUrl("zernio");
      const { action } = await ensureWebhookRegistered(zernio, {
        url,
        secret,
        events: SUBSCRIBED_EVENTS,
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

    // Sincronizar canales también actualiza las cuentas sociales (F74). Un
    // fallo no tumba la respuesta: viaja como aviso.
    const socialWarnings = await syncAccountsAfterChange(supabase, workspace.id, "sincronizar canales");

    return NextResponse.json({
      channels: channels ?? [],
      webhook,
      warnings: socialWarnings,
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
      { error: `No pude sincronizar los canales: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
