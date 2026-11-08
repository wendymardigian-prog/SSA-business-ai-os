// @plantilla-quitar(ventas)
/**
 * El resumen de afiliados (F105), solo servidor. Lo pide la página DESPUÉS de `affiliates.view_all`: lee con el cliente
 * de servicio, siempre del negocio de la sesión (un afiliado ve el resumen de todos, no solo los contactos que ve).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { affiliateSummary, type SummaryPerson } from "./summary";
import { parseCommissionRoles } from "@/lib/commissions/roles";

type Db = SupabaseClient<any, any, any>;

export async function loadAffiliateSummary(service: Db, workspaceId: string, team: Array<{ userId: string; name: string }>, now: string) {
  // Solo las comisiones de los roles que le pagan al afiliado de la venta (la persona puede cobrar por otros roles).
  const { data: ws } = await service.from("workspaces").select("commission_settings").eq("id", workspaceId).maybeSingle();
  const affiliateRoles = parseCommissionRoles((ws as { commission_settings?: unknown } | null)?.commission_settings)
    .filter((r) => r.payee === "sale_affiliate")
    .map((r) => r.key);
  const [members, contacts, leads, sales, commissions] = await Promise.all([
    service.from("workspace_members").select("user_id, affiliate_code").eq("workspace_id", workspaceId),
    service.from("contacts").select("id, display_name, affiliate_code").eq("workspace_id", workspaceId).not("affiliate_code", "is", null).is("deleted_at", null).limit(1000),
    service
      .from("contacts")
      .select("affiliate_user_id, affiliate_contact_id, affiliate_kind, affiliate_expires_at")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .or("affiliate_user_id.not.is.null,affiliate_contact_id.not.is.null")
      .limit(10000),
    service
      .from("sales")
      .select("affiliate_user_id, affiliate_contact_id, status, final_amount")
      .eq("workspace_id", workspaceId)
      .or("affiliate_user_id.not.is.null,affiliate_contact_id.not.is.null")
      .limit(10000),
    affiliateRoles.length === 0
      ? Promise.resolve({ data: [] })
      : service.from("commissions").select("user_id, contact_id, amount, expense_id").eq("workspace_id", workspaceId).is("voided_at", null).in("role", affiliateRoles).limit(10000),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const memberRows = (members.data ?? []) as Array<{ user_id: string; affiliate_code: string | null }>;
  const teamIds = new Set(memberRows.map((m) => m.user_id));
  const people: SummaryPerson[] = [
    ...memberRows.filter((m) => m.affiliate_code).map((m) => ({ type: "user" as const, id: m.user_id, name: names.get(m.user_id) ?? "Alguien del equipo", code: m.affiliate_code })),
    ...((contacts.data ?? []) as Array<{ id: string; display_name: string | null; affiliate_code: string }>).map((c) => ({ type: "contact" as const, id: c.id, name: c.display_name || "Sin nombre", code: c.affiliate_code })),
  ];
  // Quien se fue del equipo con referidos todavía asignados también aparece, marcado (F105).
  const leadRows = (leads.data ?? []) as Array<{ affiliate_user_id: string | null; affiliate_contact_id: string | null; affiliate_kind: string | null; affiliate_expires_at: string | null }>;
  for (const id of new Set(leadRows.map((l) => l.affiliate_user_id).filter((x): x is string => !!x && !teamIds.has(x)))) {
    people.push({ type: "user", id, name: "Ya no está en el equipo", code: null, departed: true });
  }
  return affiliateSummary(people, leadRows, (sales.data ?? []) as never, (commissions.data ?? []) as never, now);
}
