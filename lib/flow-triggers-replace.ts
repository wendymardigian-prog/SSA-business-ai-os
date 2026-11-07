import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { DesiredTrigger } from "@/lib/flow-triggers";

type Db = SupabaseClient<Database>;
type TriggerRow = Database["public"]["Tables"]["triggers"]["Row"];

export type ReplaceTriggersResult = { ok: true } | { ok: false; error: string };

/**
 * Rehace los triggers de UN flujo (borrar y volver a insertar), mirando los dos
 * pasos. Lo usan los editores de pasos que rehacen el disparador al guardar.
 *
 * Antes se borraba y se insertaba sin mirar ningun error y se devolvia ok: un
 * insert que fallaba dejaba el flujo "encendido" sin ningun disparador, sin que
 * nadie se enterara. Ahora:
 * - si el borrado falla, no se toca nada y se devuelve el error;
 * - si el insert falla despues de borrar, se intenta dejar los que habia (los
 *   mismos ids) y se devuelve el error igual, diciendo si se pudo volver atras.
 */
export async function replaceFlowTriggers(
  db: Db,
  input: { flowId: string; workspaceId: string; desired: DesiredTrigger[]; isActive: boolean },
): Promise<ReplaceTriggersResult> {
  const { data: previous, error: readError } = await db.from("triggers").select("*").eq("flow_id", input.flowId);
  if (readError) {
    console.error("[flow-triggers] no pude leer los disparadores:", readError.message);
    return { ok: false, error: "No pude actualizar el disparador. Probá de nuevo." };
  }

  const { error: deleteError } = await db.from("triggers").delete().eq("flow_id", input.flowId);
  if (deleteError) {
    console.error("[flow-triggers] no pude borrar los disparadores:", deleteError.message);
    return { ok: false, error: "No pude actualizar el disparador. Probá de nuevo." };
  }

  if (input.desired.length === 0) return { ok: true };

  const { error: insertError } = await db
    .from("triggers")
    .insert(input.desired.map((t) => ({ ...t, workspace_id: input.workspaceId, is_active: input.isActive })));
  if (!insertError) return { ok: true };

  console.error("[flow-triggers] no pude guardar los disparadores nuevos:", insertError.message);
  const rows = (previous ?? []) as TriggerRow[];
  if (rows.length === 0) {
    return { ok: false, error: "No pude guardar el disparador: la automatización quedó sin disparador. Probá de nuevo." };
  }
  const { error: restoreError } = await db.from("triggers").insert(rows);
  if (restoreError) {
    console.error("[flow-triggers] no pude volver a dejar los disparadores de antes:", restoreError.message);
    return { ok: false, error: "No pude guardar el disparador: la automatización quedó sin disparador. Probá de nuevo." };
  }
  return { ok: false, error: "No pude guardar el disparador nuevo: quedó el que tenía antes. Probá de nuevo." };
}

/** Para encadenar el error despues de "Guardé los pasos, pero …". */
export function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
