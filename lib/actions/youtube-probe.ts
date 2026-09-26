"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parsePublishers } from "@/lib/social/accounts-schema";
import { credentialsForPublisher } from "@/lib/publishing/credentials";
import { probeVideo } from "@/lib/publishing/probe-asset";
import { applyProbe, runYouTubeProbe } from "@/lib/publishing/youtube-probe";
import type { Json } from "@/lib/types/database";

/**
 * Probar la subida directa a YouTube (F38).
 *
 * Sube un video de un segundo a la cuenta real, mira como quedo y lo borra.
 * Se aprieta a mano: nunca corre solo, porque escribe en el canal del
 * negocio.
 *
 * Lo unico que cambia en la base es el estado del publicador `youtube_api`
 * de la cuenta de YouTube. Nada mas.
 */

export type ProbeActionResult =
  | { ok: true; message: string; verified: boolean }
  | { ok: false; error: string };

export async function probeYouTubeUpload(): Promise<ProbeActionResult> {
  const { workspace, user, supabase } = await requireWorkspaceAdmin();

  const { data: account } = await supabase
    .from("social_accounts")
    .select("id, publishers")
    .eq("workspace_id", workspace.id)
    .eq("platform", "youtube")
    .maybeSingle();

  if (!account) {
    return { ok: false, error: "No hay una cuenta de YouTube conectada" };
  }

  const service = await createServiceClient();

  let credentials;
  try {
    credentials = await credentialsForPublisher(service, {
      publisherId: "youtube_api",
      workspaceId: workspace.id,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "No pude leer el token" };
  }

  const parsed = parsePublishers(account.publishers);
  if (!parsed.ok) {
    // Si lo guardado no tiene la forma esperada, escribir encima lo
    // empeoraria: mejor decirlo y no tocar nada.
    return { ok: false, error: `Los publicadores de YouTube estan mal guardados: ${parsed.error}` };
  }

  const outcome = await runYouTubeProbe({
    accessToken: credentials.token,
    video: await probeVideo(),
  });

  const entries = applyProbe(parsed.publishers, outcome, new Date().toISOString());

  const { error } = await service
    .from("social_accounts")
    .update({ publishers: entries as unknown as Json })
    .eq("id", account.id);

  if (error) {
    console.error("[youtube-probe] no pude guardar el resultado:", error.message);
    return { ok: false, error: "Probe hecho, pero no pude guardar el resultado" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    // Sin el id del video: es un video que ya no existe y no aporta nada.
    metadata: { kind: "youtube_probe", ok: outcome.ok, cleaned_up: outcome.cleanedUp },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings/integrations");
  return { ok: true, message: outcome.message, verified: outcome.ok };
}
