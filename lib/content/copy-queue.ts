/**
 * Pedirle al copywriter que escriba (E6, E7).
 *
 * Un solo lugar para los cinco disparadores: aprobar una idea con el boton
 * de producir copy, aprobarla con el interruptor prendido, crear un post con
 * "generar al crear", y generar o regenerar desde el editor.
 *
 * Deja la pieza en `generating` y encola. Que la pantalla conteste al
 * instante importa: escribir tarda entre cinco y veinte segundos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { CONTENT_COPY_JOB } from "./jobs";

type Db = SupabaseClient<Database>;

export type CopyQueued =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

/** El copywriter de este negocio. Hay uno por workspace (00094). */
export async function findCopywriter(
  supabase: Db,
  workspaceId: string,
): Promise<{ id: string; is_enabled: boolean } | null> {
  const { data } = await supabase
    .from("agents")
    .select("id, is_enabled")
    .eq("workspace_id", workspaceId)
    .eq("type", "copywriter")
    .is("deleted_at", null)
    .maybeSingle();

  return data ?? null;
}

export async function enqueueCopy(
  service: Db,
  params: { workspaceId: string; postId: string; instructions?: string | null },
): Promise<CopyQueued> {
  const agent = await findCopywriter(service, params.workspaceId);
  if (!agent) {
    return { ok: false, error: "No encontre el copywriter de este negocio." };
  }
  if (!agent.is_enabled) {
    return { ok: false, error: "El copywriter esta apagado. Prendelo en Agentes." };
  }

  // Marcar ANTES de encolar: si se encola y no se marca, la pantalla no
  // muestra nada y parece que el boton no hizo nada.
  const { error } = await service
    .from("content_posts")
    .update({ copy_status: "generating" })
    .eq("id", params.postId)
    .eq("workspace_id", params.workspaceId);

  if (error) return { ok: false, error: "No pude marcar la pieza como en proceso." };

  try {
    await scheduleJob(
      service,
      CONTENT_COPY_JOB,
      {
        postId: params.postId,
        workspaceId: params.workspaceId,
        agentId: agent.id,
        instructions: params.instructions ?? null,
      },
      new Date(),
    );
  } catch (err) {
    // Sin job no va a escribir nunca: la pieza no puede quedar diciendo que
    // si.
    await service
      .from("content_posts")
      .update({ copy_status: "failed" })
      .eq("id", params.postId);
    console.error("[copywriter] no pude encolar:", err);
    return { ok: false, error: "No pude ponerlo en la cola. Proba de nuevo." };
  }

  return { ok: true, agentId: agent.id };
}
