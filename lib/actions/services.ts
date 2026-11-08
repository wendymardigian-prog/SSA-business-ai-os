"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, type SvcResult } from "@/lib/services/db";
import { parseServicesImport } from "@/lib/services/import";
import { getWorkspaceMembers } from "@/lib/workspace-members";

/**
 * Las acciones de Servicios (bloques SV1 y SV2). Cada una pide su clave aca (la pantalla puede
 * saltearse) y la funcion de la base la vuelve a pedir con la sesion del usuario y el alcance
 * (`app_servicio.svc_*`). El workspace sale de la sesion; los ids que llegan se validan en la base.
 * Nada escribe en las tablas del modulo directo: todo pasa por las funciones (`svc_create_service`
 * es la unica entrada a `services`).
 */

const CLIENTS_PATH = "/dashboard/clientes";
const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };

function refresh(serviceId?: string) {
  revalidatePath(CLIENTS_PATH);
  if (serviceId) revalidatePath(`${CLIENTS_PATH}/s/${serviceId}`);
}

export interface CreateServiceInput {
  contactId: string;
  variantId: string;
  saleId?: string | null;
  origin: "sale" | "courtesy" | "test" | "manual";
  reason?: string | null;
  startsOn?: string | null;
  ownerUserId?: string | null;
  offRule?: boolean;
}

export async function createService(input: CreateServiceInput): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("services.create");
  if (!ctx) return NOT_ALLOWED;
  if (input.offRule && !ctx.can("services.create_off_rule")) return NOT_ALLOWED;
  const res = await svcRpc<string>(ctx.supabase, "svc_create_service", {
    p: {
      workspace_id: ctx.workspace.id,
      contact_id: input.contactId,
      variant_id: input.variantId,
      sale_id: input.saleId ?? null,
      origin: input.origin,
      origin_reason: input.reason ?? null,
      starts_on: input.startsOn ?? null,
      owner_user_id: input.ownerUserId ?? null,
      off_rule: input.offRule === true,
    },
  });
  if (res.ok) refresh(res.data);
  return res;
}

export async function confirmService(serviceId: string, startOn: string | null, ownerId: string | null): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.confirm");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_confirm_service", { p_service_id: serviceId, p_start_on: startOn, p_owner_id: ownerId });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function discardService(serviceId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.confirm");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_discard_service", { p_service_id: serviceId, p_reason: reason });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function pauseService(serviceId: string, input: { reason: string; cutAccess: boolean; resumeOn: string | null }): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.pause");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_pause", {
    p_service_id: serviceId,
    p: { reason: input.reason, cut_access: input.cutAccess, resume_on: input.resumeOn },
  });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function resumeService(serviceId: string, shiftDays: number | null): Promise<SvcResult<{ shift_days: number; ends_on: string | null }>> {
  const ctx = await getPermissionAction("services.pause");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<{ shift_days: number; ends_on: string | null }>(ctx.supabase, "svc_resume", {
    p_service_id: serviceId,
    p: shiftDays === null ? {} : { shift_days: shiftDays },
  });
  if (res.ok) refresh(serviceId);
  return res;
}

export interface ExtendInput {
  mode: "end_date" | "period";
  endOn?: string | null;
  n?: number | null;
  unit?: "days" | "months";
  from?: "current_end" | "today" | null;
  kind: "bonus" | "compensation" | "courtesy" | "purchase";
  reason: string;
  extendOwn?: boolean;
}

