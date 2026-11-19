/**
 * «Aplicar a los envíos programados» de una automatización, el núcleo. Solo servidor: lo llama la acción
 * (`lib/actions/send-queue.ts`, después de `flows.edit`) con el cliente de servicio y el workspace de la sesión.
 *
 * Recalcula, desde el momento guardado (`anchor_at`), la fecha de lo programado que todavía no salió con la programación
 * PUBLICADA de cada paso. Lo que con la regla nueva ya habría tenido que salir queda vencido (no sale de golpe). El texto
 * congelado no cambia. Cada fila se actualiza de forma condicional (`status = 'scheduled'`): si entre medio salió o se
 * vació, no se toca.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { FlowNode } from "@/lib/flow-engine/types";
import { parseDelivery } from "./settings";
import { reapplySchedule } from "./schedule";

type Db = SupabaseClient<Database>;

export type ApplyResult = { ok: true; updated: number; overdue: number; unchanged: number } | { ok: false; error: string };

export async function applyScheduleCore(service: Db, workspaceId: string, flowId: string, now: Date = new Date()): Promise<ApplyResult> {
  const { data: flow } = await service.from("flows").select("id, nodes").eq("id", flowId).eq("workspace_id", workspaceId).maybeSingle();
  if (!flow) return { ok: false, error: "Esa automatización no existe." };
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as unknown as FlowNode[];
  const { data: items, error } = await service
    .from("send_queue_items")
    .select("id, node_id, anchor_at, scheduled_for")
    .eq("workspace_id", workspaceId)
    .eq("flow_id", flowId)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: "No pude leer los envíos programados." };

  let updated = 0;
  let overdue = 0;
  let unchanged = 0;
  for (const item of items ?? []) {
    const node = nodes.find((n) => n.id === item.node_id);
    const schedule = parseDelivery((node?.data as { delivery?: unknown } | undefined)?.delivery).schedule;
    if (!node || !item.anchor_at || !schedule.enabled) {
      unchanged += 1;
      continue;
    }
    const next = reapplySchedule(new Date(item.anchor_at), schedule, now);
    if (next.status === "scheduled" && next.scheduledFor.getTime() === new Date(item.scheduled_for).getTime()) {
      unchanged += 1;
      continue;
    }
    const base = { scheduled_for: next.scheduledFor.toISOString(), schedule: schedule as unknown as Json, updated_at: now.toISOString() };
    const patch =
      next.status === "overdue"
        ? { ...base, status: "overdue" as const, reason_code: "overdue", reason: "Con la programación nueva ya tendría que haber salido: queda vencido y no se envía." }
        : { ...base, status: next.status };
    const { data: done } = await service.from("send_queue_items").update(patch).eq("id", item.id).eq("status", "scheduled").select("id");
    if (!done?.length) continue;
    if (next.status === "overdue") overdue += 1;
    else updated += 1;
  }
  return { ok: true, updated, overdue, unchanged };
}
