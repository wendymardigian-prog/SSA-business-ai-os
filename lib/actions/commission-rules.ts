"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { financeContextOf } from "@/lib/finance/context";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { computeProviderFee } from "@/lib/sales/fees";
import { findMethod } from "@/lib/sales/payment-methods";
import { fromCents } from "@/lib/shared/money";
import type { Json } from "@/lib/types/database";
import type { CommissionActionResult, PreviewResult, RolesActionResult } from "@/lib/commissions/action-types";
import { canonicalJson, jsonCreated, jsonDiff } from "@/lib/commissions/audit-diff";
import { commissionDbError, isPositionClash } from "@/lib/commissions/errors";
import {
  buildCommissionPreview,
  hypotheticalFacts,
  mergeDraftRules,
  parseDraftRules,
  previewInputSchema,
  type HypotheticalSale,
  type HypotheticalTouch,
} from "@/lib/commissions/preview";
import { planPositionMoves, sameIdSet, type PositionMove } from "@/lib/commissions/reorder";
import { validateRolesUpdate } from "@/lib/commissions/roles";
import { RULE_COLUMNS, commissionRuleFromRow } from "@/lib/commissions/rule-row";
import { commissionRuleInputSchema, commissionRuleRow, type CommissionRuleInput } from "@/lib/commissions/rule-schema";
import { checkRuleRefs, readCommissionSettings, type CommissionSettingsRead } from "@/lib/commissions/server-refs";
import type { CommissionFacts, CommissionRole } from "@/lib/commissions/types";

/**
 * Roles y reglas de comisión, y «Probar con una venta» (Extra I, F57 y F58).
 *
 * Quién escribe: el cliente de SERVICIO, DESPUÉS de `getPermissionAction("commissions.manage")` (`commission_rules`
 * y `commissions` son de solo lectura para la app, y `workspaces` es de Admin en la base). Todo se filtra por el
 * workspace de la SESIÓN, nunca por lo que mande el cliente, y los ids que vienen del cliente (productos,
 * variantes, personas, métodos, piezas) se comprueban contra ese workspace.
 *
 * Nada se borra: una regla se archiva. Todo lo que cambia queda en `audit_log`.
 */

const NO_PERMISSION = "No tenés permiso para administrar las comisiones";
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;
type Service = Awaited<ReturnType<typeof createServiceClient>>;

const ROLE_KEY = /^[a-z0-9_]{2,40}$/;
const RULE_AUDIT_FIELDS = ["name", "conditions", "calc_type", "rate", "fixed_amount", "base", "beneficiary_user_id", "hold_days", "valid_from", "valid_until", "is_active"] as const;
const RULE_CREATE_FIELDS = ["name", "role", "position", ...RULE_AUDIT_FIELDS.filter((f) => f !== "name")] as const;
const POSITION_RETRIES = 3;

function revalidate() {
  revalidatePath("/dashboard/finanzas/comisiones", "layout");
}

type RuleRow = Record<string, unknown> & { id: string; role: string; position: number; archived_at: string | null; updated_at: string };

async function loadRuleRow(service: Service, workspaceId: string, id: string): Promise<RuleRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await service.from("commission_rules").select(RULE_COLUMNS).eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  return (data as unknown as RuleRow | null) ?? null;
}

/** Las reglas vivas de un rol, en orden. */
async function liveRules(service: Service, workspaceId: string, role: string): Promise<Array<{ id: string; position: number }>> {
  const { data } = await service
    .from("commission_rules")
    .select("id, position")
    .eq("workspace_id", workspaceId)
    .eq("role", role)
    .is("archived_at", null)
    .order("position", { ascending: true });
  return ((data ?? []) as Array<{ id: string; position: number }>).map((r) => ({ id: r.id, position: Number(r.position) }));
}

/** Aplica los movimientos de a uno: cada uno cae en un lugar libre, así que ninguna actualización choca. Devuelve el primer error. */
async function applyMoves(service: Service, ctx: Ctx, moves: readonly PositionMove[], applied?: Map<string, number>): Promise<{ code?: string; message: string } | null> {
  for (const move of moves) {
    const { error } = await service
      .from("commission_rules")
      .update({ position: move.to, updated_by: ctx.user.id } as never)
      .eq("id", move.id)
      .eq("workspace_id", ctx.workspace.id)
      .is("archived_at", null);
    if (error) return error;
    applied?.set(move.id, move.to);
  }
  return null;
}

