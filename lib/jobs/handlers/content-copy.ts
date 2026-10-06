/**
 * El job que escribe el copy (E6).
 *
 * Corre en segundo plano para que apretar "producir copy" conteste al
 * instante: escribir tarda entre cinco y veinte segundos, y dejar la
 * pantalla colgada todo ese rato es peor que mostrar "el copywriter esta
 * escribiendo".
 *
 * Lo que decide vive en `lib/agent/copywriter.ts` y en
 * `lib/content/copywriter.ts`. Aca solo se lee el pedido, se aplica el
 * resultado al borrador y se avisa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CONTENT_COPY_JOB } from "@/lib/content/jobs";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runCopywriter } from "@/lib/agent/copywriter";
import { applyGeneratedCopy } from "@/lib/content/ai-copy";
import { writeVersion } from "@/lib/content/save-version";
import { notifyCopyReady, notifyCopyFailed } from "@/lib/notifications/content";

type Db = SupabaseClient<Database>;

export interface CopyPayload {
  postId?: string;
  workspaceId?: string;
  agentId?: string;
  instructions?: string | null;
}

/** El copywriter dejo de escribir, salga como salga. */
async function settleCopyStatus(supabase: Db, postId: string, status: "idle" | "failed") {
  await supabase.from("content_posts").update({ copy_status: status }).eq("id", postId);
}

async function handleCopy({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as CopyPayload;
  if (!payload.postId || !payload.workspaceId || !payload.agentId) {
    throw new Error(`job ${job.id} de copy sin postId, workspaceId o agentId`);
  }

  const result = await runCopywriter(supabase as Db, {
    agentId: payload.agentId,
    postId: payload.postId,
    instructions: payload.instructions ?? null,
  });

  if (!result.ok) {
    await settleCopyStatus(supabase as Db, payload.postId, "failed");
    await notifyCopyFailed(supabase as Db, {
      workspaceId: payload.workspaceId,
      contentPostId: payload.postId,
      reason: result.error,
    });
    console.error(`[cron/jobs] copy de ${payload.postId}: ${result.reason} (${result.error})`);
    // No se lanza: el motivo ya esta guardado y avisado, y reintentar solo
    // volveria a gastar. La persona decide si reintenta.
    return;
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("script, caption, networks, copy_source")
    .eq("id", payload.postId)
    .maybeSingle();

  const networks = (Array.isArray(post?.networks) ? post.networks : []) as Array<{
    platform: string;
    caption?: string | null;
    youtube_title?: string | null;
  }>;

  const applied = applyGeneratedCopy({
    output: result.output,
    platforms: networks.map((n) => n.platform),
    previousCopySource: (post?.copy_source ?? "manual") as "manual" | "ai" | "mixed",
    hadManualCopy: Boolean(post?.script?.trim()),
    networks,
  });

  const { error } = await supabase
    .from("content_posts")
    .update({
      script: applied.script,
      recording_notes: applied.recording_notes,
      caption: applied.caption,
      networks: applied.networks as never,
      copy_source: applied.copy_source,
      ai_unreviewed: applied.ai_unreviewed,
      copy_status: "idle",
    })
    .eq("id", payload.postId);

  if (error) {
    await settleCopyStatus(supabase as Db, payload.postId, "failed");
    throw new Error(`no pude guardar el copy de ${payload.postId}: ${error.message}`);
  }

  // La version va DESPUES de escribir, con autor del agente: guarda lo que
  // quedo y deja volver a lo de antes.
  await writeVersion(supabase as Db, {
    postId: payload.postId,
    workspaceId: payload.workspaceId,
    context: { trigger: "ai_generation" },
    authorKind: "ai",
  });

  await notifyCopyReady(supabase as Db, {
    workspaceId: payload.workspaceId,
    contentPostId: payload.postId,
    warnings: result.warnings,
  });
}

export function registerContentCopyHandler(): void {
  registerJobHandler(CONTENT_COPY_JOB, handleCopy);
}
