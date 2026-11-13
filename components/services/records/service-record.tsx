// @plantilla-quitar(servicios)
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { contactNames, loadService } from "@/lib/services/screens/load-services";
import { todayIn } from "@/lib/services/screens/today";
import { recordStepRules } from "@/lib/services/screens/record-step-rules";
import { overCapacityNote, readCapacity } from "@/lib/services/screens/capacity";
import { lockErrorMessage, lockLabel } from "@/lib/services/lock";

const civilShortFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const civilShortDate = (d: string) => civilShortFmt.format(new Date(`${d}T12:00:00Z`));
import { ServiceAccessesPanel } from "@/components/services/clients/service-accesses-panel";
import { loadServiceAccesses } from "@/lib/portal-admin/load";
import { ServiceCertificateCard, type CertificateView } from "@/components/services/clients/service-certificate-card";
import { serviceCertificates } from "@/lib/services/certificate-core";
import { certificateState } from "@/lib/services/certificate";
import { loadDesignLinks } from "@/lib/designer/public-links";
import { createServiceClient } from "@/lib/supabase/server";
import { ServiceAssistantCard } from "@/components/services/clients/service-assistant-card";
import { svcRpc } from "@/lib/services/db";
import { accessViewRows, pendingSections } from "@/lib/portal-admin/accesses-view";
import { programSections, readVariantPortal } from "@/lib/services/screens/variant-portal-form";
import { loadReviewItems } from "@/lib/program/load-review";
import { matchesReviewFilter } from "@/lib/program/review";
import { ASSISTANT_DEFAULTS } from "@/lib/program/assistant";
import {
  assistantCreditsView,
  attendanceRateView,
  classroomProgressView,
  elapsedView,
  nextPaymentView,
  type AttendanceOccurrence,
  type ClassroomItem,
  type FigurePayment,
} from "@/lib/services/screens/record-figures";
import { daysSinceLogin, lightSignals, overdueSteps, recordAlerts } from "@/lib/services/screens/service-record";
import type { ServiceRecordTab } from "@/lib/services/screens/record-url";
import type { PermissionContext } from "@/lib/auth/guards";
import { RecordModal } from "./record-modal";
import { RecordNotFound } from "./record-not-found";
import { ServiceRecordView, ServiceRecordHeader, type ServiceRecordData } from "./service-record-view";
import { ServiceMeetingsBlock } from "./service-meetings-block";
import { loadServiceMeetings } from "@/lib/services/screens/service-meetings-load";

type Ctx = Pick<PermissionContext, "workspace" | "supabase" | "can" | "permissions" | "user">;

/**
 * La ficha del servicio en modal (Servicios A2, F130.3). Se arma en el servidor con la sesion de quien mira (la RLS
 * decide si lo ve) y, para lo que vive en el esquema cerrado del portal, con funciones que vuelven a mirar el permiso
 * (00361) o con el cliente de servicio DESPUES de que la sesion vio el servicio. Lo del portal sale solo si el
 * producto tiene portal.
 */