/** Deja las posiciones de un rol en 1..N, en el orden en que están. Es un mantenimiento: si falla, lo único que queda son huecos. */
async function compactPositions(service: Service, ctx: Ctx, role: string): Promise<void> {
  const live = await liveRules(service, ctx.workspace.id, role);
  const error = await applyMoves(service, ctx, planPositionMoves(live, live.map((r) => r.id)));
  if (error) console.error("[comisiones] no pude renumerar las reglas:", error.message);
}

/** La posición siguiente a la última regla viva del rol. */
async function nextPosition(service: Service, workspaceId: string, role: string): Promise<number> {
  const live = await liveRules(service, workspaceId, role);
  return live.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

async function insertRuleAtEnd(service: Service, ctx: Ctx, row: Record<string, unknown>): Promise<{ ok: true; id: string; position: number } | { ok: false; error: string }> {
  let lastError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < POSITION_RETRIES; attempt++) {
    const position = await nextPosition(service, ctx.workspace.id, String(row.role));
    const { data, error } = await service
      .from("commission_rules")
      .insert({ ...row, workspace_id: ctx.workspace.id, position, created_by: ctx.user.id, updated_by: ctx.user.id } as never)
      .select("id")
      .single();
    if (!error && data) return { ok: true, id: (data as { id: string }).id, position };
    lastError = error;
    // Dos altas a la vez eligieron la misma posición: se vuelve a calcular. Cualquier otro error se dice.
    if (!isPositionClash(error)) break;
  }
  console.error("[comisiones] no pude crear la regla:", lastError?.message);
  return fail(commissionDbError(lastError, "No pude guardar la regla"));
}

/** Valida lo que manda el formulario contra el rol (su `payee` decide si la persona es obligatoria) y contra el workspace. */
async function prepareRule(
  service: Service,
  ctx: Ctx,
  settings: CommissionSettingsRead,
  role: CommissionRole,
  input: unknown,
  keepUserIds?: ReadonlySet<string>,
): Promise<{ ok: true; parsed: CommissionRuleInput } | { ok: false; error: string }> {
  const parsed = commissionRuleInputSchema(role).safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Los datos de la regla no son válidos");
  const refsError = await checkRuleRefs(service, {
    workspaceId: ctx.workspace.id,
    conditions: parsed.data.conditions,
    beneficiaryUserId: parsed.data.beneficiaryUserId,
    paymentMethods: settings.paymentMethods,
    keepUserIds,
  });
  if (refsError) return fail(refsError);
  return { ok: true, parsed: parsed.data };
}

const asObject = (input: unknown): Record<string, unknown> => (input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {});

// ── Roles ──────────────────────────────────────────────────────────────

const rolesSchema = z
  .array(z.object({ key: z.string().max(60), name: z.string().max(200), payee: z.string().max(40), active: z.boolean() }))
  .min(1)
  .max(60);

const summarizeRoles = (roles: readonly CommissionRole[]): Json => roles.map((r) => ({ key: r.key, name: r.name, payee: r.payee, active: r.active }));

/**
 * Guarda la lista de roles (nombre y activo; los nuevos entran con su `key` y su `payee`). Un rol existente no se
 * borra ni cambia de `key` ni de `payee`; los precargados no cambian de condición. Escribe SOLO
 * `workspaces.commission_settings`, conservando el resto del jsonb.
 */
