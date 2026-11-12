import { notFound } from "next/navigation";
import { CallDetail, type CallDetailData } from "@/components/calls/call-detail";
import { getPermissionContext } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { canAnalyze } from "@/lib/calls/status";
import { detailView } from "@/lib/calls/detail-view";
import { readAnalysis } from "@/lib/calls/detail";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveProfile } from "@/lib/calls/profiles";
import { loadCallProfiles } from "@/lib/calls/profiles-load";
import { resolveCallTaskSettings } from "@/lib/calls/task-settings";
import { callDisplayLabel, categoryGroups, legacyCallTypeFor, readCategorySnapshot } from "@/lib/calls/catalog";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { knowledgeEligibility } from "@/lib/calls/knowledge-run";
import { summaryEligibility } from "@/lib/calls/summary";
import type { CallUsesData } from "@/components/calls/call-uses";
import type { CallObjection } from "@/components/calls/section-tools";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { CallAnalysisStatus, CallAttendee, CallTranscriptLine } from "@/lib/types/database";
import { manualSummaryOf } from "@/lib/calls/manual-summary";
import { readProposals } from "@/lib/calls/proposals";
import { ACTIVITY_ACTIONS, activityEntries, type CallAuditRow } from "@/lib/calls/activity";
import { svcSchema } from "@/lib/services/db";
import { isModuleEnabled } from "@/lib/services/module"; // @plantilla-quitar(servicios)
import { loadCallServiceInfo } from "@/lib/calls/service-detail-load"; // @plantilla-quitar(servicios)
import type { CallServiceInfo } from "@/components/calls/call-service"; // @plantilla-quitar(servicios)

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ficha de una llamada (F13). Se lee con el cliente del usuario: si la RLS
 * no deja ver la llamada, es un 404 (no se confirma que exista).
 */
