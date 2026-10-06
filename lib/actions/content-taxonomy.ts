"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { checkName, isValidColor, nextColor, type TaxonomyItem } from "@/lib/content/taxonomy";

/**
 * Pilares y ofertas (F89).
 *
 * Todo pide `settings.manage`, y ademas lo aplica la RLS de la 00116: la
 * pantalla decide que botones muestra, la barrera es la base.
 *
 * NO hay una accion de borrar, y no es un olvido: archivar saca el pilar del
 * selector sin tocar lo ya publicado, y la tabla no tiene policy de DELETE.
 * `lib/content/taxonomy.test.ts` falla si alguien agrega una.
 *
 * Los selectores de la idea y de la pieza ofrecen "+ Crear" al final para no
 * frenar la carga: esa accion es `createPillar` / `createOffer`, que devuelve
 * el id nuevo para que el selector lo deje elegido. Quien no tiene el permiso
 * no ve el "+ Crear" (y si llamara igual, la accion lo rechaza).
 */

const SETTINGS_PATH = "/dashboard/settings/contenido";
const CONTENT_PATH = "/dashboard/content";

const NO_PERMISSION = "Solo quien puede cambiar la configuracion maneja los pilares y las ofertas";

export type TaxonomyResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

type Table = "content_pillars" | "content_offers";

const KIND: Record<Table, { label: string; audit: string }> = {
  content_pillars: { label: "pilar", audit: "content_pillar" },
  content_offers: { label: "oferta", audit: "content_offer" },
};

async function manageContext() {
  return getPermissionAction("settings.manage");
}

/** Los nombres de todas las filas, para validar el duplicado. */
async function loadItems(
  supabase: NonNullable<Awaited<ReturnType<typeof manageContext>>>["supabase"],
  table: Table,
  workspaceId: string,
): Promise<TaxonomyItem[]> {
  const { data } = await supabase
    .from(table)
    .select("id, name, archived_at")
    .eq("workspace_id", workspaceId);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, archivedAt: row.archived_at ?? null }));
}

function uniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || /duplicate key|uq_content_/i.test(error.message ?? "");
}

async function create(
  table: Table,
  rawName: string,
  color?: string | null,
): Promise<TaxonomyResult<{ id: string; name: string; color: string | null }>> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, table, workspace.id);
  const checked = checkName(rawName, items);
  if (!checked.ok) return checked;

  const row: Record<string, unknown> = {
    workspace_id: workspace.id,
    name: checked.name,
    created_by: user.id,
  };

  let usedColor: string | null = null;
  if (table === "content_pillars") {
    if (color != null && !isValidColor(color)) return { ok: false, error: "Ese color no es valido" };
    // Sin color elegido, el siguiente libre de la paleta: asi dos pilares
    // creados de apuro no quedan del mismo color.
    const { data: taken } = await supabase
      .from("content_pillars")
      .select("color, archived_at")
      .eq("workspace_id", workspace.id);
    usedColor = color ?? nextColor((taken ?? []).filter((r) => !r.archived_at).map((r) => r.color));
    row.color = usedColor;
  }

  const { data, error } = await supabase.from(table).insert(row as never).select("id").single();

  if (error || !data) {
    // Dos personas creando el mismo nombre a la vez: la validacion de arriba
    // no lo ve, el indice unico si.
    if (error && uniqueViolation(error)) return { ok: false, error: `Ya existe "${checked.name}"` };
    console.error(`[content-taxonomy] no pude crear ${KIND[table].label}:`, error?.message);
    return { ok: false, error: `No pude crear el ${KIND[table].label}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "create",
    metadata: { section: KIND[table].audit, name: checked.name },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { id: data.id, name: checked.name, color: usedColor } };
}

async function rename(table: Table, id: string, rawName: string): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, table, workspace.id);
  if (!items.some((i) => i.id === id)) return { ok: false, error: `No encontre ese ${KIND[table].label}` };

  const checked = checkName(rawName, items, id);
  if (!checked.ok) return checked;

  const { error } = await supabase
    .from(table)
    .update({ name: checked.name })
    .eq("id", id)
    .eq("workspace_id", workspace.id);

  if (error) {
    if (uniqueViolation(error)) return { ok: false, error: `Ya existe "${checked.name}"` };
    console.error(`[content-taxonomy] no pude renombrar ${KIND[table].label}:`, error.message);
    return { ok: false, error: "No pude guardar el nombre" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "update",
    metadata: { section: KIND[table].audit, id, name: checked.name },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

async function setArchived(table: Table, id: string, archived: boolean): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, table, workspace.id);
  const target = items.find((i) => i.id === id);
  if (!target) return { ok: false, error: `No encontre ese ${KIND[table].label}` };

  // Restaurar vuelve a ocupar el nombre: si mientras tanto se creo otro con el
  // mismo, hay que avisar en vez de chocar con el indice unico.
  if (!archived) {
    const checked = checkName(target.name, items, id);
    if (!checked.ok) {
      return { ok: false, error: `${checked.error}. Renombra uno de los dos antes de restaurar.` };
    }
  }

  const { error } = await supabase
    .from(table)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error(`[content-taxonomy] no pude archivar ${KIND[table].label}:`, error.message);
    return { ok: false, error: archived ? "No pude archivarlo" : "No pude restaurarlo" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "update",
    metadata: { section: KIND[table].audit, id, archived },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

export async function createPillar(input: { name: string; color?: string | null }) {
  return create("content_pillars", input.name, input.color);
}

export async function renamePillar(input: { id: string; name: string }) {
  return rename("content_pillars", input.id, input.name);
}

export async function setPillarColor(input: { id: string; color: string }): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!isValidColor(input.color)) return { ok: false, error: "Ese color no es valido" };

  const { error } = await ctx.supabase
    .from("content_pillars")
    .update({ color: input.color })
    .eq("id", input.id)
    .eq("workspace_id", ctx.workspace.id);

  if (error) {
    console.error("[content-taxonomy] no pude cambiar el color:", error.message);
    return { ok: false, error: "No pude cambiar el color" };
  }

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

export async function archivePillar(input: { id: string }) {
  return setArchived("content_pillars", input.id, true);
}

export async function restorePillar(input: { id: string }) {
  return setArchived("content_pillars", input.id, false);
}

export async function createOffer(input: { name: string }) {
  return create("content_offers", input.name);
}

export async function renameOffer(input: { id: string; name: string }) {
  return rename("content_offers", input.id, input.name);
}

export async function archiveOffer(input: { id: string }) {
  return setArchived("content_offers", input.id, true);
}

export async function restoreOffer(input: { id: string }) {
  return setArchived("content_offers", input.id, false);
}
