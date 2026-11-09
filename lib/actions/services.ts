"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getAnyPermissionAction, getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, svcSchema, type SvcResult } from "@/lib/services/db";
import { parseServicesImport } from "@/lib/services/import";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { unpublishFlow } from "@/lib/flow-engine/publish";
import { newPathWorkflowNodes, orphanWorkflows, slotOf, slotTrigger, triggerOf, type CanvasNodeLike, type PathSlot } from "@/lib/services/screens/workflow-chips";

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

export async function saveJourneyTemplate(variantId: string, template: unknown, rev: number): Promise<SvcResult<SaveResult & { pausedWorkflows?: number }>> {
  const ctx = await getPermissionAction("services.configure");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<SaveResult>(ctx.supabase, "svc_save_journey_template", { p_variant_id: variantId, p_template: template, p_rev: rev });
  if (!res.ok || res.data.status !== "ok") return res;
  // F117: los workflows de un paso o una fase que ya no está en el camino se pausan (y se avisa). Nunca frena el guardado.
  let paused = 0;
  try {
    const svc = await createServiceClient();
    const { data: flows } = await svc.from("flows").select("id, status, nodes, draft_nodes").eq("workspace_id", ctx.workspace.id).eq("status", "published");
    const mine = ((flows ?? []) as Array<{ id: string; nodes: unknown; draft_nodes: unknown }>)
      .map((f) => ({ id: f.id, slot: slotOf(variantId, triggerOf(((Array.isArray(f.draft_nodes) ? f.draft_nodes : f.nodes) ?? []) as CanvasNodeLike[])) }))
      .filter((f): f is { id: string; slot: PathSlot } => f.slot !== null);
    const tpl = template as { phases?: Array<{ key: string; items?: Array<{ key: string }> }> };
    const orphans = orphanWorkflows(mine, { phases: (tpl.phases ?? []).map((p) => ({ key: p.key, items: p.items ?? [] })) });
    for (const id of orphans) if (await unpublishFlow(svc as never, ctx.workspace.id, id)) paused++;
  } catch (error) {
    console.error("[servicios] no pude pausar los workflows del camino:", error instanceof Error ? error.message : "error");
  }
  return { ok: true, data: { ...res.data, pausedWorkflows: paused } };
}

/** «+ Workflow» desde el camino (F117): crea la automatización en borrador con el disparador ya filtrado. */
export async function createPathWorkflow(variantId: string, slot: PathSlot, name: string): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("services.configure");
  if (!ctx || !ctx.can("flows.edit")) return NOT_ALLOWED;
  const { data: variant } = await ctx.supabase.from("product_variants").select("id").eq("id", variantId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!variant) return { ok: false, error: { code: null, message: "No encontré la variante.", detail: null } };
  const nodes = newPathWorkflowNodes(slotTrigger(variantId, slot)).map((n) => ({ ...n, position: { x: 0, y: 0 }, deletable: false }));
  const { data, error } = await ctx.supabase
    .from("flows")
    .insert({ workspace_id: ctx.workspace.id, name: name.trim().slice(0, 120) || "Workflow del camino", nodes: nodes as never, edges: [] as never, categories: ["Servicios"] })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: { code: null, message: "No se pudo crear la automatización.", detail: null } };
  return { ok: true, data: data.id };
}

/** El portal de una variante (F116). La base decide qué parte pide `portal.sections` y cuál `portal.access_rules`. */
export async function saveVariantPortal(variantId: string, settings: unknown, rev: number): Promise<SvcResult<SaveResult>> {
  const ctx = await getAnyPermissionAction(["portal.sections", "portal.access_rules"]);
  if (!ctx) return NOT_ALLOWED;
  return svcRpc<SaveResult>(ctx.supabase, "portal_admin_save_variant_portal", { p_variant_id: variantId, p_settings: settings, p_rev: rev });
}