export default async function LlamadaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string }> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("calls.view")) redirect("/dashboard");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { workspace, supabase } = ctx;
  const service = await createServiceClient();

  const { data: call } = await supabase
    .from("calls")
    .select(
      "id, source, title, recorded_at, duration_seconds, fathom_url, share_url, recorded_by_user_id, recorded_by_email, attendees, transcript, contact_id, booking_id, area_id, category_id, category_snapshot, no_show, analyzed_category_id, classification_source, classification_rule, classification_confidence, analysis_status, analysis_status_reason, analysis_error, analysis, closer_score, lead_score, outcome, analysis_model, analysis_prompt_version, rubric_version, analysis_run_id, analyzed_at, quotes_total, quotes_verified, archived_at, analysis_ai, objections, summary, summary_status, memory_status, knowledge_document_id, service_id, service_link, proposals",
    )
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!call) notFound();

  const [members, contact, booking, ideasRes, knowledgeRes] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    call.contact_id
      ? supabase.from("contacts").select("id, display_name, email").eq("id", call.contact_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    call.booking_id
      ? supabase.from("bookings").select("id, start_at").eq("id", call.booking_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    // Las ideas de contenido que salieron de esta llamada y el documento de Conocimiento: lo que la RLS deje ver.
    supabase.from("content_ideas").select("id, title").eq("workspace_id", workspace.id).eq("call_id", id).is("deleted_at", null).order("position", { ascending: true }).limit(10),
    call.knowledge_document_id
      ? supabase.from("knowledge_base").select("id, status, error_detail").eq("id", call.knowledge_document_id).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // El costo es del permiso de costos de IA, y agent_runs no se lee con el cliente del usuario.
  let costUsd: number | null = null;
  if (call.analysis_run_id && ctx.can("ai_costs.view")) {
    const { data: run } = await service.from("agent_runs").select("cost_usd").eq("id", call.analysis_run_id).maybeSingle();
    costUsd = run?.cost_usd === null || run?.cost_usd === undefined ? null : Number(run.cost_usd);
  }

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const closer = members.find((m) => m.userId === call.recorded_by_user_id);
  const lines = (Array.isArray(call.transcript) ? call.transcript : []) as CallTranscriptLine[];
  const status = call.analysis_status as CallAnalysisStatus;
  const analysis = readAnalysis(call.analysis);
  const canEdit = ctx.can("calls.edit");

  // Lo que se analiza lo decide el analizador de cada tipo.
  const { data: wsRow } = await service.from("workspaces").select("ai_background_settings").eq("id", workspace.id).maybeSingle();
  const taskSettings = resolveCallTaskSettings(wsRow?.ai_background_settings);
  const categories = (await listCategories(supabase, workspace.id)).map(toCategoryRow);
  const profiles = await loadCallProfiles(service, workspace.id);

  const verdict = canAnalyze({
    status,
    hasArea: Boolean(call.area_id),
    noShow: call.no_show,
    hasProfile: Boolean(resolveProfile(profiles, { categoryId: call.category_id, areaId: call.area_id })),
    hasTranscript: lines.length > 0,
    canEdit,
  });
  const view = detailView({
    status,
    reason: call.analysis_status_reason,
    error: call.analysis_error,
    hasAnalysis: !analysis.empty,
    canEdit,
    canConfigure: ctx.can("calls.configure"),
    analyze: verdict,
  });

  const legacyType = legacyCallTypeFor(readCategorySnapshot(call.category_snapshot), categories, call.no_show);
  const summaryCheck = summaryEligibility({ call_type: legacyType, transcript: lines });
  const knowledgeCheck = knowledgeEligibility({ call_type: legacyType, transcript: lines });
  const uses: CallUsesData = {
    callId: call.id,
    summary: (call.summary ?? null) as CallUsesData["summary"],
    summaryStatus: call.summary_status,
    memoryStatus: call.memory_status,
    hasContact: !!call.contact_id,
    ideas: (ideasRes.data ?? []).map((i) => ({ id: i.id, title: i.title })),
    knowledge: knowledgeRes.data ? { id: knowledgeRes.data.id, status: knowledgeRes.data.status, errorDetail: knowledgeRes.data.error_detail } : null,
    canSummarize: canEdit && summaryCheck.ok,
    summarizeDisabledReason: null,
    canKnowledge: canEdit && ctx.can("knowledge.edit") && knowledgeCheck.ok,
    knowledgeDisabledReason: null,
  };

  const data: CallDetailData = {
    callId: call.id,
    status,
    statusReason: call.analysis_status_reason,
    title: call.title,
    recordedAt: call.recorded_at,
    durationSeconds: call.duration_seconds,
    source: call.source,
    fathomUrl: call.fathom_url,
    shareUrl: call.share_url,
    recorderEmail: call.recorded_by_email,
    closerName: closer?.name ?? null,
    contact: contact ? { id: contact.id, name: contact.display_name || contact.email || "Sin nombre" } : null,
    booking: booking ? { id: booking.id, startAt: booking.start_at } : null,
    lines,
    attendees: (Array.isArray(call.attendees) ? call.attendees : []) as CallAttendee[],
    analysis: call.analysis,
    callType: legacyType,
    classificationSource: call.classification_source,
    classificationRule: call.classification_rule,
    classificationConfidence: call.classification_confidence === null ? null : Number(call.classification_confidence),
    needsReview: status === "needs_review",
    outcome: call.outcome,
    closerScore: call.closer_score,
    leadScore: call.lead_score,
    temperature: analysis.temperature,
    model: call.analysis_model,
    promptVersion: call.analysis_prompt_version,
    rubricVersion: call.rubric_version,
    costUsd,
    analyzedAt: call.analyzed_at,
    quotesTotal: call.quotes_total,
    quotesVerified: call.quotes_verified,
    names: { users: Object.fromEntries(members.map((m) => [m.userId, m.name])), agents: {} },
    timeZone,
    emptyMessage: view.emptyMessage,
    analysisAi: call.analysis_ai,
    objections: (Array.isArray(call.objections) ? call.objections : []) as unknown as CallObjection[],
    isCloser: call.recorded_by_user_id === ctx.user.id,
    categoryGroups: categoryGroups(categories),
    categoryId: call.category_id,
    categoryLabel: callDisplayLabel(call.category_snapshot, call.no_show),
    noShow: call.no_show,
    analyzedWithOtherCategory: status === "analyzed" && !!call.analyzed_category_id && call.analyzed_category_id !== call.category_id,
    suggestions: Object.fromEntries(Object.entries(taskSettings.call_analysis.categories.accepted).map(([group, list]) => [group, list.filter((c) => !c.archivado)])),
    analyzeDisabledReason: !verdict.ok ? (verdict.reason ?? null) : null,
    uses: view.analysisAvailable ? uses : undefined,
    manual: manualSummaryOf(call.summary),
    // «Cargar a mano» (F141): en una reunión sin análisis, o si ya tiene algo cargado.
    showManual: manualSummaryOf(call.summary) !== null || (status !== "analyzed" && status !== "analyzing" && status !== "classifying"),
    canCreateTasks: ctx.can("tasks.edit"),
  };
  // @plantilla-desde(servicios)
  let serviceInfo: CallServiceInfo | null = null;
  if (isModuleEnabled(workspace as { services_enabled?: boolean | null })) {
    const row = call as unknown as { service_id: string | null; service_link: string | null };
    serviceInfo = await loadCallServiceInfo(service, {
      workspaceId: workspace.id,
      contactId: call.contact_id,
      recordedAt: call.recorded_at,
      timeZone: workspace.timezone || "UTC",
      serviceId: row.service_id,
      link: row.service_link,
      canChange: canEdit,
    });
  }
  data.service = serviceInfo;
  // @plantilla-hasta(servicios)

  // F143 y F145: las propuestas, la actividad y las menciones sin leer de esta reunión.
  const callExtra = call as unknown as { proposals?: unknown; service_id?: string | null };
  data.proposals = readProposals(callExtra.proposals);
  data.permissions = ctx.permissions.keys;
  if (callExtra.service_id && data.proposals.some((p) => p.type === "paso")) {
    const { data: items } = await svcSchema(service).from("service_items").select("template_key, name").eq("service_id", callExtra.service_id).limit(200);
    data.pendingStepNames = Object.fromEntries(((items ?? []) as Array<{ template_key: string | null; name: string }>).filter((i) => i.template_key).map((i) => [i.template_key as string, i.name]));
  }
  const [{ data: auditRows }, { count: unreadMentions }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, action, performed_at, performed_by, actor_type, changes, metadata")
      .eq("workspace_id", workspace.id)
      .eq("entity_type", "call")
      .eq("entity_id", call.id)
      .in("action", [...ACTIVITY_ACTIONS])
      .order("performed_at", { ascending: true })
      .limit(200),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("recipient_id", ctx.user.id)
      .eq("type", "mentioned")
      .eq("entity_id", call.id)
      .is("read_at", null),
  ]);
  const serviceLabelMap: Record<string, string> = serviceInfo ? Object.fromEntries(serviceInfo.options.filter((o) => o.id).map((o) => [o.id as string, o.label])) : {};
  data.activity = activityEntries((auditRows ?? []) as unknown as CallAuditRow[], Object.fromEntries(members.map((m) => [m.userId, m.name])), serviceLabelMap);
  data.unreadMentions = unreadMentions ?? 0;
  const sp = searchParams ? await searchParams : {};
  data.initialTab = sp.tab === "actividad" ? "actividad" : null;

  return <CallDetail data={data} view={view} canEdit={canEdit} />;
}