export async function updateCommissionRoles(input: unknown): Promise<RolesActionResult> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = rolesSchema.safeParse(input);
  if (!parsed.success) return fail("Los roles no son válidos");

  const service = await createServiceClient();
  const current = await readCommissionSettings(service, ctx.workspace.id);
  if (!current) return fail("No pude guardar el cambio");
  const before = current.roles;
  const now = new Date().toISOString();

  const after: CommissionRole[] = parsed.data.map((role) => {
    const existing = before.find((r) => r.key === role.key);
    return {
      key: role.key,
      name: role.name.trim(),
      payee: role.payee as CommissionRole["payee"],
      active: role.active,
      // `system` y la fecha de alta no los decide el cliente.
      system: existing ? existing.system : false,
      created_at: existing ? existing.created_at : now,
    };
  });

  const check = validateRolesUpdate(before, after);
  if (!check.ok) return { ok: false, error: check.issues[0]?.message ?? "Los roles no son válidos", issues: check.issues };
  if (canonicalJson(before) === canonicalJson(after)) return { ok: true, roles: before, changed: false };

  const { data, error } = await service
    .from("workspaces")
    .update({ commission_settings: { ...current.settings, roles: after } as unknown as Json } as never)
    .eq("id", ctx.workspace.id)
    .select("id");
  if (error) {
    console.error("[comisiones] no pude guardar los roles:", error.message);
    return fail(commissionDbError(error, "No pude guardar los roles"));
  }
  if ((data ?? []).length === 0) return fail("No pude guardar el cambio");

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "commission.roles_updated",
    changes: { roles: { old: summarizeRoles(before), new: summarizeRoles(after) } },
    performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, roles: after, changed: true };
}

// ── Reglas ─────────────────────────────────────────────────────────────

/** Crea una regla AL FINAL de su rol. */
export async function createCommissionRule(role: string, input: unknown): Promise<CommissionActionResult<{ id: string; position: number }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (typeof role !== "string" || !ROLE_KEY.test(role)) return fail("El rol no es válido");
  const service = await createServiceClient();
  const settings = await readCommissionSettings(service, ctx.workspace.id);
  if (!settings) return fail("No pude guardar la regla");
  const roleDef = settings.roles.find((r) => r.key === role);
  if (!roleDef) return fail("Ese rol no existe");
  if (!roleDef.active) return fail("Ese rol está desactivado: activalo antes de crear reglas para él");

  const prepared = await prepareRule(service, ctx, settings, roleDef, { ...asObject(input), role });
  if (!prepared.ok) return prepared;
  const row = commissionRuleRow(prepared.parsed);

  const created = await insertRuleAtEnd(service, ctx, row);
  if (!created.ok) return created;
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission_rule", entityId: created.id, action: "commission_rule.created",
    changes: jsonCreated({ ...row, position: created.position }, RULE_CREATE_FIELDS), metadata: { role }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, id: created.id, position: created.position };
}

/** Edita una regla. El rol no cambia: una regla de otro rol es otra regla. */
export async function updateCommissionRule(id: string, input: unknown, expectedUpdatedAt?: string | null): Promise<CommissionActionResult<{ changed: boolean }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const service = await createServiceClient();
  const existing = await loadRuleRow(service, ctx.workspace.id, id);
  if (!existing) return fail("Esa regla no existe");
  if (existing.archived_at) return fail("Una regla archivada no se edita");
  if (expectedUpdatedAt && existing.updated_at !== expectedUpdatedAt) return fail("Alguien cambió esta regla mientras la editabas. Recargá para ver lo último.");

  const settings = await readCommissionSettings(service, ctx.workspace.id);
  if (!settings) return fail("No pude guardar la regla");
  const roleDef = settings.roles.find((r) => r.key === existing.role);
  if (!roleDef) return fail("El rol de esta regla ya no existe");
  const sent = asObject(input);
  if (typeof sent.role === "string" && sent.role !== existing.role) return fail("Una regla no cambia de rol: creá otra en el rol que quieras");

  const saved = commissionRuleFromRow(existing);
  const keep = new Set<string>([
    ...(saved.conditions.user_ids ?? []), ...(saved.conditions.vendedor_ids ?? []), ...(saved.conditions.setter_ids ?? []),
    ...(saved.beneficiary_user_id ? [saved.beneficiary_user_id] : []),
  ]);
  const prepared = await prepareRule(service, ctx, settings, roleDef, { ...sent, role: existing.role }, keep);
  if (!prepared.ok) return prepared;

  const row = commissionRuleRow(prepared.parsed);
  const { role: _role, ...patch } = row;
  void _role;
  const changes = jsonDiff(existing, row, RULE_AUDIT_FIELDS);
  if (!changes) return { ok: true, changed: false };

  const { data, error } = await service
    .from("commission_rules")
    .update({ ...patch, updated_by: ctx.user.id } as never)
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .select("id");
  if (error) {
    console.error("[comisiones] no pude editar la regla:", error.message);
    return fail(commissionDbError(error, "No pude guardar la regla"));
  }
  if ((data ?? []).length === 0) return fail("Esta regla cambió mientras la editabas. Recargá para verla.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission_rule", entityId: id, action: "commission_rule.updated",
    changes, metadata: { role: existing.role }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, changed: true };
}