/** Lo del programa que vale para todas sus variantes (F116: «En el programa»; F113: términos). Solo cambia lo que viene. */
export async function saveProgramSettings(productId: string, patch: Record<string, unknown>, rev: number): Promise<SvcResult<SaveResult>> {
  // La base pide la clave de CADA parte del parche (secciones, comunidad, asistente): esto solo deja pasar a quien
  // tiene alguna de ellas.
  const ctx = await getAnyPermissionAction(["portal.sections", "portal.settings", "community.spaces", "tutor.manage"]);
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<SaveResult>(ctx.supabase, "portal_admin_save_program_settings", { p_product_id: productId, p_patch: patch, p_rev: rev });
  // F84: prender el Asistente IA del programa crea (o vuelve a prender) su tutor; apagarlo lo deja inactivo.
  const sections = patch.sections as Record<string, unknown> | undefined;
  if (res.ok && (res.data as { status?: string } | null)?.status === "ok" && sections && typeof sections.assistant === "boolean") {
    const t = await svcRpc<string | null>(ctx.supabase, "program_tutor_set_enabled", { p_product_id: productId, p_enabled: sections.assistant });
    if (!t.ok) console.error("[servicios] no pude prender o apagar el tutor:", t.error.message);
  }
  return res;
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

// ── «+ Servicio» (F30): buscar el contacto y sus ventas sin servicio ───────
export async function searchContactsForService(q: string): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const ctx = await getPermissionAction("services.create");
  if (!ctx || q.trim().length < 2) return [];
  const term = q.trim().replace(/[%_,()]/g, "").slice(0, 60);
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`display_name.ilike.%${term}%,email.ilike.%${term}%`)
    .limit(10);
  return ((data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>).map((c) => ({ id: c.id, name: c.display_name ?? "Sin nombre", email: c.email }));
}

export async function contactSalesWithoutService(contactId: string): Promise<Array<{ id: string; label: string; variantId: string }>> {
  const ctx = await getPermissionAction("services.create");
  if (!ctx) return [];
  const { data: sales } = await ctx.supabase
    .from("sales")
    .select("id, sale_date, product_variant_id, product_snapshot")
    .eq("workspace_id", ctx.workspace.id)
    .eq("contact_id", contactId)
    .not("status", "in", "(cancelled,refunded)")
    .order("sale_date", { ascending: false })
    .limit(20);
  const list = (sales ?? []) as Array<{ id: string; sale_date: string; product_variant_id: string; product_snapshot: { product_name?: string; variant_name?: string } | null }>;
  if (list.length === 0) return [];
  const { data: taken } = await svcSchema(ctx.supabase).from("services").select("sale_id").in("sale_id", list.map((s) => s.id));
  const used = new Set(((taken ?? []) as Array<{ sale_id: string }>).map((t) => t.sale_id));
  return list
    .filter((s) => !used.has(s.id))
    .map((s) => ({ id: s.id, variantId: s.product_variant_id, label: `${s.sale_date} · ${s.product_snapshot?.product_name ?? "Venta"}${s.product_snapshot?.variant_name ? ` · ${s.product_snapshot.variant_name}` : ""}` }));
}

/** Si la venta cumple la regla de su variante (F95): el modal sale en rojo si no. */
export async function checkSaleRule(saleId: string): Promise<SvcResult<{ met: boolean; reason: string; mode: string; variant_id: string }>> {
  const ctx = await getPermissionAction("services.create");
  if (!ctx) return NOT_ALLOWED;
  return svcRpc(ctx.supabase, "svc_rule_check", { p_sale_id: saleId });
}

// ── La ficha del cliente (F28): comentario interno, del cliente o de un servicio ──────────────────
export async function addClientComment(contactId: string, serviceId: string | null, content: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.view");
  if (!ctx) return NOT_ALLOWED;
  const text = content.trim().slice(0, 5000);
  if (!text) return { ok: false, error: { code: null, message: "Escribí el comentario.", detail: null } };
  if (serviceId) {
    // El servicio tiene que ser de ese contacto y la persona tiene que verlo (la RLS de services lo decide).
    const { data } = await svcSchema(ctx.supabase).from("services").select("id").eq("id", serviceId).eq("contact_id", contactId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!data) return NOT_ALLOWED;
  }
  const { error } = await ctx.supabase
    .from("contact_notes")
    .insert({ workspace_id: ctx.workspace.id, contact_id: contactId, content: text, created_by: ctx.user.id, service_id: serviceId });
  if (error) return { ok: false, error: { code: null, message: "No se pudo guardar el comentario.", detail: null } };
  revalidatePath(`/dashboard/clientes/c/${contactId}`);
  return { ok: true, data: null };
}
