/**
 * La carga de la pantalla de reglas para quien la ve (SOLO servidor, F57).
 *
 * `loadRulesScreen` (list-load.ts) devuelve null sin `commissions.manage`. Quien tiene `commissions.view` con
 * alcance `all` también la ve, en solo lectura: esta carga comprueba el acceso (`rulesAccess`) y recién ahí
 * reusa el mismo cargador, sin copiar sus consultas. Las reglas se leen con la SESIÓN (la RLS decide), el resto con
 * el cliente de servicio DESPUÉS de comprobar el acceso, filtrando por el workspace de la sesión.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { loadRulesScreen, type RulesScreenData } from "./list-load";
import type { RulesAccess } from "./rules-ui-access";

type Loader = typeof loadRulesScreen;
type LoaderCtx = Parameters<Loader>[0];

export interface RulesViewData extends RulesScreenData {
  access: Exclude<RulesAccess, "none">;
  /** Id de regla → su `updated_at`, para avisar si alguien la cambió mientras se editaba. */
  updatedAt: Record<string, string>;
}

export async function loadRulesForViewer(
  ctx: Pick<PermissionContext, "supabase" | "workspace" | "user" | "can" | "scope">,
  access: Exclude<RulesAccess, "none">,
): Promise<RulesViewData> {
  // El cargador pide `commissions.manage`: acá ya se comprobó el acceso (manage, o view con alcance all).
  const loaderCtx = { ...ctx, can: (key: string) => key === "commissions.manage" || ctx.can(key) } as unknown as LoaderCtx;
  const [screen, versions] = await Promise.all([
    loadRulesScreen(loaderCtx),
    ctx.supabase.from("commission_rules").select("id, updated_at").eq("workspace_id", ctx.workspace.id).is("archived_at", null).limit(2000),
  ]);
  if (versions.error) console.error("[comisiones] no pude leer las versiones de las reglas:", versions.error.message);

  const updatedAt: Record<string, string> = {};
  for (const row of (versions.data ?? []) as Array<{ id: string; updated_at: string | null }>) if (row.updated_at) updatedAt[row.id] = row.updated_at;

  const data: RulesScreenData = screen ?? {
    roles: [],
    rules: {},
    lookups: {},
    editor: { products: [], variants: [], members: [], methods: [], utm: { source: [], medium: [], campaign: [], content: [], term: [] } },
    today: "",
    tz: "UTC",
    loadError: true,
  };
  return { ...data, access, updatedAt };
}