/** Una copia de la regla, al final de su rol. */
export async function duplicateCommissionRule(id: string): Promise<CommissionActionResult<{ id: string; position: number }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const service = await createServiceClient();
  const existing = await loadRuleRow(service, ctx.workspace.id, id);
  if (!existing) return fail("Esa regla no existe");

  const source = commissionRuleFromRow(existing);
  const name = `${source.name} (copia)`.slice(0, 120);
  const row = {
    name,
    role: source.role,
    conditions: source.conditions,
    calc_type: source.calc_type,
    rate: source.rate,
    fixed_amount: source.fixed_amount,
    base: source.base,
    beneficiary_user_id: source.beneficiary_user_id,
    hold_days: source.hold_days,
    valid_from: source.valid_from,
    valid_until: source.valid_until,
    is_active: source.is_active,
  };
  const created = await insertRuleAtEnd(service, ctx, row);
  if (!created.ok) return created;
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission_rule", entityId: created.id, action: "commission_rule.created",
    changes: jsonCreated({ ...row, position: created.position }, RULE_CREATE_FIELDS), metadata: { role: source.role, duplicated_from: id }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, id: created.id, position: created.position };
}

/** Pausar o reactivar. Una regla pausada no se usa pero conserva su lugar. */
export async function setCommissionRuleActive(id: string, active: boolean): Promise<CommissionActionResult<{ changed: boolean }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (typeof active !== "boolean") return fail("Los datos no son válidos");
  const service = await createServiceClient();
  const existing = await loadRuleRow(service, ctx.workspace.id, id);
  if (!existing) return fail("Esa regla no existe");
  if (existing.archived_at) return fail("Una regla archivada no se pausa ni se reactiva");
  if ((existing.is_active !== false) === active) return { ok: true, changed: false };

  const { data, error } = await service
    .from("commission_rules")
    .update({ is_active: active, updated_by: ctx.user.id } as never)
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .select("id");
  if (error) {
    console.error("[comisiones] no pude cambiar el estado de la regla:", error.message);
    return fail(commissionDbError(error, "No pude guardar el cambio"));
  }
  if ((data ?? []).length === 0) return fail("Esta regla cambió mientras la tocabas. Recargá para verla.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission_rule", entityId: id,
    action: active ? "commission_rule.resumed" : "commission_rule.paused",
    changes: { is_active: { old: !active, new: active } }, metadata: { role: existing.role }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, changed: true };
}

/** Archiva (no borra) una regla: libera su posición y renumera las de abajo. Las comisiones ya generadas conservan su foto. */
export async function archiveCommissionRule(id: string): Promise<CommissionActionResult> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const service = await createServiceClient();
  const existing = await loadRuleRow(service, ctx.workspace.id, id);
  if (!existing) return fail("Esa regla no existe");
  if (existing.archived_at) return fail("Esta regla ya está archivada");

  const { data, error } = await service
    .from("commission_rules")
    .update({ archived_at: new Date().toISOString(), updated_by: ctx.user.id } as never)
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .select("id");
  if (error) {
    console.error("[comisiones] no pude archivar la regla:", error.message);
    return fail("No pude archivar la regla");
  }
  if ((data ?? []).length === 0) return fail("Esta regla ya está archivada");

  await compactPositions(service, ctx, existing.role);
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission_rule", entityId: id, action: "commission_rule.archived",
    changes: { archived: { old: false, new: true } }, metadata: { role: existing.role, position: existing.position }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true };
}

