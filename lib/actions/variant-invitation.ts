"use server";
// @plantilla-quitar(servicios)

import { getAnyPermissionAction } from "@/lib/auth/guards";
import type { PieceLinkDestinations } from "@/lib/attribution/piece-link-destinations";
import { loadLinkDestinations } from "@/lib/attribution/load-link-destinations";
import type { InvitationModule } from "@/lib/program/upgrade-invitation";
import { svcRpc, svcSchema, type SvcResult } from "@/lib/services/db";

export interface UpgradeStats {
  saw: number;
  clicked: number;
  upgraded: number;
  people: Array<{ contact_id: string; name: string | null; last_at: string; clicks: number; upgraded_at: string | null }>;
}

export interface VariantInvitationData {
  modules: InvitationModule[];
  tags: Array<{ id: string; name: string }>;
  destinations: PieceLinkDestinations;
  /** Null si la persona no tiene permiso para verlas o si no se pudieron leer. */
  stats: UpgradeStats | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL = (message: string): SvcResult<never> => ({ ok: false, error: { code: null, message, detail: null } });

/**
 * Lo que necesita la regla Programa de la variante para los módulos que no incluye (00404): los módulos del programa,
 * las etiquetas, los formularios y agendas para el botón y, si se puede, cuántos vieron, tocaron y se pasaron.
 * Lo abre quien configura el portal de la variante. Se pide al abrir el drawer, no con la página.
 */
export async function loadVariantInvitation(variantId: string): Promise<SvcResult<VariantInvitationData>> {
  const ctx = await getAnyPermissionAction(["portal.sections", "portal.access_rules"]);
  if (!ctx) return FAIL("No tenés permiso para configurar el portal.");
  if (!UUID.test(variantId)) return FAIL("Pedido no válido");

  const { data: variant, error: vErr } = await ctx.supabase.from("product_variants").select("product_id").eq("id", variantId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (vErr || !variant) return FAIL("No encontré la variante.");

  const [modulesRes, tagsRes, destinations, statsRes] = await Promise.all([
    svcSchema(ctx.supabase)
      .from("program_items")
      .select("id, title, position, is_extra")
      .eq("workspace_id", ctx.workspace.id)
      .eq("product_id", variant.product_id)
      .eq("kind", "module")
      .is("parent_id", null)
      .neq("status", "archived")
      .order("position")
      .order("id"),
    ctx.supabase.from("tags").select("id, name").eq("workspace_id", ctx.workspace.id).order("name"),
    loadLinkDestinations(ctx).catch((e: unknown) => {
      console.error("[portal] no pude cargar los destinos del botón:", e instanceof Error ? e.message : "error desconocido");
      return { forms: [], events: [] } satisfies PieceLinkDestinations;
    }),
    ctx.can("portal.access_rules") || ctx.can("services.view") ? svcRpc<UpgradeStats>(ctx.supabase, "upgrade_interest_stats", { p_variant_id: variantId }) : Promise.resolve(null),
  ]);
  if (modulesRes.error) return FAIL("No pude leer los módulos del programa.");

  let n = 0;
  const modules: InvitationModule[] = ((modulesRes.data ?? []) as Array<{ id: string; title: string; is_extra: boolean }>).map((m) => ({
    id: m.id,
    title: m.title,
    extra: m.is_extra,
    number: m.is_extra ? null : ++n,
  }));
  return {
    ok: true,
    data: {
      modules,
      tags: ((tagsRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => ({ id: t.id, name: t.name })),
      destinations,
      stats: statsRes && statsRes.ok ? statsRes.data : null,
    },
  };
}
