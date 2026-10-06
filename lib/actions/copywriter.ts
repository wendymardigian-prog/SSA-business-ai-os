"use server";

import { revalidatePath } from "next/cache";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { enqueueCopy } from "@/lib/content/copy-queue";
import { readCopywriterConfig } from "@/lib/content/copywriter";
import { needsConfirmation } from "@/lib/content/ai-copy";

/**
 * Pedirle al copywriter que escriba, desde la pantalla (E7).
 *
 * Contesta al instante: encola y devuelve. La pieza queda diciendo "el
 * copywriter esta escribiendo" y se actualiza sola cuando termina.
 */

const CONTENT_PATH = "/dashboard/content";

export type CopyActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string; needsConfirmation?: boolean };

export async function requestCopy(input: {
  postId: string;
  /** "mas corto, mas directo". Queda guardado en el run. */
  instructions?: string | null;
  /** La persona ya confirmo que quiere pisar lo que estaba escrito. */
  confirmed?: boolean;
}): Promise<CopyActionResult<{ queued: true }>> {
  const { workspace, user, supabase, can } = await getPermissionContext();
  if (!can("content.ai")) {
    return { ok: false, error: "Generar con IA necesita el permiso de contenido con IA." };
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, status, script, copy_status")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  if (post.copy_status === "generating") {
    return { ok: false, error: "El copywriter ya esta escribiendo esta pieza." };
  }

  const cerradas = ["published", "partially_published", "archived"];
  if (cerradas.includes(post.status)) {
    return { ok: false, error: "Esa pieza ya salio: el copy no se cambia desde aca." };
  }

  // Pisar el guion de alguien sin preguntar es la clase de cosa que hace que
  // una funcion util deje de usarse.
  if (!input.confirmed && needsConfirmation({ script: post.script })) {
    return {
      ok: false,
      needsConfirmation: true,
      error: "Ya hay un guion escrito. Si seguis, el copywriter lo reemplaza (queda en el historial).",
    };
  }

  const service = await createServiceClient();
  const queued = await enqueueCopy(service, {
    workspaceId: workspace.id,
    postId: input.postId,
    instructions: input.instructions,
  });

  if (!queued.ok) return queued;

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "channel",
    entityId: workspace.id,
    action: "update",
    metadata: {
      kind: "content_copy_requested",
      post_id: input.postId,
      agent_id: queued.agentId,
      con_indicaciones: Boolean(input.instructions?.trim()),
    },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { queued: true } };
}

/** La configuracion del copywriter, para que la pantalla sepa que ofrecer. */
export async function getCopywriterSettings(): Promise<
  CopyActionResult<{ agentId: string | null; enabled: boolean; autoOnApprove: boolean }>
> {
  const { workspace, supabase, can } = await getPermissionContext();
  if (!can("content.view")) return { ok: false, error: "Sin permiso" };

  const [{ data: agent }, { data: ws }] = await Promise.all([
    supabase
      .from("agents")
      .select("id, is_enabled, system_prompt, config, knowledge_tags")
      .eq("workspace_id", workspace.id)
      .eq("type", "copywriter")
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("content_copy_settings")
      .eq("id", workspace.id)
      .maybeSingle(),
  ]);

  const config = readCopywriterConfig(agent, ws?.content_copy_settings);

  return {
    ok: true,
    data: {
      agentId: agent?.id ?? null,
      enabled: Boolean(agent?.is_enabled),
      autoOnApprove: config.autoOnApprove,
    },
  };
}
