// @plantilla-quitar(servicios)
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { loadContactServices } from "@/lib/services/screens/load-services";
import { loadNewServiceOptions } from "@/lib/services/screens/load-new-service";
import { todayIn } from "@/lib/services/screens/today";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { loadPortalAccount, loadPortalHost } from "@/lib/portal-admin/load";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import type { PermissionContext } from "@/lib/auth/guards";
import { PortalAccountCard } from "@/components/services/clients/portal-account-card";
import { RecordModal } from "./record-modal";
import { RecordNotFound } from "./record-not-found";
import { ClientRecordHeader, ClientRecordView, type ClientRecordData } from "./client-record-view";

type Ctx = Pick<PermissionContext, "workspace" | "supabase" | "can" | "permissions">;

/**
 * La ficha del cliente en modal (Servicios A2, F130.2): una columna, pensada para que entre casi todo sin scroll. Sin
 * acceso a ningun servicio del contacto, "no encontramos" (lo decide la RLS). Lo del portal sale solo si alguno de sus
 * productos tiene portal.
 */
export async function ClientRecord({ ctx, contactId }: { ctx: Ctx; contactId: string }) {
  const { workspace, supabase } = ctx;
  const services = await loadContactServices(supabase, workspace.id, contactId);
  if (services.length === 0) return <RecordNotFound what="cliente" />;
  const wsTz = (workspace as { timezone?: string | null }).timezone;
  const service = await createServiceClient();
  const productIds = [...new Set(services.map((s) => s.product_id))];
  const [contact, notes, team, timeZone, { data: products }, summary] = await Promise.all([
    supabase.from("contacts").select("id, display_name, email, phone, whatsapp_phone, avatar_url, last_interaction_at, created_at").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("contact_notes").select("id, content, created_at, created_by, service_id").eq("contact_id", contactId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(wsTz ?? undefined),
    service.from("products").select("id, portal_enabled" as never).in("id", productIds).eq("workspace_id", workspace.id),
    svcRpc<Array<{ contact_id: string; account_status: string | null; last_login_at: string | null; invite_sent_at: string | null; pending_reviews: number; access_expiring_on: string | null }>>(supabase, "contacts_portal_summary", { p_contact_ids: [contactId] }),
  ]);
  const c = contact.data as { display_name: string | null; email: string | null; phone: string | null; whatsapp_phone: string | null; avatar_url: string | null; last_interaction_at: string | null; created_at: string } | null;
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const withPortal = new Set(((products ?? []) as unknown as Array<{ id: string; portal_enabled: boolean }>).filter((p) => p.portal_enabled).map((p) => p.id));
  const hasPortal = services.some((s) => withPortal.has(s.product_id));
  const portalSum = summary.ok ? summary.data?.[0] ?? null : null;

  const saleIds = services.map((s) => s.sale_id).filter((x): x is string => !!x);
  let paidCents = 0;
  let firstSaleAt: string | null = null;
  if (saleIds.length) {
    const [{ data: pays }, { data: sales }] = await Promise.all([
      supabase.from("payments").select("amount").in("sale_id", saleIds).eq("status", "paid"),
      supabase.from("sales").select("created_at").in("id", saleIds).order("created_at").limit(1),
    ]);
    paidCents = ((pays ?? []) as Array<{ amount: number }>).reduce((n, p) => n + Math.round((Number(p.amount) || 0) * 100), 0);
    firstSaleAt = ((sales ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null;
  }

  let portalCard: React.ReactNode = null;
  if (hasPortal) {
    const [account, { host }] = await Promise.all([loadPortalAccount(supabase, workspace.id, contactId), loadPortalHost(service, workspace.id)]);
    portalCard = (
      <PortalAccountCard contactId={contactId} contactName={c?.display_name ?? "este cliente"} account={account} hasHost={!!host} canAccounts={ctx.can("portal.accounts")} canViewAs={ctx.can("portal.view_as")} />
    );
  }

  const data: ClientRecordData = {
    contactId,
    name: c?.display_name ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    whatsapp: c?.whatsapp_phone || c?.phone || null,
    avatarUrl: c?.avatar_url ?? null,
    leadSince: c?.created_at ?? null,
    clientSince: services.map((s) => s.starts_on ?? s.created_at.slice(0, 10)).sort()[0] ?? null,
    paidCents: saleIds.length ? paidCents : null,
    lastContact: c?.last_interaction_at ?? null,
    firstSaleAt,
    hasPortal,
    portal: hasPortal ? { accountStatus: portalSum?.account_status ?? null, lastLoginAt: portalSum?.last_login_at ?? null, pendingReviews: Number(portalSum?.pending_reviews ?? 0) } : null,
    services: services.map((s) => ({
      id: s.id,
      productName: s.product_snapshot?.product_name ?? "",
      variantName: s.product_snapshot?.variant_name ?? "",
      status: s.status,
      light: s.light,
      lightReason: s.light_reason,
      phaseName: s.phase_name,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      progressPct: Number(s.progress_pct) || 0,
      ownerName: s.owner_user_id ? names.get(s.owner_user_id) ?? "Ya no está en el equipo" : null,
      createdAt: s.created_at,
      hasPortal: withPortal.has(s.product_id),
    })),
    events: ((notes.data ?? []) as Array<{ id: string; content: string; created_at: string; created_by: string | null; service_id: string | null }>).map((n) => ({
      id: n.id,
      at: n.created_at,
      serviceId: n.service_id,
      kind: "note",
      text: n.content,
      author: n.created_by ? names.get(n.created_by) ?? null : null,
    })),
  };

  const newServiceOptions = ctx.can("services.create")
    ? await loadNewServiceOptions(supabase, workspace.id, team, ctx.can("services.create_off_rule"), wsTz)
    : { products: [], members: [], canOffRule: false };

  return (
    <RecordModal label={`Cliente ${data.name || "sin nombre"}`} header={<ClientRecordHeader data={data} canEdit={ctx.can("contacts.edit")} canCreate={ctx.can("services.create")} newServiceOptions={newServiceOptions} timeZone={timeZone} />}>
      <ClientRecordView data={data} today={todayIn(wsTz ?? undefined)} timeZone={timeZone} portalCard={portalCard} />
    </RecordModal>
  );
}
