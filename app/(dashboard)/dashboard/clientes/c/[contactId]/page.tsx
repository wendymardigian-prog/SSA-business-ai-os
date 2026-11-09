// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { loadContactServices } from "@/lib/services/screens/load-services";
import { loadNewServiceOptions } from "@/lib/services/screens/load-new-service";
import { todayIn } from "@/lib/services/screens/today";
import { formatPriceUsd } from "@/lib/content/taxonomy";
import { ClientDetailView } from "@/components/services/clients/client-detail-view";
import { PortalAccountCard } from "@/components/services/clients/portal-account-card";
import { loadPortalAccount, loadPortalHost } from "@/lib/portal-admin/load";
import { createServiceClient } from "@/lib/supabase/server";

/** La ficha del cliente (F28). Sin acceso a ningún servicio del contacto, 404 (lo decide la RLS). */
export default async function ClientPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const ctx = await requirePermission("services.view");
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.clientes", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const services = await loadContactServices(supabase, workspace.id, contactId);
  if (services.length === 0) notFound();
  const [contact, notes, team] = await Promise.all([
    supabase.from("contacts").select("id, display_name, email, phone, last_interaction_at").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("contact_notes").select("id, content, created_at, created_by, service_id").eq("contact_id", contactId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    getWorkspaceMembers(workspace.id),
  ]);
  const c = contact.data as { display_name: string | null; email: string | null; phone: string | null; last_interaction_at: string | null } | null;
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const saleIds = services.map((s) => s.sale_id).filter((x): x is string => !!x);
  let paid = 0;
  let firstSaleAt: string | null = null;
  if (saleIds.length) {
    const [{ data: pays }, { data: sales }] = await Promise.all([
      supabase.from("payments").select("amount, type").in("sale_id", saleIds).eq("status", "paid"),
      supabase.from("sales").select("created_at").in("id", saleIds).order("created_at").limit(1),
    ]);
    paid = ((pays ?? []) as Array<{ amount: number; type: string }>).reduce((n, p) => n + (Number(p.amount) || 0), 0);
    firstSaleAt = ((sales ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null;
  }
  // La cuenta del portal (F41, F42): la función mira el permiso y que la persona vea el contacto.
  const [account, { host }] = await Promise.all([loadPortalAccount(supabase, workspace.id, contactId), loadPortalHost(await createServiceClient(), workspace.id)]);
  const portal = (
    <PortalAccountCard
      contactId={contactId}
      contactName={c?.display_name ?? "este cliente"}
      account={account}
      hasHost={!!host}
      canAccounts={ctx.can("portal.accounts")}
      canViewAs={ctx.can("portal.view_as")}
    />
  );
  return (
    <ClientDetailView
      portal={portal}
      today={todayIn((workspace as { timezone?: string }).timezone)}
      canCreate={ctx.can("services.create")}
      newServiceOptions={ctx.can("services.create") ? await loadNewServiceOptions(supabase, workspace.id, team, ctx.can("services.create_off_rule")) : { products: [], members: [], canOffRule: false }}
      data={{
        contactId,
        name: c?.display_name ?? "Sin nombre",
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        clientSince: services[services.length - 1]?.starts_on ?? null,
        totalPaid: formatPriceUsd(paid),
        lastContact: c?.last_interaction_at ?? null,
        firstSaleAt,
        services: services.map((s) => ({
          id: s.id,
          productName: s.product_snapshot?.product_name ?? "",
          variantName: s.product_snapshot?.variant_name ?? "",
          status: s.status,
          light: s.light,
          phaseName: s.phase_name,
          startsOn: s.starts_on,
          endsOn: s.ends_on,
          createdAt: s.created_at,
        })),
        events: ((notes.data ?? []) as Array<{ id: string; content: string; created_at: string; created_by: string | null; service_id: string | null }>).map((n) => ({
          id: n.id,
          at: n.created_at,
          serviceId: n.service_id,
          kind: "note",
          text: n.content,
          author: n.created_by ? names.get(n.created_by) ?? null : null,
        })),
      }}
    />
  );
}
