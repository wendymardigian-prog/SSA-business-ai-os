// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { contactNames, loadService } from "@/lib/services/screens/load-services";
import { todayIn } from "@/lib/services/screens/today";
import { ServiceDetailView, type ServiceDetailData } from "@/components/services/clients/service-detail-view";
import { ServiceAccessesPanel } from "@/components/services/clients/service-accesses-panel";
import { loadServiceAccesses } from "@/lib/portal-admin/load";
import { ServiceCertificateCard, type CertificateView } from "@/components/services/clients/service-certificate-card";
import { serviceCertificates } from "@/lib/services/certificate-core";
import { certificateState } from "@/lib/services/certificate";
import { loadDesignLinks } from "@/lib/designer/public-links";
import { createServiceClient } from "@/lib/supabase/server";
import { accessViewRows, pendingSections } from "@/lib/portal-admin/accesses-view";
import { programSections, readVariantPortal } from "@/lib/services/screens/variant-portal-form";

/** La ficha del servicio (F29). Pide `services.view`; un servicio que la persona no ve (RLS) es 404. */
export default async function ServicePage({ params, searchParams }: { params: Promise<{ serviceId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ serviceId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePermission("services.view");
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.clientes", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const loaded = await loadService(supabase, workspace.id, serviceId);
  if (!loaded) notFound();
  const { service: s, phases, items } = loaded;
  const [names, team, timeZone] = await Promise.all([contactNames(supabase, [s.contact_id]), getWorkspaceMembers(workspace.id), resolveViewerTimezone((workspace as { timezone?: string }).timezone)]);
  const today = todayIn((workspace as { timezone?: string }).timezone);

  const live = items.filter((i) => !i.is_recurring_template);
  const data: ServiceDetailData = {
    id: s.id,
    contactId: s.contact_id,
    contactName: names.get(s.contact_id) ?? "Sin nombre",
    productName: s.product_snapshot?.product_name ?? "",
    variantName: s.product_snapshot?.variant_name ?? "",
    status: s.status,
    light: s.light,
    lightReason: s.light_reason,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
    progressPct: Number(s.progress_pct) || 0,
    ownerId: s.owner_user_id,
    origin: String(s.origin ?? ""),
    originReason: (s.origin_reason as string | null) ?? null,
    priceCents: s.price_cents == null ? null : Number(s.price_cents),
    saleId: s.sale_id,
    previousServiceId: (s.previous_service_id as string | null) ?? null,
    extensionSaleIds: (s.extension_sale_ids as string[] | null) ?? [],
    pausedDays: Number(s.paused_days) || 0,
    alerts: {
      status: s.status,
      overduePayment: false,
      overdueItems: live.filter((i) => i.status === "pending" && i.due_on && i.due_on < today).map((i) => ({ id: i.id, name: i.name })),
      possibleDuplicate: (s.flags as { possible_duplicate?: boolean } | null)?.possible_duplicate === true && s.status === "pending_confirmation",
      needsAttentionItems: live.filter((i) => i.needs_attention && i.status === "pending").map((i) => ({ id: i.id, name: i.name })),
      saleChanged: (s.flags as { sale_changed?: boolean } | null)?.sale_changed === true,
      saleId: s.sale_id,
    },
    phases: phases.map((ph) => ({
      id: ph.id,
      name: ph.name,
      status: ph.status,
      challenge: !!(ph.challenge && (ph.challenge as { enabled?: boolean }).enabled),
      awaitingStart: ph.awaiting_start,
      items: live
        .filter((i) => i.phase_id === ph.id)
        .map((i) => ({ id: i.id, name: i.name, kind: i.kind, required: i.required, status: i.status, dueOn: i.due_on, taskId: i.task_id, needsAttention: i.needs_attention, occurrence: i.occurrence_index })),
    })),
  };
  if (s.sale_id) {
    const { count } = await supabase.from("payments").select("id", { count: "exact", head: true }).eq("sale_id", s.sale_id).eq("status", "overdue");
    data.alerts.overduePayment = (count ?? 0) > 0;
  }
  const tab = sp.tab === "camino" || sp.tab === "datos" || sp.tab === "accesos" ? sp.tab : "actividad";
  // La pestaña Accesos (F40): las filas salen de una función que vuelve a mirar el permiso y el alcance.
  const accessRows = await loadServiceAccesses(supabase, s.id);
  const [{ data: variantRow }, { data: productRow }] = await Promise.all([
    s.product_variant_id ? supabase.from("product_variants").select("portal_settings").eq("id", s.product_variant_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("products").select("portal_settings").eq("id", s.product_id).maybeSingle(),
  ]);
  const variantPortal = readVariantPortal((variantRow as { portal_settings?: unknown } | null)?.portal_settings);
  const accesses = (
    <ServiceAccessesPanel
      serviceId={s.id}
      rows={accessViewRows(accessRows, s.product_id, new Date().toISOString(), timeZone)}
      pending={variantPortal.enabled && s.status === "active" ? pendingSections(variantPortal.sections ?? [], programSections((productRow as { portal_settings?: unknown } | null)?.portal_settings), accessRows, s.product_id) : []}
      canManage={ctx.can("services.access")}
    />
  );
  // El certificado (F67, F69): las generaciones con este servicio como sujeto, con el cliente de servicio del negocio
  // de la sesión (el servicio ya se leyó con la sesión: quien llegó hasta acá lo ve).
  const hasCertificateStep = data.phases.some((ph) => ph.items.some((i) => i.kind === "certificate"));
  let certificate: React.ReactNode = null;
  if (tab === "datos") {
    const service = await createServiceClient();
    const designs = await serviceCertificates(service as never, workspace.id, s.id);
    if (designs.length || hasCertificateStep) {
      const toView = async (d: (typeof designs)[number]): Promise<CertificateView> => {
        const links = await loadDesignLinks(service, workspace.id, d.code);
        return { id: d.id, code: d.code, status: d.status, createdAt: d.created_at, link: links.link, pdfUrl: links.pdfUrl };
      };
      const st = certificateState(designs);
      const fmt = new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", year: "numeric" });
      certificate = (
        <ServiceCertificateCard
          serviceId={s.id}
          current={st.current ? await toView(st.current) : null}
          previous={await Promise.all(st.previous.slice(0, 5).map(toView))}
          hasStep={hasCertificateStep}
          canIssue={ctx.can("certificates.issue")}
          canVoid={ctx.can("certificates.void")}
          formatDate={Object.fromEntries(designs.map((d) => [d.id, fmt.format(new Date(d.created_at))]))}
        />
      );
    }
  }
  return (
    <ServiceDetailView
      data={data}
      initialTab={tab}
      today={today}
      members={team.map((m) => ({ id: m.userId, name: m.name }))}
      userNames={Object.fromEntries(memberLabels(team))}
      timeZone={timeZone}
      permissions={ctx.permissions.keys}
      accesses={accesses}
      certificate={certificate}
    />
  );
}
