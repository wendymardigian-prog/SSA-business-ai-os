import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { BroadcastEditor, type EditorDraft } from "@/components/broadcasts/broadcast-editor";
import { BroadcastProgress, type ProgressRecipient } from "@/components/broadcasts/broadcast-progress";
import { listBroadcastChannels } from "@/lib/broadcasts/channels";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { loadContactFilterOptions } from "@/lib/contacts/filter-options-load";
import { sanitizeAudienceParams } from "@/lib/broadcasts/audience-load";
import { cleanVariants } from "@/lib/broadcasts/render";
import { recipientReason } from "@/lib/broadcasts/status";
import { combinePolicies, parseBroadcastPace } from "@/lib/send-queue/pace";
import { firstParam, pickPage } from "@/lib/url-params";
import type { BroadcastRecipientStatus } from "@/lib/types/database";
import { createServiceClient } from "@/lib/supabase/server";
import { contactsWithEmailResult, countDeferredRecipients, loadBroadcastEmailResults, loadRecipientEmailRows } from "@/lib/broadcasts/email-results";
import { parseEmailResultFilter, recipientEmailBadges } from "@/lib/broadcasts/email-results-view";

const PAGE_SIZE = 50;
const RECIPIENT_STATUSES: BroadcastRecipientStatus[] = ["pending", "sending", "sent", "failed", "skipped", "cancelled"];

/**
 * Un broadcast: en borrador, el editor de cuatro pasos; después, el avance con
 * cada destinatario (`?estado=` filtra, `?pag=` pagina). Lee con el cliente de
 * la persona: desde la 00285 la RLS pide `broadcasts.manage`.
 */