export async function ServiceRecord({ ctx, serviceId, tab }: { ctx: Ctx; serviceId: string; tab: ServiceRecordTab }) {
  const { workspace, supabase } = ctx;
  const loaded = await loadService(supabase, workspace.id, serviceId);
  if (!loaded) return <RecordNotFound what="servicio" />;
  const { service: s, phases, items } = loaded;
  const wsTz = (workspace as { timezone?: string }).timezone;
  const today = todayIn(wsTz);
  const service = await createServiceClient();

  const [names, team, timeZone, { data: product }, { data: variantRow }, accessRows, summary] = await Promise.all([
    contactNames(supabase, [s.contact_id]),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(wsTz),
    service.from("products").select("portal_enabled, portal_settings, tutor_agent_id" as never).eq("id", s.product_id).eq("workspace_id", workspace.id).maybeSingle(),
    s.product_variant_id ? supabase.from("product_variants").select("portal_settings").eq("id", s.product_variant_id).maybeSingle() : Promise.resolve({ data: null }),
    loadServiceAccesses(supabase, s.id),
    svcRpc<Array<{ contact_id: string; account_status: string | null; last_login_at: string | null; invite_sent_at: string | null; pending_reviews: number; access_expiring_on: string | null }>>(supabase, "contacts_portal_summary", { p_contact_ids: [s.contact_id] }),
  ]);
  const prod = product as { portal_enabled?: boolean; portal_settings?: { assistant?: { credits_name?: string; credits_per_usd?: number } } | null; tutor_agent_id?: string | null } | null;
  const variantPortal = readVariantPortal((variantRow as { portal_settings?: unknown } | null)?.portal_settings);
  // "Tiene portal": el producto lo tiene prendido y la variante de este servicio da acceso.
  const hasPortal = !!prod?.portal_enabled && variantPortal.enabled === true;
  const portalSum = summary.ok ? summary.data?.[0] ?? null : null;

  // La venta y sus cuotas (y las de las ventas que lo extendieron): el próximo pago sale de ahí.
  const saleIds = [s.sale_id, ...(((s.extension_sale_ids as string[] | null) ?? []))].filter((x): x is string => !!x);
  const [{ data: payments }, { data: sale }] = await Promise.all([
    saleIds.length ? supabase.from("payments").select("status, type, amount, due_date").in("sale_id", saleIds) : Promise.resolve({ data: [] }),
    s.sale_id ? supabase.from("sales").select("id, final_amount, created_at").eq("id", s.sale_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pays = (payments ?? []) as FigurePayment[];
  const payment = nextPaymentView(pays, today);

  // Lo del portal: classroom, asistencia, asistente y entregas. Sin portal no se lee nada de eso.
  let classroom = null;
  let attendance = null;
  let assistant = null;
  let assistantInfo: { conversations: number; lastAt: string | null } | null = null;
  let reviews: Awaited<ReturnType<typeof loadReviewItems>> = [];
  let assistantCard: React.ReactNode = null;
  if (hasPortal) {
    const [cls, att, rev] = await Promise.all([
      svcRpc<{ items: ClassroomItem[] }>(supabase, "service_classroom", { p_service_id: s.id }),
      svcRpc<AttendanceOccurrence[]>(supabase, "service_attendance", { p_service_id: s.id }),
      // Las entregas de esa persona en este programa, con el cliente de servicio: la sesión ya vio el servicio.
      loadReviewItems(service, workspace.id, { contactId: s.contact_id, productId: s.product_id }),
    ]);
    classroom = cls.ok ? classroomProgressView(cls.data?.items ?? []) : null;
    attendance = att.ok ? attendanceRateView(att.data ?? [], 6) : null;
    reviews = rev.filter((r) => r.formType === "activity");
    if (prod?.tutor_agent_id) {
      const [detail, { data: threads }] = await Promise.all([
        svcRpc<{ limitUsd: number; credits: number; reached: boolean; spentUsd: number }>(service, "assistant_credits_detail", { p_contact_id: s.contact_id, p_product_id: s.product_id }),
        supabase.from("ai_threads" as never).select("id, title, last_message_at").eq("channel", "portal").eq("contact_id", s.contact_id).eq("subject_id", s.product_id).order("last_message_at", { ascending: false }).limit(10),
      ]);
      const perUsd = prod.portal_settings?.assistant?.credits_per_usd ?? ASSISTANT_DEFAULTS.credits_per_usd;
      assistant = detail.ok ? assistantCreditsView(detail.data, perUsd) : null;
      const th = (threads ?? []) as Array<{ id: string; title: string | null; last_message_at: string | null }>;
      assistantInfo = { conversations: th.length, lastAt: th[0]?.last_message_at ?? null };
      const fmt = new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      assistantCard = (
        <ServiceAssistantCard
          serviceId={s.id}
          canManage={ctx.can("tutor.manage")}
          detail={detail.ok ? detail.data : null}
          money={ctx.can("ai_costs.view")}
          creditsName={prod.portal_settings?.assistant?.credits_name ?? ASSISTANT_DEFAULTS.credits_name}
          threads={th.map((t) => ({ id: t.id, title: t.title, lastMessageAt: t.last_message_at }))}
          formatDate={(iso) => fmt.format(new Date(iso))}
        />
      );
    }
  }

  // El certificado: las generaciones con este servicio como sujeto (con el cliente de servicio, del negocio de la sesión).
  const live = items.filter((i) => !i.is_recurring_template);
  const hasCertificateStep = live.some((i) => i.kind === "certificate");
  let certificate: React.ReactNode = null;
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

  const accesses = hasPortal ? (
    <ServiceAccessesPanel
      serviceId={s.id}
      rows={accessViewRows(accessRows, s.product_id, new Date().toISOString(), timeZone)}
      pending={variantPortal.enabled && s.status === "active" ? pendingSections(variantPortal.sections ?? [], programSections(prod?.portal_settings), accessRows, s.product_id) : []}
      canManage={ctx.can("services.access")}
    />
  ) : null;

  const toLocal = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const loginDays = hasPortal ? daysSinceLogin(portalSum?.last_login_at ?? null, today, toLocal) : null;
  const pendingReviews = reviews.filter((r) => matchesReviewFilter(r, "pending")).length;
  const portalState = {
    hasPortal,
    accountStatus: portalSum?.account_status ?? null,
    lastLoginAt: portalSum?.last_login_at ?? null,
    inviteSentAt: portalSum?.invite_sent_at ?? null,
    accessExpiringOn: portalSum?.access_expiring_on ?? null,
  };
  const current = phases.find((p) => p.status === "in_progress") ?? null;
  const phaseDays = current?.started_at ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${toLocal(current.started_at)}T00:00:00Z`)) / 86_400_000)) : null;
  const flags = (s.flags as { possible_duplicate?: boolean; sale_changed?: boolean } | null) ?? {};
  const baseAlerts = {
    status: s.status,
    overduePayment: payment?.kind === "overdue",
    overdueItems: [],
    possibleDuplicate: flags.possible_duplicate === true && s.status === "pending_confirmation",
    needsAttentionItems: live.filter((i) => i.needs_attention && i.status === "pending").map((i) => ({ id: i.id, name: i.name })),
    saleChanged: flags.sale_changed === true,
    saleId: s.sale_id,
  };
  // A4 (F146, F147): el candado y la evidencia de cada paso, con la misma regla que la base.
  const stepRules = recordStepRules(live, phases, { created_at: s.created_at as string, starts_on: s.starts_on }, today, toLocal);
  const namesByKey: Record<string, string> = Object.fromEntries(live.filter((i) => i.template_key).map((i) => [i.template_key, i.name]));
  const stepItems = live.map((i) => {
    const r = stepRules.get(i.id);
    return {
      id: i.id,
      phaseId: i.phase_id,
      name: i.name,
      kind: i.kind,
      required: i.required,
      status: i.status,
      dueOn: i.due_on,
      taskId: i.task_id,
      needsAttention: i.needs_attention,
      occurrence: i.occurrence_index,
      lock: r?.lock.locked ? { label: lockLabel(r.lock, namesByKey, civilShortDate) ?? "", message: lockErrorMessage(r.lock, namesByKey, civilShortDate) } : null,
      evidenceRule: r?.evidenceRule ?? null,
      evidence: r?.evidence ?? [],
      evidenceMissing: r?.evidenceMissing ?? false,
    };
  });
  const saleRow = sale as { id: string; final_amount: number | string | null; created_at: string } | null;
  const installments = pays.filter((p) => p.type !== "refund" && Number(p.amount) > 0 && !["cancelled", "refunded"].includes(p.status));

  // A4 (F151): quién superaría su tope si se lo asigna a mano (solo con permiso de cambiar el responsable).
  const capacityNotes: Record<string, string> = {};
  if (ctx.can("services.change_owner")) {
    const [wsCap, loads] = await Promise.all([
      service.from("workspaces").select("service_team_settings" as never).eq("id", workspace.id).maybeSingle(),
      svcRpc<Record<string, number>>(service, "svc_owner_loads", { p_workspace_id: workspace.id }),
    ]);
    const capacity = readCapacity((wsCap.data as { service_team_settings?: unknown } | null)?.service_team_settings);
    for (const m of team) {
      const note = overCapacityNote(m.userId, capacity, loads.ok ? loads.data ?? {} : {});
      if (note) capacityNotes[m.userId] = note;
    }
  }
  const data: ServiceRecordData = {
    id: s.id,
    viewerId: ctx.user?.id ?? null,
    capacityNotes,
    contactId: s.contact_id,
    contactName: names.get(s.contact_id) ?? "Sin nombre",
    productName: s.product_snapshot?.product_name ?? "",
    variantName: s.product_snapshot?.variant_name ?? "",
    status: s.status,
    light: s.light,
    lightReason: s.light_reason,
    lightAt: (s.light_at as string | null) ?? null,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
    progressPct: Number(s.progress_pct) || 0,
    ownerId: s.owner_user_id,
    hasPortal,
    sale: saleRow ? { id: saleRow.id, amountCents: Math.round((Number(saleRow.final_amount) || 0) * 100), paid: installments.filter((p) => p.status === "paid").length, total: installments.length } : null,
    elapsed: elapsedView(s.starts_on, s.ends_on, today),
    payment,
    attendance,
    classroom,
    assistant,
    assistantInfo,
    alerts: recordAlerts({ base: baseAlerts, pendingReviews, payment, saleId: s.sale_id, portal: portalState, loginDays, today }),
    signals: lightSignals({
      phase: current ? { name: current.name, days: phaseDays, yellowDay: current.yellow_day, redDay: current.red_day } : null,
      overdueItems: overdueSteps(stepItems, today).length,
      payment,
      pendingReviews,
      portal: portalState,
      loginDays,
    }),
    overdue: overdueSteps(stepItems, today).map((i) => ({ id: i.id, name: i.name, dueOn: i.dueOn as string })),
    phases: phases.map((ph) => ({
      id: ph.id,
      name: ph.name,
      status: ph.status,
      durationDays: ph.duration_days,
      startedAt: ph.started_at,
      completedAt: ph.completed_at,
      challenge: !!(ph.challenge && (ph.challenge as { enabled?: boolean }).enabled),
      awaitingStart: ph.awaiting_start,
      items: stepItems.filter((i) => i.phaseId === ph.id),
    })),
    reviews: reviews.slice(0, 20),
  };

  // El bloque Reuniones (Servicios A4, F137): con la sesión de quien mira. No depende del portal.
  const meetingRows = await loadServiceMeetings(supabase, {
    workspaceId: workspace.id,
    serviceId: s.id,
    contactId: s.contact_id,
    createdAt: s.created_at as string,
    endsOn: s.ends_on,
    itemIds: live.map((i) => i.id),
  }).catch(() => []);
  const meetings = ctx.can("calls.view") ? (
    <ServiceMeetingsBlock serviceId={s.id} rows={meetingRows} userNames={Object.fromEntries(memberLabels(team))} timeZone={timeZone} canLink={ctx.can("calls.edit")} />
  ) : null;

  return (
    <RecordModal label={`Servicio de ${data.contactName}`} size="lg" header={<ServiceRecordHeader data={data} today={today} members={team.map((m) => ({ id: m.userId, name: m.name }))} permissions={ctx.permissions.keys} />}>
      <ServiceRecordView
        data={data}
        tab={tab}
        today={today}
        timeZone={timeZone}
        userNames={Object.fromEntries(memberLabels(team))}
        permissions={ctx.permissions.keys}
        accesses={accesses}
        certificate={certificate}
        assistantCard={assistantCard}
        meetings={meetings}
      />
    </RecordModal>
  );
}
