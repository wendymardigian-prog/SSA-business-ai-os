/**
 * Carga, en el servidor, las vistas guardadas de una tabla para quien mira (junto con la página: sin parpadeo de columnas).
 *
 * Lee con el cliente de la PERSONA: la RLS (00360) decide qué vistas ve (las suyas, las del equipo, las que le compartieron y,
 * siendo Owner o Admin, las compartidas de otras personas). Nunca lanza: si no se pueden leer, la tabla anda con las
 * columnas de sistema.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { parseViewConfig, parseVisibility, resolveActiveView, type ActiveView, type TableViewItem } from "./views";

export interface TableViewsData {
  views: TableViewItem[];
  /** La predeterminada de quien mira (puede ser una que le dejó un Owner o Admin). */
  defaultViewId: string | null;
  /** Quién se la dejó, si no fue la propia persona. */
  defaultAssignedBy: string | null;
  resolved: ActiveView;
  userId: string;
  isAdmin: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

export async function loadTableViews(
  ctx: Pick<PermissionContext, "supabase" | "workspace" | "user" | "role">,
  tableKey: string,
  sp: SearchParams,
): Promise<TableViewsData> {
  const userId = ctx.user.id;
  const isAdmin = ctx.role === "owner" || ctx.role === "admin";
  const empty: TableViewsData = { views: [], defaultViewId: null, defaultAssignedBy: null, resolved: resolveActiveView([], null, sp), userId, isAdmin };
  try {
    const [viewsRes, defaultsRes] = await Promise.all([
      ctx.supabase.from("table_views").select("id, name, owner_id, visibility, config").eq("workspace_id", ctx.workspace.id).eq("table_key", tableKey).order("name"),
      ctx.supabase.from("table_view_defaults").select("user_id, view_id, assigned_by").eq("workspace_id", ctx.workspace.id).eq("table_key", tableKey),
    ]);
    if (viewsRes.error || defaultsRes.error) {
      console.error("[vistas] no pude leer las vistas:", viewsRes.error?.message ?? defaultsRes.error?.message);
      return empty;
    }
    const rows = viewsRes.data ?? [];
    const ids = rows.map((r) => r.id);
    const membersRes = ids.length ? await ctx.supabase.from("table_view_members").select("view_id, user_id").in("view_id", ids) : { data: [], error: null };
    if (membersRes.error) console.error("[vistas] no pude leer con quién se comparten:", membersRes.error.message);

    const membersOf = new Map<string, string[]>();
    for (const m of membersRes.data ?? []) membersOf.set(m.view_id, [...(membersOf.get(m.view_id) ?? []), m.user_id]);
    const defaultsOf = new Map<string, string[]>();
    for (const d of defaultsRes.data ?? []) defaultsOf.set(d.view_id, [...(defaultsOf.get(d.view_id) ?? []), d.user_id]);

    const views: TableViewItem[] = rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        ownerId: r.owner_id,
        visibility: parseVisibility(r.visibility),
        config: parseViewConfig(r.config),
        memberIds: membersOf.get(r.id) ?? [],
        defaultFor: defaultsOf.get(r.id) ?? [],
      }))
      .sort((a, b) => Number(b.ownerId === userId) - Number(a.ownerId === userId) || a.name.localeCompare(b.name, "es"));

    const mine = (defaultsRes.data ?? []).find((d) => d.user_id === userId) ?? null;
    const defaultViewId = mine && views.some((v) => v.id === mine.view_id) ? mine.view_id : null;
    return {
      views,
      defaultViewId,
      defaultAssignedBy: defaultViewId ? (mine?.assigned_by ?? null) : null,
      resolved: resolveActiveView(views, defaultViewId, sp),
      userId,
      isAdmin,
    };
  } catch (error) {
    console.error("[vistas] no pude leer las vistas:", error instanceof Error ? error.message : "error");
    return empty;
  }
}
