// @plantilla-quitar(ventas)
/**
 * Lecturas de afiliados (solo servidor). El cliente de servicio se usa DESPUÉS de mirar el permiso en la página, y
 * siempre filtrando por el workspace de la sesión: `workspace_members` y los productos no los ve un Member con la RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_LINKS, type ProductLinks } from "./product-links";
import type { AffiliateSettings } from "./assign";

type Db = SupabaseClient<any, any, any>;

export async function loadMemberCode(service: Db, workspaceId: string, userId: string): Promise<string | null> {
  const { data } = await service.from("workspace_members").select("affiliate_code").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  return ((data as { affiliate_code: string | null } | null)?.affiliate_code as string | null) ?? null;
}

export async function loadLinkProducts(service: Db, workspaceId: string) {
  const { data, error } = await service.from("products").select("id, name, status, links, links_rev").eq("workspace_id", workspaceId).order("name");
  if (error) console.error("[afiliados] no pude leer los productos:", error.code ?? "?");
  return ((data ?? []) as Array<{ id: string; name: string; status: string; links: ProductLinks | null; links_rev: number }>).map((p) => ({
    id: p.id,
    name: p.name,
    active: p.status === "active",
    links: p.links ?? EMPTY_LINKS,
    rev: p.links_rev ?? 0,
  }));
}

export async function loadAffiliateSettings(service: Db, workspaceId: string): Promise<{ settings: AffiliateSettings; rev: number }> {
  const { data } = await service.from("workspaces").select("affiliate_settings, affiliate_settings_rev").eq("id", workspaceId).maybeSingle();
  const row = data as { affiliate_settings: AffiliateSettings | null; affiliate_settings_rev: number | null } | null;
  return { settings: row?.affiliate_settings ?? {}, rev: row?.affiliate_settings_rev ?? 0 };
}

export interface AffiliatePerson {
  type: "user" | "contact";
  id: string;
}

/** Los referidos y las ventas de un afiliado (para Mis links y el resumen). */
export async function loadReferrals(service: Db, workspaceId: string, who: AffiliatePerson) {
  const col = who.type === "user" ? "affiliate_user_id" : "affiliate_contact_id";
  const [leads, sales, commissions] = await Promise.all([
    service.from("contacts").select("id, display_name, affiliate_kind, affiliate_assigned_at, affiliate_expires_at").eq("workspace_id", workspaceId).eq(col, who.id).is("deleted_at", null).order("affiliate_assigned_at", { ascending: false }).limit(200),
    service.from("sales").select("id, status, final_amount, created_at").eq("workspace_id", workspaceId).eq(col, who.id).order("created_at", { ascending: false }).limit(200),
    service
      .from("commissions")
      .select("id, amount, expense_id, voided_at")
      .eq("workspace_id", workspaceId)
      .eq(who.type === "user" ? "user_id" : "contact_id", who.id)
      .is("voided_at", null)
      .limit(1000),
  ]);
  return {
    leads: (leads.data ?? []) as Array<{ id: string; display_name: string | null; affiliate_kind: string | null; affiliate_assigned_at: string | null; affiliate_expires_at: string | null }>,
    sales: (sales.data ?? []) as Array<{ id: string; status: string; final_amount: number | string | null; created_at: string }>,
    commissions: (commissions.data ?? []) as Array<{ id: string; amount: number | string; expense_id: string | null; voided_at: string | null }>,
  };
}

/** Los links de un producto y su revisión (la tarjeta Links). null si no es de este negocio. */
export async function loadProductLinks(service: Db, workspaceId: string, productId: string): Promise<{ links: ProductLinks; rev: number } | null> {
  const { data } = await service.from("products").select("links, links_rev").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle();
  const row = data as { links: ProductLinks | null; links_rev: number | null } | null;
  return row ? { links: row.links ?? EMPTY_LINKS, rev: row.links_rev ?? 0 } : null;
}

export interface AffiliateOfRecord {
  affiliate: { type: "user" | "contact"; id: string; name: string; code: string | null } | null;
  kind: "originated" | "influenced" | null;
  expiresAt: string | null;
  source: string | null;
  /** El código propio del contacto si es afiliado externo (solo contactos). */
  ownCode: string | null;
}

/**
 * El afiliado de un contacto o de una venta, con su nombre. La página ya comprobó que la persona ve ese registro (RLS
 * con su sesión); acá se lee con el cliente de servicio solo para resolver el nombre del afiliado (otra persona del
 * equipo o un contacto que quizás no ve), siempre del negocio de la sesión.
 */
export async function loadAffiliateOf(service: Db, workspaceId: string, kind: "contact" | "sale", id: string, team: Array<{ userId: string; name: string }>): Promise<AffiliateOfRecord> {
  const cols = kind === "contact" ? "affiliate_user_id, affiliate_contact_id, affiliate_kind, affiliate_expires_at, affiliate_source, affiliate_code" : "affiliate_user_id, affiliate_contact_id, affiliate_kind";
  const { data } = await service.from(kind === "contact" ? "contacts" : "sales").select(cols).eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  const row = (data ?? {}) as { affiliate_user_id?: string | null; affiliate_contact_id?: string | null; affiliate_kind?: string | null; affiliate_expires_at?: string | null; affiliate_source?: string | null; affiliate_code?: string | null };
  let affiliate: AffiliateOfRecord["affiliate"] = null;
  if (row.affiliate_user_id) {
    const code = await loadMemberCode(service, workspaceId, row.affiliate_user_id);
    affiliate = { type: "user", id: row.affiliate_user_id, name: team.find((m) => m.userId === row.affiliate_user_id)?.name ?? "Ya no está en el equipo", code };
  } else if (row.affiliate_contact_id) {
    const { data: c } = await service.from("contacts").select("display_name, affiliate_code").eq("workspace_id", workspaceId).eq("id", row.affiliate_contact_id).maybeSingle();
    const cc = c as { display_name: string | null; affiliate_code: string | null } | null;
    affiliate = { type: "contact", id: row.affiliate_contact_id, name: cc?.display_name || "Un contacto", code: cc?.affiliate_code ?? null };
  }
  return {
    affiliate,
    kind: row.affiliate_kind === "originated" || row.affiliate_kind === "influenced" ? row.affiliate_kind : null,
    expiresAt: row.affiliate_expires_at ?? null,
    source: row.affiliate_source ?? null,
    ownCode: row.affiliate_code ?? null,
  };
}
