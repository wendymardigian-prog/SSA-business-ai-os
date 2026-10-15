"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { diffFields, logAudit } from "@/lib/audit";
import { UUID_RE } from "@/lib/finance/context";
import { findActiveVendorByName, vendorInputSchema } from "@/lib/finance/vendors";

/**
 * Proveedores (GF5). Nada se borra: se archivan. Escribe la sesión de quien pide, después de
 * `getPermissionAction("expenses.manage")`; la RLS y el índice único del nombre son la segunda barrera.
 */

const NO_PERMISSION = "No tenés permiso para cambiar los proveedores";

export type VendorActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; existingId?: string };
const fail = (error: string, existingId?: string): { ok: false; error: string; existingId?: string } => ({ ok: false, error, existingId });

function revalidate() {
  revalidatePath("/dashboard/finanzas/proveedores");
  revalidatePath("/dashboard/finanzas/gastos");
}

const COLUMNS = "id, name, archived_at, user_id";

export async function createVendor(input: unknown): Promise<VendorActionResult<{ id: string; name: string }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = vendorInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Los datos no son válidos");
  const v = parsed.data;

  const { data: all } = await ctx.supabase.from("vendors").select(COLUMNS).eq("workspace_id", ctx.workspace.id);
  const clash = findActiveVendorByName((all ?? []) as Array<{ id: string; name: string; archived_at: string | null }>, v.name);
  if (clash) return fail(`Ya hay un proveedor activo llamado «${clash.name}»`, clash.id);

  const { data, error } = await ctx.supabase
    .from("vendors")
    .insert({ workspace_id: ctx.workspace.id, name: v.name, country: v.country ?? null, email: v.email ?? null, payment_details: v.paymentDetails ?? null, terms: v.terms ?? null, notes: v.notes ?? null, created_by: ctx.user.id, updated_by: ctx.user.id } as never)
    .select("id, name")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail("Ya hay un proveedor activo con ese nombre");
    console.error("[finance] no pude crear el proveedor:", error?.message);
    return fail("No pude guardar el proveedor");
  }
  const row = data as { id: string; name: string };
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "vendor", entityId: row.id, action: "vendor.created", changes: diffFields({}, { name: row.name }), performedBy: ctx.user.id });
  revalidate();
  return { ok: true, id: row.id, name: row.name };
}

export async function updateVendor(id: string, input: unknown): Promise<VendorActionResult> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!UUID_RE.test(id)) return fail("Los datos no son válidos");
  const parsed = vendorInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Los datos no son válidos");
  const v = parsed.data;

  const { data: current } = await ctx.supabase.from("vendors").select("id, name, country, email, payment_details, terms, notes, archived_at, user_id").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!current) return fail("Este proveedor no existe");
  const cur = current as { name: string; country: string | null; email: string | null; payment_details: string | null; terms: string | null; notes: string | null; archived_at: string | null; user_id: string | null };
  // Un proveedor que es una persona del equipo no se renombra a mano: su nombre sale del miembro.
  if (cur.user_id && v.name !== cur.name) return fail("Este proveedor es una persona del equipo: su nombre sale de su perfil");

  const { data: all } = await ctx.supabase.from("vendors").select(COLUMNS).eq("workspace_id", ctx.workspace.id);
  const clash = findActiveVendorByName((all ?? []) as Array<{ id: string; name: string; archived_at: string | null }>, v.name, id);
  if (clash && !cur.archived_at) return fail(`Ya hay un proveedor activo llamado «${clash.name}»`, clash.id);

  const patch = { name: v.name, country: v.country ?? null, email: v.email ?? null, payment_details: v.paymentDetails ?? null, terms: v.terms ?? null, notes: v.notes ?? null };
  const { error } = await ctx.supabase.from("vendors").update({ ...patch, updated_by: ctx.user.id } as never).eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) {
    if (error.code === "23505") return fail("Ya hay un proveedor activo con ese nombre");
    return fail("No pude guardar el cambio");
  }
  // Los datos de pago pueden tener una cuenta bancaria: el historial dice que cambiaron, no cuáles eran.
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "vendor", entityId: id, action: "vendor.updated",
    changes: diffFields({ name: cur.name, country: cur.country, email: cur.email, terms: cur.terms, notes: cur.notes }, { name: patch.name, country: patch.country, email: patch.email, terms: patch.terms, notes: patch.notes }),
    metadata: cur.payment_details !== patch.payment_details ? { payment_details_changed: true } : undefined,
    performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true };
}

export async function setVendorArchived(id: string, archived: boolean): Promise<VendorActionResult> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!UUID_RE.test(id)) return fail("Los datos no son válidos");
  const { data: current } = await ctx.supabase.from("vendors").select("id, name, archived_at").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!current) return fail("Este proveedor no existe");
  const cur = current as { name: string; archived_at: string | null };
  if (!!cur.archived_at === archived) return { ok: true };

  if (!archived) {
    // Restaurar: no puede chocar con un activo del mismo nombre.
    const { data: all } = await ctx.supabase.from("vendors").select(COLUMNS).eq("workspace_id", ctx.workspace.id);
    const clash = findActiveVendorByName((all ?? []) as Array<{ id: string; name: string; archived_at: string | null }>, cur.name, id);
    if (clash) return fail(`Ya hay un proveedor activo llamado «${clash.name}»: renombralo antes de restaurar este`, clash.id);
  }
  const { error } = await ctx.supabase.from("vendors").update({ archived_at: archived ? new Date().toISOString() : null, updated_by: ctx.user.id } as never).eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail("No pude guardar el cambio");
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "vendor", entityId: id, action: archived ? "vendor.archived" : "vendor.restored", performedBy: ctx.user.id });
  revalidate();
  return { ok: true };
}
