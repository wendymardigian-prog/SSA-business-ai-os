"use server";

import { getMemberAction } from "@/lib/auth/guards";
import { parsePrefs } from "@/lib/ui/data-table/prefs";
import { buildViewConfig, parseVisibility, validateViewName, type ViewVisibility } from "@/lib/ui/data-table/views";
import type { Json } from "@/lib/types/database";

type Failure = { ok: false; error: string };

const FAILED = "No pude guardar la vista. Probá de nuevo.";
const TABLE_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que la base rechaza, dicho en palabras (los mensajes de las funciones de la 00360 ya vienen en español). */
function describe(error: { code?: string; message?: string } | null): string {
  if (!error) return FAILED;
  if (error.code === "23505") return "Ya tenés una vista con ese nombre en esta tabla.";
  if (error.code === "42501" || error.code === "22023" || error.code === "P0002") return error.message || FAILED;
  console.error("[vistas] error de la base:", error.code, error.message);
  return FAILED;
}

const cleanIds = (ids: unknown): string[] | null => (Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))] : null);

export interface SaveTableViewInput {
  /** Sin id se crea una vista nueva; con id se edita. */
  id?: string | null;
  tableKey: string;
  name: string;
  /** Las columnas elegidas. Sin esto, al editar se conservan las que tenía la vista. */
  columns?: unknown;
  /** Los filtros de la URL. Sin esto, al editar se conservan los de la vista. */
  filters?: string;
  /** Solo Owner y Admin pueden elegir algo distinto de `private` (la base lo vuelve a comprobar). */
  visibility?: ViewVisibility;
  /** Con «Personas elegidas»: a quién se le muestra. */
  memberIds?: string[];
  /** Dejarla como la predeterminada de quien guarda. */
  makeDefaultForMe?: boolean;
  /** Owner y Admin: dejarla como la predeterminada de estas personas (se les muestra a ellas). */
  defaultForUserIds?: string[];
}

/**
 * Crea o edita una vista. La persona y el negocio salen SIEMPRE de la sesión. Escribe `save_table_view`, que vuelve a
 * comprobar quién puede qué (compartir y asignar es de Owner y Admin).
 */
export async function saveTableView(input: SaveTableViewInput): Promise<({ ok: true; id: string; warning?: string }) | Failure> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!TABLE_KEY.test(input.tableKey)) return { ok: false, error: "Esa tabla no existe." };
  const name = validateViewName(input.name);
  if (!name.ok) return { ok: false, error: name.error };
  if (input.id !== undefined && input.id !== null && !UUID.test(input.id)) return { ok: false, error: "Esa vista no existe." };

  const visibility = parseVisibility(input.visibility);
  const members = visibility === "selected" ? cleanIds(input.memberIds ?? []) : null;
  if (visibility === "selected" && (!members || members.length === 0)) return { ok: false, error: "Elegí al menos una persona." };

  const config = input.columns === undefined && input.filters === undefined ? null : (buildViewConfig(parsePrefs(input.columns), input.filters ?? "") as unknown as Json);

  const { data, error } = await ctx.supabase.rpc("save_table_view", {
    p_id: input.id ?? null,
    p_workspace: ctx.workspace.id,
    p_table_key: input.tableKey,
    p_name: name.name,
    p_config: config as Json,
    p_visibility: visibility,
    p_member_ids: members,
  });
  if (error || !data) return { ok: false, error: describe(error) };
  const id = data as string;

  const others = (cleanIds(input.defaultForUserIds ?? []) ?? []).filter((u) => u !== ctx.user.id);
  const targets = [...(input.makeDefaultForMe ? [ctx.user.id] : []), ...others];
  if (targets.length > 0) {
    const res = await ctx.supabase.rpc("set_table_view_default", { p_workspace: ctx.workspace.id, p_table_key: input.tableKey, p_view: id, p_user_ids: targets });
    if (res.error) return { ok: true, id, warning: `La vista se guardó, pero no pude dejarla como predeterminada: ${describe(res.error)}` };
  }
  return { ok: true, id };
}

export async function deleteTableView(id: string): Promise<{ ok: true } | Failure> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!UUID.test(id)) return { ok: false, error: "Esa vista no existe." };
  const { error } = await ctx.supabase.rpc("delete_table_view", { p_id: id });
  return error ? { ok: false, error: describe(error) } : { ok: true };
}

/**
 * Deja una vista como predeterminada (`viewId` null la saca). Sin `userIds` es la de quien llama; para otras personas
 * hay que ser Owner o Admin.
 */
export async function setTableViewDefault(input: { tableKey: string; viewId: string | null; userIds?: string[] }): Promise<{ ok: true } | Failure> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!TABLE_KEY.test(input.tableKey)) return { ok: false, error: "Esa tabla no existe." };
  if (input.viewId !== null && !UUID.test(input.viewId)) return { ok: false, error: "Esa vista no existe." };
  const userIds = input.userIds === undefined ? null : cleanIds(input.userIds);
  if (input.userIds !== undefined && (!userIds || userIds.length === 0)) return { ok: false, error: "Elegí al menos una persona." };
  const { error } = await ctx.supabase.rpc("set_table_view_default", { p_workspace: ctx.workspace.id, p_table_key: input.tableKey, p_view: input.viewId, p_user_ids: userIds });
  return error ? { ok: false, error: describe(error) } : { ok: true };
}