export default async function BroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ broadcastId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("broadcasts.manage");
  const { broadcastId } = await params;
  const query = await searchParams;
  const { workspace, supabase } = await getWorkspace();
  const timeZone = await resolveViewerTimezone(workspace.timezone);
  // El horario permitido y el tope por dia de la cola corren en la zona del negocio: la estimacion de cuando termina tambien.
  const businessTimeZone = workspace.timezone || "UTC";

  if (!/^[0-9a-f-]{36}$/i.test(broadcastId)) notFound();
  const { data: b } = await supabase.from("broadcasts").select("*").eq("id", broadcastId).eq("workspace_id", workspace.id).maybeSingle();
  if (!b) notFound();

  const channels = await listBroadcastChannels(supabase, workspace.id);
  const header = (
    <PageHeader
      title={b.name}
      backHref={
        <Link href="/dashboard/broadcasts" aria-label="Volver a Broadcasts" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      }
    />
  );

  if (b.status === "draft") {
    const { options, customFields, hasAnonymous } = await loadContactFilterOptions(supabase, workspace.id);
    const draft: EditorDraft = {
      id: b.id,
      name: b.name,
      channelId: channels.some((c) => c.id === b.channel_id) ? b.channel_id : null,
      audienceParams: sanitizeAudienceParams(b.audience_params),
      includePhoneOnly: b.include_phone_only,
      variants: Array.isArray(b.message_variants) ? (b.message_variants as unknown[]).filter((v): v is string => typeof v === "string") : [],
      emailSubject: b.email_subject ?? "",
      emailPreheader: b.email_preheader ?? "",
      skipMissingVariables: b.skip_missing_variables,
      pace: parseBroadcastPace(b.pace),
      scheduledFor: b.scheduled_for,
    };
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-auto">
          <BroadcastEditor draft={draft} channels={channels} filterOptions={options} customFields={customFields} hasAnonymous={hasAnonymous} timeZone={timeZone} businessTimeZone={businessTimeZone} />
        </div>
      </div>
    );
  }

  const estado = firstParam(query.estado);
  const filter = (RECIPIENT_STATUSES as string[]).includes(estado) ? (estado as BroadcastRecipientStatus) : "";
  const page = pickPage(query.pag);
  const channel = channels.find((c) => c.id === b.channel_id) ?? null;
  // Los resultados de un broadcast por email (A9, 00287): con el cliente de servicio DESPUES de `broadcasts.manage`
  // (la RLS de email_log es de Owner/Admin), siempre filtrando por el workspace de la sesion y este broadcast.
  const isEmail = channel?.kind === "email";
  const service = isEmail ? await createServiceClient() : null;
  const emailFilter = isEmail ? parseEmailResultFilter(firstParam(query.email)) : "";
  const emailFilterIds = service && emailFilter ? await contactsWithEmailResult(service, workspace.id, b.id, emailFilter) : null;

  const countFor = (status: BroadcastRecipientStatus) =>
    supabase.from("broadcast_recipients").select("id", { count: "exact", head: true }).eq("broadcast_id", b.id).eq("status", status);
  let list = supabase
    .from("broadcast_recipients")
    .select("id, contact_id, target, status, skip_reason, error_message, sent_at, conversation_id, contacts(display_name)", { count: "exact" })
    .eq("broadcast_id", b.id);
  if (filter === "pending") list = list.in("status", ["pending", "sending"]);
  else if (filter) list = list.eq("status", filter);
  if (emailFilterIds) list = list.in("contact_id", emailFilterIds.length > 0 ? emailFilterIds : ["00000000-0000-0000-0000-000000000000"]);

  const [countRes, listRes, laneRes, emailResults, deferred] = await Promise.all([
    Promise.all(RECIPIENT_STATUSES.map(countFor)),
    list.order("sent_at", { ascending: false, nullsFirst: false }).order("id").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    b.channel_id ? supabase.from("channel_send_lanes").select("paused_at, paused_reason").eq("channel_id", b.channel_id).maybeSingle() : Promise.resolve({ data: null }),
    service ? loadBroadcastEmailResults(service, workspace.id, b.id) : Promise.resolve(null),
    service ? countDeferredRecipients(service, b.id) : Promise.resolve(null),
  ]);
  const counts = Object.fromEntries(RECIPIENT_STATUSES.map((s, i) => [s, countRes[i].count ?? 0])) as Record<BroadcastRecipientStatus, number>;

  const listRows = (listRes.data ?? []) as unknown as Array<{ contact_id: string }>;
  const emailRows = service ? await loadRecipientEmailRows(service, workspace.id, b.id, listRows.map((r) => r.contact_id)) : new Map();
  const recipients: ProgressRecipient[] = ((listRes.data ?? []) as unknown as Array<{
    id: string;
    contact_id: string;
    target: string | null;
    status: BroadcastRecipientStatus;
    skip_reason: string | null;
    error_message: string | null;
    sent_at: string | null;
    conversation_id: string | null;
    contacts: { display_name: string | null } | null;
  }>).map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    name: r.contacts?.display_name || "Sin nombre",
    target: r.target,
    status: r.status,
    reason: r.status === "skipped" || r.status === "failed" ? recipientReason(r.skip_reason, r.error_message) : null,
    sentAt: r.sent_at,
    conversationId: r.conversation_id,
    emailBadges: recipientEmailBadges(emailRows.get(r.contact_id)),
  }));

  const variants = cleanVariants(b.message_variants);
  const lane = laneRes.data as { paused_at: string | null; paused_reason: string | null } | null;

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-auto">
        <BroadcastProgress
          broadcast={{
            id: b.id,
            name: b.name,
            status: b.status,
            scheduledFor: b.scheduled_for,
            startedAt: b.started_at,
            completedAt: b.completed_at,
            previewText: [b.email_subject, ...variants].filter(Boolean).join("\n\n— — —\n\n"),
          }}
          channel={channel ? { id: channel.id, label: channel.label } : null}
          policy={channel ? combinePolicies(channel.policy, parseBroadcastPace(b.pace)) : null}
          lane={lane ? { paused: lane.paused_at !== null, pausedReason: lane.paused_reason } : null}
          counts={counts}
          emailResults={emailResults}
          deferredCount={deferred}
          emailFilter={emailFilter}
          recipients={recipients}
          filter={filter}
          page={page}
          pageCount={Math.max(1, Math.ceil((listRes.count ?? 0) / PAGE_SIZE))}
          timeZone={timeZone}
          businessTimeZone={businessTimeZone}
        />
      </div>
    </div>
  );
}