/**
 * Guarda el orden de las reglas de un rol (`ids`, de la primera a la última). Tienen que ser EXACTAMENTE las reglas
 * vivas del rol: si alguien creó o archivó una mientras tanto, se rechaza y la pantalla recarga.
 *
 * Cada actualización es de una sola fila y cae en una posición libre (`planPositionMoves`): nunca hay dos reglas
 * vivas con la misma posición. No es una sola transacción (el cliente de Supabase no las tiene); si una
 * actualización falla a la mitad, se intenta volver al orden anterior.
 */
export async function reorderCommissionRules(role: string, ids: unknown): Promise<CommissionActionResult<{ changed: boolean }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (typeof role !== "string" || !ROLE_KEY.test(role)) return fail("El rol no es válido");
  const parsed = z.array(z.uuid()).max(500).safeParse(ids);
  if (!parsed.success) return fail("El orden no es válido");

  const service = await createServiceClient();
  const live = await liveRules(service, ctx.workspace.id, role);
  if (!sameIdSet(parsed.data, live.map((r) => r.id))) return fail("Las reglas cambiaron mientras las ordenabas. Recargá para ver las de ahora.");

  const moves = planPositionMoves(live, parsed.data);
  if (moves.length === 0) return { ok: true, changed: false };

  const applied = new Map(live.map((r) => [r.id, r.position]));
  const error = await applyMoves(service, ctx, moves, applied);
  if (error) {
    console.error("[comisiones] no pude reordenar las reglas:", error.message);
    // Se vuelve al orden de antes, si se puede; las posiciones nunca quedan repetidas.
    const stuck = [...applied].map(([id, position]) => ({ id, position }));
    const back = await applyMoves(service, ctx, planPositionMoves(stuck, live.map((r) => r.id)));
    if (back) console.error("[comisiones] tampoco pude volver al orden anterior:", back.message);
    return fail(commissionDbError(error, "No pude guardar el orden. Recargá para ver cómo quedó."));
  }

  const before = new Map(live.map((r) => [r.id, r.position]));
  await Promise.all(
    parsed.data.flatMap((ruleId, index) =>
      before.get(ruleId) === index + 1
        ? []
        : [
            logAudit({
              supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission_rule", entityId: ruleId, action: "commission_rule.reordered",
              changes: { position: { old: before.get(ruleId) ?? null, new: index + 1 } }, metadata: { role }, performedBy: ctx.user.id,
            }),
          ],
    ),
  );
  revalidate();
  return { ok: true, changed: true };
}

// ── Probar con una venta (F58) ─────────────────────────────────────────

async function loadSaleFacts(
  service: Service,
  ctx: Ctx,
  settings: CommissionSettingsRead,
  input: { saleId: string; amountCents: number; method: string | null },
): Promise<{ ok: true; facts: CommissionFacts } | { ok: false; error: string }> {
  const ws = ctx.workspace.id;
  const { data: saleRow } = await service
    .from("sales")
    .select("id, status, financing_type, final_amount, product_variant_id, product_snapshot, setter_id, vendedor_id, contact_id, attribution_touch_id")
    .eq("id", input.saleId)
    .eq("workspace_id", ws)
    .maybeSingle();
  const sale = saleRow as unknown as (HypotheticalSale & { product_snapshot: unknown; attribution_touch_id: string | null }) | null;
  if (!sale) return fail("Esa venta no existe");

  let productId: string | null = null;
  if (sale.product_variant_id) {
    const { data: variant } = await service.from("product_variants").select("product_id").eq("id", sale.product_variant_id).eq("workspace_id", ws).maybeSingle();
    productId = (variant as { product_id?: string } | null)?.product_id ?? null;
  }
  if (!productId) {
    const snap = sale.product_snapshot && typeof sale.product_snapshot === "object" ? (sale.product_snapshot as { product_id?: unknown }).product_id : null;
    productId = typeof snap === "string" && snap ? snap : null;
  }

  let touch: HypotheticalTouch | null = null;
  if (sale.attribution_touch_id) {
    const { data } = await service
      .from("contact_touches")
      .select("id, channel, source, medium, campaign, content_label, term, content_post_id, social_post_id, meta_ad_id, meta_adset_id, meta_campaign_id")
      .eq("id", sale.attribution_touch_id)
      .eq("workspace_id", ws)
      .maybeSingle();
    touch = (data as unknown as HypotheticalTouch | null) ?? null;
  }

  let contentAssigneeId: string | null = null;
  if (touch && (touch.content_post_id || touch.social_post_id)) {
    const { data } = await service.rpc("commission_content_owner", { p_social_post_id: touch.social_post_id, p_content_post_id: touch.content_post_id, p_workspace: ws });
    contentAssigneeId = typeof data === "string" ? data : null;
  }

  const { data: paymentRows } = await service.from("payments").select("id, type, status").eq("sale_id", sale.id).eq("workspace_id", ws);
  const livePayments = ((paymentRows ?? []) as Array<{ type: string; status: string }>).filter((p) => p.type !== "refund" && p.status !== "cancelled").length;

  const defs = workspaceMethods({ payment_methods: settings.paymentMethods }).defs;
  if (input.method && !findMethod(defs, input.method)) return fail("Ese método de pago no existe");
  const feeAmount = input.method ? computeProviderFee(fromCents(input.amountCents), input.method, defs) : null;

  return {
    ok: true,
    facts: hypotheticalFacts({
      sale: { ...sale, product_id: productId },
      touch,
      contentAssigneeId,
      livePayments,
      amountCents: input.amountCents,
      method: input.method,
      feeAmount,
      todayLocal: financeContextOf(ctx).todayLocal,
    }),
  };
}