export async function extendService(serviceId: string, input: ExtendInput): Promise<SvcResult<{ ends_on: string; reactivated: boolean; accesses: number }>> {
  const ctx = await getPermissionAction("services.extend");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<{ ends_on: string; reactivated: boolean; accesses: number }>(ctx.supabase, "svc_extend", {
    p_service_id: serviceId,
    p: {
      mode: input.mode,
      end_on: input.endOn ?? null,
      n: input.n ?? null,
      unit: input.unit ?? "days",
      from: input.from ?? null,
      kind: input.kind,
      reason: input.reason,
      extend_own: input.extendOwn === true,
    },
  });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function revertExtension(serviceId: string, saleId: string): Promise<SvcResult<string | null>> {
  const ctx = await getPermissionAction("services.extend");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<string | null>(ctx.supabase, "svc_revert_extension", { p_service_id: serviceId, p_sale_id: saleId });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function completeService(serviceId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.complete");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_complete", { p_service_id: serviceId, p_reason: reason });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function cancelService(serviceId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.cancel");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_cancel", { p_service_id: serviceId, p_reason: reason });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function setServiceOwner(serviceId: string, userId: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.change_owner");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_set_owner", { p_service_id: serviceId, p_user_id: userId });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function bulkSetServiceOwner(serviceIds: string[], userId: string, reason: string): Promise<SvcResult<number>> {
  const ctx = await getPermissionAction("services.change_owner");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<number>(ctx.supabase, "svc_bulk_set_owner", { p_service_ids: serviceIds, p_user_id: userId, p_reason: reason });
  if (res.ok) refresh();
  return res;
}

export async function completeServiceItem(itemId: string, serviceId: string): Promise<SvcResult<boolean>> {
  const ctx = await getPermissionAction("services.items");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<boolean>(ctx.supabase, "svc_complete_item", { p_item_id: itemId });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function uncompleteServiceItem(itemId: string, serviceId: string): Promise<SvcResult<boolean>> {
  const ctx = await getPermissionAction("services.items");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<boolean>(ctx.supabase, "svc_uncomplete_item", { p_item_id: itemId });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function moveServiceToPhase(serviceId: string, phaseId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.change_phase");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_move_to_phase", { p_service_id: serviceId, p_phase_id: phaseId, p_reason: reason });
  if (res.ok) refresh(serviceId);
  return res;
}

export async function startServiceChallenge(serviceId: string): Promise<SvcResult<boolean>> {
  const ctx = await getPermissionAction("services.change_phase");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<boolean>(ctx.supabase, "svc_start_challenge", { p_service_id: serviceId, p_actor: "team" });
  if (res.ok) refresh(serviceId);
  return res;
}

// ── Configuracion de la variante (F5, F13) ─────────────────────────────────
export interface SaveResult {
  status: "ok" | "conflict" | "invalid";
  rev?: number;
  current?: unknown;
  problems?: string[];
}

export async function saveServiceSettings(variantId: string, settings: unknown, rev: number): Promise<SvcResult<SaveResult>> {
  const ctx = await getPermissionAction("services.configure");
  if (!ctx) return NOT_ALLOWED;
  return svcRpc<SaveResult>(ctx.supabase, "svc_save_service_settings", { p_variant_id: variantId, p_settings: settings, p_rev: rev });
}

export async function saveJourneyTemplate(variantId: string, template: unknown, rev: number): Promise<SvcResult<SaveResult>> {
  const ctx = await getPermissionAction("services.configure");
  if (!ctx) return NOT_ALLOWED;
  return svcRpc<SaveResult>(ctx.supabase, "svc_save_journey_template", { p_variant_id: variantId, p_template: template, p_rev: rev });
}

export async function copyVariantSetup(fromVariantId: string, toVariantId: string, parts: Array<"journey" | "service" | "portal">): Promise<SvcResult<{ status: string; needs_attention: number }>> {
  const ctx = await getPermissionAction(parts.includes("portal") && !parts.includes("journey") && !parts.includes("service") ? "portal.sections" : "services.configure");
  if (!ctx) return NOT_ALLOWED;
  return svcRpc<{ status: string; needs_attention: number }>(ctx.supabase, "svc_copy_variant_setup", {
    p_from_variant_id: fromVariantId,
    p_to_variant_id: toVariantId,
    p_parts: parts,
  });
}

// ── Carga inicial (F99) ────────────────────────────────────────────────────
export interface ImportPreviewRow {
  line: number;
  contact: string;
  product: string;
  variant: string;
  startsOn: string;
  problems: string[];
  duplicate: boolean;
}

/**
 * Vista previa y carga del CSV. Con `commit = false` solo resuelve y devuelve los errores por fila; con
 * `commit = true` crea los servicios (origen manual, motivo "Carga inicial"). Importar el mismo archivo
 * dos veces no duplica (contacto + producto + inicio).
 */
export async function importServices(csv: string, commit: boolean): Promise<{ ok: boolean; rows: ImportPreviewRow[]; created: number; missingColumns: string[]; error?: string }> {
  const ctx = await getPermissionAction("services.import");
  if (!ctx) return { ok: false, rows: [], created: 0, missingColumns: [], error: "No tenés permiso para hacer esto" };
  const parsed = parseServicesImport(csv);
  if (parsed.missingColumns.length) return { ok: false, rows: [], created: 0, missingColumns: parsed.missingColumns, error: "Faltan columnas" };
  const service = await createServiceClient();
  const ws = ctx.workspace.id;
  const members = await getWorkspaceMembers(ws);
  const out: ImportPreviewRow[] = parsed.errors.map((e) => ({ line: e.line, contact: "", product: "", variant: "", startsOn: "", problems: e.problems, duplicate: false }));
  let created = 0;
  for (const row of parsed.rows) {
    const problems: string[] = [];
    const contactQ = service.from("contacts").select("id").eq("workspace_id", ws).is("deleted_at", null).limit(1);
    const { data: contact } = row.email ? await contactQ.eq("email", row.email).maybeSingle() : await contactQ.eq("phone", row.phone ?? "").maybeSingle();
    if (!contact) problems.push("no encontré el contacto");
    const { data: product } = await service.from("products").select("id").eq("workspace_id", ws).ilike("name", row.product).limit(1).maybeSingle();
    if (!product) problems.push("no encontré el producto");
    const { data: variant } = product
      ? await service.from("product_variants").select("id").eq("product_id", product.id).ilike("name", row.variant).limit(1).maybeSingle()
      : { data: null };
    if (product && !variant) problems.push("no encontré la variante");
    const ownerId = members.find((m) => m.email?.toLowerCase() === row.ownerEmail)?.userId ?? null;
    if (!ownerId) problems.push("el responsable no es del equipo");
    let duplicate = false;
    if (contact && product) {
      const { data: existing } = await service
        .schema("app_servicio" as never)
        .from("services" as never)
        .select("id")
        .eq("contact_id" as never, contact.id as never)
        .eq("product_id" as never, product.id as never)
        .eq("starts_on" as never, row.startsOn as never)
        .limit(1)
        .maybeSingle();
      duplicate = !!existing;
    }
    out.push({ line: row.line, contact: row.email ?? row.phone ?? "", product: row.product, variant: row.variant, startsOn: row.startsOn, problems, duplicate });
    if (commit && !problems.length && !duplicate && contact && variant && ownerId) {
      const res = await svcRpc<string>(ctx.supabase, "svc_create_service", {
        p: {
          workspace_id: ws,
          contact_id: contact.id,
          variant_id: variant.id,
          origin: "manual",
          origin_reason: "Carga inicial",
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          owner_user_id: ownerId,
          start_phase_name: row.phase,
        },
      });
      if (res.ok) created++;
      else out[out.length - 1].problems.push(res.error.message);
    }
  }
  if (commit) refresh();
  return { ok: true, rows: out.sort((a, b) => a.line - b.line), created, missingColumns: [] };
}
