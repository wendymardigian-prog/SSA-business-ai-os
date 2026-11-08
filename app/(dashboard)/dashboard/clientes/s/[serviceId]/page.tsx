// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { contactNames, loadService } from "@/lib/services/screens/load-services";
import { todayIn } from "@/lib/services/screens/today";
import { ServiceDetailView, type ServiceDetailData } from "@/components/services/clients/service-detail-view";

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
  const tab = sp.tab === "camino" || sp.tab === "datos" ? sp.tab : "actividad";
  return (
    <ServiceDetailView
      data={data}
      initialTab={tab}
      today={today}
      members={team.map((m) => ({ id: m.userId, name: m.name }))}
      userNames={Object.fromEntries(memberLabels(team))}
      timeZone={timeZone}
      permissions={ctx.permissions.keys}
    />
  );
}
