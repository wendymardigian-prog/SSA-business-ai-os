import { notFound } from "next/navigation";
import { CallDetail, type CallDetailData } from "@/components/calls/call-detail";
import { getPermissionContext } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { canAnalyze } from "@/lib/calls/status";
import { detailView } from "@/lib/calls/detail-view";
import { readAnalysis } from "@/lib/calls/detail";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveCallTaskSettings, validTypeKeys } from "@/lib/calls/task-settings";
import { knowledgeEligibility } from "@/lib/calls/knowledge-run";
import { summaryEligibility } from "@/lib/calls/summary";
import type { CallUsesData } from "@/components/calls/call-uses";
import type { CallObjection } from "@/components/calls/section-tools";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { CallAnalysisStatus, CallAttendee, CallTranscriptLine } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ficha de una llamada (F13). Se lee con el cliente del usuario: si la RLS
 * no deja ver la llamada, es un 404 (no se confirma que exista).
 */
export default async function LlamadaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("calls.view")) redirect("/dashboard");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { workspace, supabase } = ctx;
  const service = await createServiceClient();

  const { data: call } = await supabase
    .from("calls")
    .select(
      "id, source, title, recorded_at, duration_seconds, fathom_url, share_url, recorded_by_user_id, recorded_by_email, attendees, transcript, contact_id, booking_id, call_type, call_type_source, call_type_rule, call_type_confidence, analysis_status, analysis_status_reason, analysis_error, analysis, closer_score, lead_score, outcome, analysis_model, analysis_prompt_version, rubric_version, analysis_run_id, analyzed_at, quotes_total, quotes_verified, archived_at, analysis_ai, objections, summary, summary_status, memory_status, knowledge_document_id",
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

  // Lo que se analiza lo decide la configuracion del negocio, no una lista fija.
  const { data: wsRow } = await service.from("workspaces").select("ai_background_settings").eq("id", workspace.id).maybeSingle();
  const taskSettings = resolveCallTaskSettings(wsRow?.ai_background_settings);
  const analyzeTypes = taskSettings.call_analysis.analyze_types;

  const verdict = canAnalyze({ status, callType: call.call_type, analyzeTypes, hasTranscript: lines.length > 0, canEdit });
  const view = detailView({
    status,
    reason: call.analysis_status_reason,
    error: call.analysis_error,
    hasAnalysis: !analysis.empty,
    canEdit,
    canConfigure: ctx.can("calls.configure"),
    analyze: verdict,
  });

  const summaryCheck = summaryEligibility({ call_type: call.call_type, transcript: lines });
  const knowledgeCheck = knowledgeEligibility({ call_type: call.call_type, transcript: lines });
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
    callType: call.call_type,
    callTypeSource: call.call_type_source,
    callTypeRule: call.call_type_rule,
    callTypeConfidence: call.call_type_confidence === null ? null : Number(call.call_type_confidence),
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
    types: validTypeKeys(taskSettings.call_classification.custom_types),
    suggestions: Object.fromEntries(Object.entries(taskSettings.call_analysis.categories.accepted).map(([group, list]) => [group, list.filter((c) => !c.archivado)])),
    analyzeDisabledReason: !verdict.ok ? (verdict.reason ?? null) : null,
    uses: view.analysisAvailable ? uses : undefined,
  };

  return <CallDetail data={data} view={view} canEdit={canEdit} />;
}
