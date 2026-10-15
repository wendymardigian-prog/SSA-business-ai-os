"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { checkGraceDays, checkMaxDiscountPercent } from "@/lib/sales/settings";
import { newMethodKey, paymentMethodConfigSchema, parsePaymentMethods, validateMethodsUpdate, type PaymentMethodConfig } from "@/lib/sales/payment-methods-config";
import { z } from "zod";
import { ensureSalesTemplateFlows } from "@/lib/sales/automation/templates-run";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Ajustes de Ventas del workspace (Ajustes > General > Ventas). Pide
 * `sales.settings`. Cada campo es opcional: lo que no viene no se toca.
 */
export async function updateSalesSettings(input: {
  /** Vacío/null = sin tope. */
  maxDiscountPercent?: unknown;
  overdueGraceDays?: unknown;
  /** «Crear flujos de cobranza»: al prenderlo se crean (apagados) los que falten. */
  autoCreateFlows?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("sales.settings");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar los ajustes de Ventas y cobranza" };
  const { workspace, supabase, user } = ctx;

  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: Json; new: Json }> = {};

  const { data: before } = await supabase.from("workspaces").select("max_discount_percent, overdue_grace_days, sales_auto_create_flows").eq("id", workspace.id).maybeSingle();

  if (input.maxDiscountPercent !== undefined) {
    const checked = checkMaxDiscountPercent(input.maxDiscountPercent);
    if (!checked.ok) return checked;
    patch.max_discount_percent = checked.value;
    changes.max_discount_percent = { old: (before?.max_discount_percent ?? null) as Json, new: checked.value };
  }

  if (input.overdueGraceDays !== undefined) {
    const checked = checkGraceDays(input.overdueGraceDays);
    if (!checked.ok) return checked;
    patch.overdue_grace_days = checked.value;
    changes.overdue_grace_days = { old: (before?.overdue_grace_days ?? null) as Json, new: checked.value };
  }

  if (input.autoCreateFlows !== undefined) {
    patch.sales_auto_create_flows = input.autoCreateFlows === true;
    changes.sales_auto_create_flows = { old: (before?.sales_auto_create_flows ?? null) as Json, new: input.autoCreateFlows === true };
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  // `workspaces` solo lo escribe un Admin por RLS: servicio despues del guard, sobre el workspace de la sesion.
  const { error } = await (await createServiceClient()).from("workspaces").update(patch as never).eq("id", workspace.id);
  if (error) {
    console.error("[sales-settings] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  // Al prender la opción, se crean (apagados) los flujos de cobranza que falten.
  if (input.autoCreateFlows === true) await ensureSalesTemplateFlows(await createServiceClient(), workspace.id, { force: true });

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes,
    metadata: { section: "sales_settings" },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// ── Extra I, MP: los métodos de pago del negocio ──────────────────────

/** Lo que manda la pantalla: sin `created_at` (lo pone el servidor) y con `key` solo si el método ya existe. */
const methodInputSchema = z.object({
  key: z.string().optional(),
  name: z.string(),
  fee_percent: z.number(),
  fee_fixed: z.number(),
  active: z.boolean(),
});

/**
 * Guarda la lista completa de métodos de pago (`workspaces.payment_methods`). Pide `sales.settings`.
 *
 *  - La `key` de un método que ya existe no cambia nunca; uno nuevo recibe la suya a partir del nombre.
 *  - No se puede quitar un método (se desactiva) ni dejar la lista sin ninguno activo.
 *  - Escribe con el cliente de servicio SOLO esa columna, en el workspace de la sesión.
 *  - Un pago ya cobrado no cambia: congeló su porcentaje, su fijo y su total.
 */
export async function updatePaymentMethods(input: unknown): Promise<{ ok: true; methods: PaymentMethodConfig[] } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("sales.settings");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar los métodos de pago" };
  const { workspace, supabase, user } = ctx;

  const parsedInput = z.array(methodInputSchema).max(40).safeParse(input);
  if (!parsedInput.success) return { ok: false, error: "Los métodos de pago no son válidos" };

  const service = await createServiceClient();
  const { data: current, error: readError } = await service.from("workspaces").select("payment_methods").eq("id", workspace.id).maybeSingle();
  if (readError) {
    console.error("[sales-settings] no pude leer los métodos de pago:", readError.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  const before = parsePaymentMethods((current as { payment_methods?: unknown } | null)?.payment_methods);
  const byKey = new Map(before.map((m) => [m.key, m]));

  const taken: string[] = before.map((m) => m.key);
  const now = new Date().toISOString();
  const after: PaymentMethodConfig[] = [];
  for (const m of parsedInput.data) {
    const existing = m.key ? byKey.get(m.key) : undefined;
    if (m.key && !existing) return { ok: false, error: "Hay un método que no existe" };
    const key = existing?.key ?? newMethodKey(m.name, taken);
    if (!existing) taken.push(key);
    const candidate = { key, name: m.name.trim(), fee_percent: m.fee_percent, fee_fixed: m.fee_fixed, active: m.active, created_at: existing?.created_at ?? now };
    const checked = paymentMethodConfigSchema.safeParse(candidate);
    if (!checked.success) return { ok: false, error: `«${m.name.trim() || "Sin nombre"}»: revisá el nombre, el porcentaje (0 a 100, hasta 3 decimales) y el fijo (hasta 2 decimales)` };
    after.push(checked.data);
  }

  const valid = validateMethodsUpdate(before, after);
  if (!valid.ok) return valid;

  const { error } = await service.from("workspaces").update({ payment_methods: after as unknown as Json } as never).eq("id", workspace.id);
  if (error) {
    console.error("[sales-settings] no pude guardar los métodos de pago:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "payment_methods.updated",
    changes: { payment_methods: { old: before as unknown as Json, new: after as unknown as Json } },
    metadata: { section: "payment_methods" },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/ventas");
  return { ok: true, methods: after };
}
