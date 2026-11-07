import Link from "next/link";
import { ArrowUpRight, MessageCircle, TriangleAlert } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext, requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/comunicacion/section-tabs";
import { CreateFlowButton } from "@/components/create-flow-button";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { formatRunDate } from "@/lib/flows/runs";
import { percent, formatCount } from "@/lib/flows/node-metrics";
import { firstParam, type SearchParams } from "@/lib/url-params";
import {
  buildCommentAutomations,
  commentLogStatus,
  commentStatsSince,
  newCommentAutomationBody,
  type CommentLogRow,
  type CommentTriggerRow,
  type FailedStepRow,
} from "@/lib/comments/automation-list";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Comentarios (antes Growth): las automatizaciones de comentarios y como les fue en los ultimos 30 dias. Solo lectura:
 * se arman y se cambian en el lienzo de cada automatizacion. Lee con la sesion (la RLS decide que se ve).
 *
 * `?trigger=&keyword=&channel=` (lo arma Contenido cuando falta la automatizacion de una pieza) muestra un aviso con el
 * boton para crearla con la palabra y la cuenta ya puestas.
 */
export default async function CommentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("flows.view");
  const { workspace, supabase } = await getWorkspace();
  const canEdit = (await getPermissionContext()).can("flows.edit");
  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const params = await searchParams;
  const since = commentStatsSince();

  const [{ data: triggers, error: triggersError }, { data: channels }, { data: logs }, { data: recent }] = await Promise.all([
    supabase
      .from("triggers")
      .select("id, flow_id, channel_id, is_active, config, flow:flows!inner(id, name, status, workspace_id)")
      .eq("type", "comment_keyword")
      .eq("flows.workspace_id", workspace.id),
    supabase.from("channels").select("id, username, display_name").eq("workspace_id", workspace.id).eq("platform", "instagram"),
    supabase
      .from("comment_logs")
      .select("matched_trigger_id, dm_sent, reply_sent")
      .eq("workspace_id", workspace.id)
      .gte("created_at", since)
      .limit(5000),
    supabase
      .from("comment_logs")
      .select("id, created_at, author_username, author_name, comment_text, matched_trigger_id, dm_sent, reply_sent, error")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (triggersError) console.error(`[comentarios] no pude leer las automatizaciones (code=${triggersError.code ?? "?"})`);

  const triggerRows = (triggers ?? []) as unknown as CommentTriggerRow[];
  const flowIds = [...new Set(triggerRows.map((t) => t.flow_id))];
  const { data: failures } = flowIds.length
    ? await supabase
        .from("flow_session_steps")
        .select("flow_id, reason")
        .in("flow_id", flowIds)
        .eq("status", "failed")
        .in("node_type", ["privateReply", "sendMessage"])
        .gte("started_at", since)
        .limit(1000)
    : { data: [] as FailedStepRow[] };

  const channelNames = Object.fromEntries(
    ((channels ?? []) as Array<{ id: string; username: string | null; display_name: string | null }>).map((c) => [c.id, c.username ? `@${c.username}` : (c.display_name ?? "Cuenta de Instagram")]),
  );
  const automations = buildCommentAutomations({
    triggers: triggerRows,
    channelNames,
    logs: (logs ?? []) as CommentLogRow[],
    failures: (failures ?? []) as FailedStepRow[],
  });
  const flowNames = Object.fromEntries(automations.map((a) => [a.triggerId, a.flowName]));
  const totals = automations.reduce((acc, a) => ({ matched: acc.matched + a.matched, dmSent: acc.dmSent + a.dmSent }), { matched: 0, dmSent: 0 });

  const prefillTrigger = firstParam(params.trigger) === "keyword" ? "keyword" : "comment_keyword";
  const prefillKeyword = firstParam(params.keyword).trim().slice(0, 60) || null;
  const prefillChannel = UUID.test(firstParam(params.channel)) ? firstParam(params.channel) : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/comentarios"
        left={<SectionTabs />}
        right={canEdit ? <CreateFlowButton body={newCommentAutomationBody({ trigger: "comment_keyword", keyword: null, channelId: null })} label="Nueva automatización de comentario" /> : null}
      />

      <div className="flex-1 space-y-6 overflow-auto px-4 py-6 md:px-8">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Cuando alguien comenta una palabra en una publicación, una automatización le contesta por privado. Acá ves las que hay y cómo les fue; se arman y se cambian en el lienzo de cada una.
        </p>

        {prefillKeyword && canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-300/60 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
            <span>
              Falta la automatización para la palabra <strong>«{prefillKeyword}»</strong>.
            </span>
            <CreateFlowButton body={newCommentAutomationBody({ trigger: prefillTrigger, keyword: prefillKeyword, channelId: prefillChannel })} label="Crearla con esa palabra" />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Comentarios que coincidieron" value={formatCount(totals.matched)} hint="Últimos 30 días" />
          <Stat label="Mensajes privados enviados" value={formatCount(totals.dmSent)} hint="Últimos 30 días" />
          <Stat label="Llegaron" value={percent(totals.dmSent, totals.matched)} hint="De los que coincidieron" />
        </div>

        <section aria-labelledby="comment-automations">
          <h2 id="comment-automations" className="mb-3 text-sm font-semibold">Automatizaciones de comentarios</h2>
          {automations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">Todavía no hay automatizaciones de comentarios</p>
              <p className="mt-1 text-sm text-muted-foreground">Creá una con el disparador «Palabra clave en un comentario».</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {automations.map((a) => (
                <li key={a.triggerId} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/dashboard/flows/${a.flowId}`} className="font-medium underline-offset-2 hover:underline">
                          {a.flowName}
                        </Link>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            a.published && a.active ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {a.published && a.active ? "Activa" : a.published ? "Pausada" : "En borrador"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {a.keywords.length > 0 ? `Palabras: ${a.keywords.join(", ")}` : "Sin palabras"} · {a.scope}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>
                        <span className="font-semibold">{formatCount(a.matched)}</span> <span className="text-muted-foreground">coincidieron</span>
                      </span>
                      <span>
                        <span className="font-semibold">{formatCount(a.dmSent)}</span> <span className="text-muted-foreground">recibieron el mensaje</span>
                      </span>
                      <Link href={`/dashboard/flows/${a.flowId}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent">
                        Abrir en el lienzo
                        <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </Link>
                    </div>
                  </div>
                  {a.notSent > 0 && (
                    <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                      {formatCount(a.notSent)} no recibieron el mensaje{a.topFailure ? `. El motivo más común: ${a.topFailure}` : "."}{" "}
                      <Link href={`/dashboard/flows/${a.flowId}/ejecuciones?estado=con_fallos`} className="font-medium underline underline-offset-2">
                        Ver las ejecuciones
                      </Link>
                    </p>
                  )}
                  {a.legacy && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
                      Regla vieja de Growth: elegí la cuenta y las publicaciones en el disparador de la automatización y publicala, para que quede todo en el lienzo.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="comment-activity">
          <h2 id="comment-activity" className="mb-3 text-sm font-semibold">Actividad reciente</h2>
          {(recent ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no llegó ningún comentario.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full table-fixed text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-40 px-4 py-2.5 font-medium">Quién</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Comentario</th>
                    <th scope="col" className="hidden w-48 px-4 py-2.5 font-medium md:table-cell">Automatización</th>
                    <th scope="col" className="w-36 px-4 py-2.5 font-medium">Estado</th>
                    <th scope="col" className="hidden w-36 px-4 py-2.5 font-medium sm:table-cell">Cuándo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(
                    (recent ?? []) as Array<{
                      id: string;
                      created_at: string;
                      author_username: string | null;
                      author_name: string | null;
                      comment_text: string | null;
                      matched_trigger_id: string | null;
                      dm_sent: boolean;
                      error: string | null;
                    }>
                  ).map((log) => {
                    const status = commentLogStatus(log);
                    return (
                      <tr key={log.id}>
                        <td className="truncate px-4 py-2.5">{log.author_username ? `@${log.author_username}` : (log.author_name ?? "—")}</td>
                        <td className="truncate px-4 py-2.5 text-muted-foreground">{log.comment_text ?? ""}</td>
                        <td className="hidden truncate px-4 py-2.5 text-muted-foreground md:table-cell">{log.matched_trigger_id ? (flowNames[log.matched_trigger_id] ?? "—") : "—"}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              status.tone === "ok" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
                              status.tone === "fail" && "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
                              status.tone === "muted" && "bg-muted text-muted-foreground",
                            )}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2.5 text-muted-foreground sm:table-cell">{formatRunDate(log.created_at, timeZone)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
