"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { removeWorkspaceConnection } from "@/lib/oauth/remove-connection";
import { syncAccountsAfterChange } from "@/lib/social/sync-hook";
import { registerPublishing } from "@/lib/publishing/bootstrap";
import { unscheduleOnDisconnect } from "@/lib/publishing/disconnect-networks";
import { credentialsForPublisher } from "@/lib/publishing/credentials";

/**
 * Las conexiones de Google del negocio, una por una (00374): desconectar un
 * canal de YouTube sin tocar los otros, y desconectar Google Drive.
 *
 * Conectar no esta aca: es navegar a `/api/oauth/google/start` (un canal mas)
 * o `/api/oauth/google_drive/start`, porque el navegador tiene que ir a Google.
 *
 * Pide `integrations.manage`, lo mismo que conectar.
 */

const PATH = "/dashboard/settings/integrations";

export type GoogleConnectionResult = { ok: true; warnings?: string[] } | { ok: false; error: string };

export async function disconnectYouTubeChannel(connectionId: string): Promise<GoogleConnectionResult> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para desconectar las cuentas del negocio" };

  const service = await createServiceClient();
  const { data: row } = await service
    .from("oauth_connections")
    .select("id, vault_secret_prefix, account_label, external_account_id")
    .eq("id", connectionId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "google")
    .is("user_id", null)
    .maybeSingle();
  if (!row) return { ok: false, error: "Ese canal ya no está conectado" };

  // Lo programado por la API de YouTube en ESTE canal sale antes de borrar
  // el token (como al desconectar una integracion entera).
  const { data: account } = await service
    .from("social_accounts")
    .select("id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("platform", "youtube")
    .eq("external_id", row.external_account_id ?? "")
    .maybeSingle();
  if (account) {
    registerPublishing();
    await unscheduleOnDisconnect(service, {
      workspaceId: ctx.workspace.id,
      publisher: "youtube_api",
      socialAccountId: account.id,
      credentialsFor: (params) => credentialsForPublisher(service, params),
    });
  }

  const removed = await removeWorkspaceConnection(service, ctx.workspace.id, row);
  if (!removed.ok) return { ok: false, error: `No pude desconectar el canal: ${removed.error}` };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "delete",
    metadata: { provider: "google", kind: "youtube_channel_disconnected", label: row.account_label },
    performedBy: ctx.user.id,
  });

  // Su cuenta de YouTube queda "no disponible", no se borra: reconectar el
  // mismo canal la deja como estaba.
  const warnings = await syncAccountsAfterChange(service, ctx.workspace.id, "desconectar un canal de YouTube");
  revalidatePath(PATH, "layout");
  return warnings.length ? { ok: true, warnings } : { ok: true };
}

export async function disconnectGoogleDrive(): Promise<GoogleConnectionResult> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para desconectar las cuentas del negocio" };

  const service = await createServiceClient();
  const { data: row } = await service
    .from("oauth_connections")
    .select("id, vault_secret_prefix, account_label")
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "google_drive")
    .is("user_id", null)
    .maybeSingle();
  if (!row) return { ok: false, error: "Google Drive ya no está conectado" };

  const removed = await removeWorkspaceConnection(service, ctx.workspace.id, row);
  if (!removed.ok) return { ok: false, error: `No pude desconectar Google Drive: ${removed.error}` };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "delete",
    metadata: { provider: "google", kind: "drive_disconnected" },
    performedBy: ctx.user.id,
  });

  revalidatePath(PATH, "layout");
  return { ok: true };
}
