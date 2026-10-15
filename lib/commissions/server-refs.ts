/**
 * Lo que comparten las acciones de Comisiones para leer y comprobar contra el workspace de la SESIÓN (SOLO
 * servidor). Todo se hace con el cliente de servicio, DESPUÉS de que la acción comprobó su permiso, y siempre
 * filtrando por el workspace: un id que manda el cliente nunca se da por bueno.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { parseCommissionRoles } from "./roles";
import type { CommissionRole, RuleConditions } from "./types";

type Db = SupabaseClient;
const chunk = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

export interface CommissionSettingsRead {
  /** El jsonb completo, para escribir sin perder nada que no sea `roles`. */
  settings: Record<string, unknown>;
  roles: CommissionRole[];
  /** `workspaces.payment_methods` tal cual (lo lee `workspaceMethods`). */
  paymentMethods: unknown;
}

export async function readCommissionSettings(service: Db, workspaceId: string): Promise<CommissionSettingsRead | null> {
  const { data, error } = await service.from("workspaces").select("commission_settings, payment_methods").eq("id", workspaceId).maybeSingle();
  if (error || !data) {
    if (error) console.error("[comisiones] no pude leer la configuración:", error.message);
    return null;
  }
  const row = data as { commission_settings?: unknown; payment_methods?: unknown };
  const settings = row.commission_settings && typeof row.commission_settings === "object" && !Array.isArray(row.commission_settings) ? (row.commission_settings as Record<string, unknown>) : {};
  return { settings, roles: parseCommissionRoles(row.commission_settings), paymentMethods: row.payment_methods };
}

/** Los ids que NO son miembros del workspace (lista vacía = todos lo son). */
export async function missingMembers(workspaceId: string, ids: ReadonlyArray<string | null | undefined>): Promise<string[]> {
  const wanted = unique(ids.filter((id): id is string => !!id));
  if (wanted.length === 0) return [];
  const members = new Set((await getWorkspaceMembers(workspaceId)).map((m) => m.userId));
  return wanted.filter((id) => !members.has(id));
}

export type CheckedTable = "products" | "product_variants" | "content_posts" | "sales" | "payments";

/** Los ids que NO existen en esa tabla DENTRO del workspace. Si la consulta falla, devuelve todos (ante la duda, no se da por bueno). */
export async function missingRows(service: Db, table: CheckedTable, workspaceId: string, ids: ReadonlyArray<string | null | undefined>): Promise<string[]> {
  const wanted = unique(ids.filter((id): id is string => !!id));
  if (wanted.length === 0) return [];
  const found = new Set<string>();
  for (const part of chunk(wanted, 100)) {
    const { data, error } = await service.from(table).select("id").eq("workspace_id", workspaceId).in("id", part);
    if (error) {
      console.error(`[comisiones] no pude comprobar ${table}:`, error.message);
      return wanted;
    }
    for (const row of (data ?? []) as Array<{ id: string }>) found.add(row.id);
  }
  return wanted.filter((id) => !found.has(id));
}

/** Los ids de personas, productos, variantes, métodos y piezas que nombra una regla; null si todos existen, o el motivo. */
export async function checkRuleRefs(
  service: Db,
  args: {
    workspaceId: string;
    conditions: RuleConditions;
    beneficiaryUserId: string | null;
    paymentMethods: unknown;
    /** Personas que la regla ya tenía guardadas: se aceptan aunque hayan salido del equipo (para poder editar el resto). */
    keepUserIds?: ReadonlySet<string>;
  },
): Promise<string | null> {
  const { workspaceId, conditions: c } = args;
  const people = [...(c.user_ids ?? []), ...(c.vendedor_ids ?? []), ...(c.setter_ids ?? []), args.beneficiaryUserId].filter(
    (id): id is string => !!id && !args.keepUserIds?.has(id),
  );
  if ((await missingMembers(workspaceId, people)).length) return "Una de las personas elegidas no es del equipo";
  if ((await missingRows(service, "products", workspaceId, c.product_ids ?? [])).length) return "Uno de los productos elegidos no existe";
  if ((await missingRows(service, "product_variants", workspaceId, c.variant_ids ?? [])).length) return "Una de las variantes elegidas no existe";
  if ((await missingRows(service, "content_posts", workspaceId, c.content_post_ids ?? [])).length) return "Una de las piezas elegidas no existe";
  if (c.payment_methods?.length) {
    const known = new Set(workspaceMethods({ payment_methods: args.paymentMethods }).configs.map((m) => m.key));
    if (c.payment_methods.some((key) => !known.has(key))) return "Uno de los métodos de pago elegidos no existe";
  }
  return null;
}
