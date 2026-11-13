// @plantilla-quitar(servicios)
"use server";

/**
 * Lo de Servicios dentro de una tarea (A4, F152 a F154): la franja del servicio y el paso del camino (candado y
 * evidencia). La tarea se lee con la SESIÓN (la RLS de `tasks` decide); el servicio solo se
 * resume si la persona lo ve. Con el módulo apagado no hay servicio ni paso: devuelve vacío.
 */
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/workspace-members";
import { svcSchema } from "@/lib/services/db";
import { isModuleEnabled } from "@/lib/services/module";
import { evidenceMissing, readEvidence, readEvidenceRule, type EvidenceEntry, type EvidenceRule } from "@/lib/services/evidence";
import { lockErrorMessage, type LockState } from "@/lib/services/lock";
import { serviceHref } from "@/lib/services/screens/record-url";
import { taskServiceSummary, type TaskServiceSummary } from "@/lib/tasks/service-summary";
import { fail, type TaskActionResult } from "@/lib/tasks/result";

export interface TaskServicePanel {
  service: (TaskServiceSummary & { href: string }) | null;
  item: { id: string; status: string; rule: EvidenceRule | null; evidence: EvidenceEntry[]; missing: boolean; lockMessage: string | null } | null;
  viewerId: string;
}

const fmtCivil = (d: string) => new Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export async function loadTaskServicePanel(taskId: string): Promise<TaskActionResult<TaskServicePanel>> {
  const ctx = await getPermissionAction("tasks.view");
  if (!ctx) return fail("forbidden", "No tenés permiso para ver tareas.");
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail("validation", "Los datos no son válidos.");
  const { data: t } = await ctx.supabase.from("tasks").select("id, source, source_ref, service_id" as never).eq("id", taskId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const task = t as { id: string; source: string; source_ref: string | null; service_id: string | null } | null;
  if (!task) return fail("forbidden", "No encontramos esa tarea.");
  const out: TaskServicePanel = { service: null, item: null, viewerId: ctx.user.id };

  if (!isModuleEnabled(ctx.workspace as { services_enabled?: boolean | null })) return { ok: true, data: out };

  if (task.service_id) {
    // Con la sesión: si no ve el servicio, no hay franja.
    const { data: s } = await svcSchema(ctx.supabase).from("services").select("id, status, light, progress_pct, owner_user_id, product_snapshot").eq("id", task.service_id).maybeSingle();
    const svc = s as { id: string; status: string; light: string | null; progress_pct: number | string | null; owner_user_id: string | null; product_snapshot: { product_name?: string; variant_name?: string } | null } | null;
    if (svc) {
      const service = await createServiceClient();
      const [{ data: ph }, owner] = await Promise.all([
        svcSchema(service).from("service_phases").select("name").eq("service_id", svc.id).eq("status", "in_progress").maybeSingle(),
        svc.owner_user_id ? service.auth.admin.getUserById(svc.owner_user_id).then((r) => r.data.user).catch(() => null) : Promise.resolve(null),
      ]);
      const summary = taskServiceSummary({
        id: svc.id,
        productName: svc.product_snapshot?.product_name ?? "",
        variantName: svc.product_snapshot?.variant_name ?? "",
        status: svc.status,
        light: svc.light,
        phaseName: (ph as { name?: string } | null)?.name ?? null,
        progressPct: Number(svc.progress_pct) || 0,
        ownerName: owner ? memberDisplayName(owner.user_metadata?.full_name as string | undefined, owner.user_metadata?.name as string | undefined, owner.email) : null,
      });
      if (summary) out.service = { ...summary, href: serviceHref(svc.id) };
    }
  }

  if (task.source === "cx" && task.source_ref?.startsWith("svc_item:")) {
    // La tarea ya se vio con la sesión: el paso se lee con el cliente de servicio, filtrado por el negocio.
    const service = await createServiceClient();
    const itemId = task.source_ref.slice(9);
    const { data: it } = await svcSchema(service).from("service_items").select("id, service_id, status, ref, evidence").eq("id", itemId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    const item = it as { id: string; service_id: string; status: string; ref: Record<string, unknown> | null; evidence: unknown } | null;
    if (item) {
      const rule = readEvidenceRule(item.ref?.evidence);
      const evidence = readEvidence(item.evidence);
      let lockMessage: string | null = null;
      if (item.status === "pending" && item.ref?.lock) {
        const { data: state } = await svcSchema(service).rpc("svc_item_lock_state" as never, { p_item_id: item.id } as never);
        const lock = state as LockState | null;
        if (lock?.locked) {
          const { data: names } = await svcSchema(service).from("service_items").select("template_key, name").eq("service_id", item.service_id);
          const byKey = Object.fromEntries(((names ?? []) as Array<{ template_key: string | null; name: string }>).filter((n) => n.template_key).map((n) => [n.template_key, n.name]));
          lockMessage = lockErrorMessage(lock, byKey, fmtCivil);
        }
      }
      out.item = { id: item.id, status: item.status, rule, evidence, missing: item.status === "pending" && evidenceMissing(rule, evidence), lockMessage };
    }
  }
  return { ok: true, data: out };
}
