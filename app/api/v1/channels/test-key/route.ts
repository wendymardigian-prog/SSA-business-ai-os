import { NextRequest, NextResponse } from "next/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getAdminContext } from "@/lib/auth/guards";
import { storeSecret, SECRET_NAMES } from "@/lib/vault";
import {
  ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations } from "@/lib/inbox-sync";
import { isSupportedPlatform } from "@/lib/platforms";
import { channelWebhookUrl } from "@/lib/webhook-url";

/**
 * POST /api/v1/channels/test-key
 *
 * Valida la API key de Zernio contra su API, la guarda en Vault, registra el
 * webhook y sincroniza los canales. Es el flujo de conexion de Instagram.
 *
 * Solo Owner/Admin: conectar un canal no es parte del rol de un Member.
 */
export async function POST(request: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden conectar canales" },
      { status: 403 }
    );
  }
  const { supabase, workspace } = ctx;

  const body = await request.json();
  const { apiKey } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json(
      { error: "apiKey is required" },
      { status: 400 }
    );
  }

  // El workspace sale de la sesion, no del body: asi nadie puede escribir la
  // key en un workspace ajeno.
  const workspaceId = workspace.id;

  // Validate the key by listing accounts
  let accounts: Array<{ _id?: string; platform?: string; username?: string; displayName?: string; profilePicture?: string }>;
  try {
    const zernio = createZernioClient(apiKey.trim());
    const res = await zernio.accounts.listAccounts();
    accounts = (res.data?.accounts ?? []) as typeof accounts;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid API key or connection error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // La key va a Vault, no a una columna en texto plano.
  const stored = await storeSecret(
    supabase,
    workspaceId,
    SECRET_NAMES.zernioApiKey,
    apiKey.trim()
  );

  if (!stored.ok) {
    return NextResponse.json(
      { error: `La key es valida pero no se pudo guardar de forma segura: ${stored.error}` },
      { status: 500 }
    );
  }

  // Queda registrada como integracion para que la pantalla muestre el estado.
  const { error: configErr } = await supabase.from("integration_configs").upsert(
    {
      workspace_id: workspaceId,
      type: "channel" as const,
      provider: "instagram_zernio",
      display_name: "Instagram (Zernio)",
      vault_secret_name: SECRET_NAMES.zernioApiKey,
      is_active: true,
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "workspace_id,type,provider" }
  );

  if (configErr) {
    // La key ya esta guardada y los canales se van a sincronizar igual; esto
    // solo afecta como se pinta el estado en la pantalla.
    console.error("[test-key] no pude registrar la integracion:", configErr.message);
  }

  // Register (or refresh) this deployment's webhook in Zernio so inbound
  // messages/comments reach the Inbox. Best-effort: a failure here must not
  // block saving the key or syncing channels.
  try {
    const secret = await getOrCreateWorkspaceWebhookSecret(supabase, workspaceId);
    const zernio = createZernioClient(apiKey.trim());
    await ensureWebhookRegistered(zernio, {
      url: channelWebhookUrl("zernio"),
      secret,
      events: ["message.received", "comment.received"],
    });
  } catch (err) {
    console.error("[test-key] webhook auto-registration failed:", err);
  }

  // Auto-sync channels
  const { data: existingChannels } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", "zernio");

  const existingByLateId = new Map(
    (existingChannels ?? []).map((c) => [c.late_account_id, c])
  );

  for (const account of accounts) {
    if (!account._id) continue;
    if (existingByLateId.has(account._id)) continue;
    if (!isSupportedPlatform(account.platform)) continue;

    const { error: insertErr } = await supabase.from("channels").insert({
      workspace_id: workspaceId,
      platform: account.platform,
      provider: "zernio",
      late_account_id: account._id,
      username: account.username || null,
      display_name: account.displayName || account.username || null,
      profile_picture: account.profilePicture || null,
      is_active: true,
    });
    if (insertErr) {
      console.error("[test-key] channel insert failed:", insertErr);
    }
  }

  // Backfill conversations that predate webhook registration so a
  // first-time API-key setup fills the Inbox immediately (best-effort).
  try {
    const { data: activeChannels } = await supabase
      .from("channels")
      .select("id, late_account_id, platform")
      .eq("workspace_id", workspaceId)
      .eq("provider", "zernio")
      .eq("is_active", true);

    await backfillInboxConversations({
      supabase,
      zernio: createZernioClient(apiKey.trim()),
      workspaceId,
      channels: activeChannels ?? [],
    });
  } catch (err) {
    console.error("[test-key] inbox backfill failed:", err);
  }

  return NextResponse.json({ accounts });
}