/**
 * «Probar con una venta»: qué comisiones generaría un cobro, con las reglas de la base más las que la pantalla
 * manda sin guardar (`draftRules`: reemplazan por `id` o se suman). NO ESCRIBE NADA: solo lee y calcula.
 *
 * Entrada: `{ paymentId }` (un cobro que ya pasó) o `{ saleId, amountCents, method }` (uno hipotético: el número de
 * pago es el siguiente a los pagos vivos de la venta), más `draftRules` opcional.
 */
export async function previewCommissions(input: unknown): Promise<PreviewResult> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) return fail("Elegí un cobro o una venta con un monto");
  const drafts = parseDraftRules(asObject(input).draftRules);
  if (!drafts.ok) return fail("Las reglas de la pantalla no son válidas");

  const service = await createServiceClient();
  const settings = await readCommissionSettings(service, ctx.workspace.id);
  if (!settings) return fail("No pude armar la prueba");

  let facts: CommissionFacts;
  let source: "payment" | "hypothetical";
  if ("paymentId" in parsed.data) {
    source = "payment";
    const { data: payment } = await service.from("payments").select("id").eq("id", parsed.data.paymentId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!payment) return fail("Ese cobro no existe");
    const { data, error } = await service.rpc("commission_facts", { p_payment_id: parsed.data.paymentId });
    if (error || !data) {
      if (error) console.error("[comisiones] no pude leer los hechos del cobro:", error.message);
      return fail("No pude leer ese cobro");
    }
    facts = data as unknown as CommissionFacts;
  } else {
    source = "hypothetical";
    const built = await loadSaleFacts(service, ctx, settings, parsed.data);
    if (!built.ok) return built;
    facts = built.facts;
  }

  const { data: ruleRows, error: rulesError } = await service
    .from("commission_rules")
    .select(RULE_COLUMNS)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null);
  if (rulesError) {
    console.error("[comisiones] no pude leer las reglas:", rulesError.message);
    return fail("No pude armar la prueba");
  }
  const saved = ((ruleRows ?? []) as Array<Record<string, unknown>>).map(commissionRuleFromRow);
  const rules = mergeDraftRules(saved, drafts.rules);
  const names = new Map((await getWorkspaceMembers(ctx.workspace.id)).map((m) => [m.userId, m.name]));
  // Las reglas de la pantalla que reemplazan a una guardada también se marcan como «sin guardar».
  const preview = buildCommissionPreview({ roles: settings.roles, rules, facts, names, draftIds: new Set(drafts.rules.map((r) => r.id)) });
  return { ok: true, source, facts, draftRules: drafts.rules.length, ...preview };
}
