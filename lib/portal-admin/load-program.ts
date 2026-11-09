// @plantilla-quitar(servicios)
/**
 * Portal › un programa: lo que leen sus dos pantallas (las pestañas y el engranaje de ajustes). Con la sesión de quien
 * mira (la RLS decide); un producto sin portal es «no existe».
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readVariantPortal } from "@/lib/services/screens/variant-portal-form";

type Db = SupabaseClient<any, any, any>;

/** Alguna de estas claves deja entrar a un programa del portal. */
export const PROGRAM_PAGE_PERMISSIONS = [
  "portal.view",
  "portal.sections",
  "portal.access_rules",
  "portal.settings",
  "program.manage",
  "program.activate",
  "live_sessions.manage",
  "attendance.manage",
  "community.view",
  "community.spaces",
  "tutor.manage",
  "tutor.knowledge",
] as const;

export interface PortalProgram {
  id: string;
  name: string;
  portal_enabled: boolean;
  portal_settings: Record<string, unknown> | null;
  portal_settings_rev: number;
  links: { items?: Array<{ key: string; name: string; active: boolean }> } | null;
}

export async function loadPortalProgram(supabase: Db, workspaceId: string, productId: string) {
  const [{ data: product }, { data: variants }] = await Promise.all([
    supabase.from("products").select("id, name, portal_enabled, portal_settings, portal_settings_rev, links").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle(),
    supabase.from("product_variants").select("id, name, portal_settings").eq("product_id", productId).is("archived_at", null).order("display_order"),
  ]);
  const program = product as unknown as PortalProgram | null;
  if (!program || !program.portal_enabled) return null;
  const vs = ((variants ?? []) as unknown as Array<{ id: string; name: string; portal_settings: unknown }>).map((v) => ({ id: v.id, name: v.name, portal: readVariantPortal(v.portal_settings) }));
  return { program, variants: vs };
}
