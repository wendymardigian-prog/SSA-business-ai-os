// @plantilla-quitar(servicios)
/**
 * Qué tareas son la vuelta de un paso del camino que se repite (00522). Solo servidor.
 *
 * Una tarea de Servicios lleva `source = 'cx'` y `source_ref = 'svc_item:<paso>'`. Se leen los pasos con la SESIÓN (la
 * RLS de Servicios decide qué se ve) y, de los que son una vuelta, la regla del paso que se repite. Nunca lanza: si
 * algo falla (o el módulo no existe en esta copia), no hay ícono y la pantalla sigue igual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcSchema } from "@/lib/services/db";
import { describeRepetition } from "@/lib/services/repetition";
import { inChunks } from "./load-all";
import type { TaskRepeatInfo } from "./format";

type Db = SupabaseClient<any, any, any>;

const ITEM_REF = /^svc_item:([0-9a-f-]{36})$/i;

export async function loadTaskRepeats(supabase: Db, tasks: Array<{ id: string; source: string | null; source_ref: string | null }>): Promise<Record<string, TaskRepeatInfo>> {
  try {
    const taskByItem = new Map<string, string>();
    for (const t of tasks) {
      const m = t.source === "cx" && t.source_ref ? ITEM_REF.exec(t.source_ref) : null;
      if (m) taskByItem.set(m[1], t.id);
    }
    if (taskByItem.size === 0) return {};
    type Round = { id: string; parent_item_id: string | null; occurrence_index: number | null; round_on: string | null; service_id: string };
    const rounds = (
      await inChunks<Round>([...taskByItem.keys()], 200, (slice) =>
        svcSchema(supabase).from("service_items").select("id, parent_item_id, occurrence_index, round_on, service_id").in("id", slice).not("parent_item_id", "is", null),
      )
    ).filter((r) => r.parent_item_id);
    if (rounds.length === 0) return {};
    type Parent = { id: string; recurrence: unknown; series_ended_at: string | null };
    const parents = await inChunks<Parent>([...new Set(rounds.map((r) => r.parent_item_id!))], 200, (slice) =>
      svcSchema(supabase).from("service_items").select("id, recurrence, series_ended_at").in("id", slice),
    );
    const byParent = new Map(parents.map((p) => [p.id, p]));
    const out: Record<string, TaskRepeatInfo> = {};
    for (const r of rounds) {
      const taskId = taskByItem.get(r.id);
      const p = byParent.get(r.parent_item_id!);
      if (!taskId) continue;
      out[taskId] = { round: r.occurrence_index ?? 0, rule: describeRepetition(p?.recurrence ?? null), roundOn: r.round_on, ended: !!p?.series_ended_at, serviceId: r.service_id };
    }
    return out;
  } catch (error) {
    console.error("[tareas] no pude leer las vueltas:", error instanceof Error ? error.message : error);
    return {};
  }
}
