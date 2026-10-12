import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdminRole, requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/forms/back-link";
import { Historial } from "@/components/historial/historial";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { REPORT_COLUMNS } from "@/lib/eod/reports-load";
import { reportStatusLabel } from "@/lib/eod/reports";
import type { LabeledAnswer } from "@/lib/forms/submission-schema";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function Answers({ answers }: { answers: Record<string, LabeledAnswer> }) {
  const entries = Object.entries(answers);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Sin respuestas.</p>;
  return (
    <dl className="divide-y divide-border">
      {entries.map(([key, a]) => (
        <div key={key} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <dt className="text-sm text-muted-foreground">{a.label}</dt>
          <dd className={a.type === "number" ? "text-sm font-semibold tabular-nums" : "whitespace-pre-line text-sm"}>{show(a.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Un reporte de fin de día (E9). Se lee con el cliente de la persona: la RLS decide si lo ve
 * (el suyo, o uno enviado si ve a todo el equipo). El Historial, para Owner y Admin.
 */
export default async function EodReportDetailPage({ params }: { params: Promise<{ id: string; reportId: string }> }) {
  const ctx = await requirePermission("forms.view");
  const { id, reportId } = await params;
  if (!UUID.test(id) || !UUID.test(reportId)) notFound();
  const { supabase, workspace } = ctx;

  const [{ data: report }, { data: form }, timeZone, members] = await Promise.all([
    supabase.from("eod_reports").select(`${REPORT_COLUMNS}, answers`).eq("id", reportId).eq("form_id", id).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("forms").select("id, name").eq("id", id).eq("workspace_id", workspace.id).maybeSingle(),
    resolveViewerTimezone(workspace.timezone),
    getWorkspaceMembers(workspace.id),
  ]);
  if (!report || !form) notFound();
  const { data: version } = report.form_version_id
    ? await supabase.from("form_versions").select("version_number").eq("id", report.form_version_id).maybeSingle()
    : { data: null };

  const names = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  const who = names[report.user_id] ?? "Alguien que ya no está en el equipo";
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone }) : null);
  const isDraft = report.status === "draft";
  const channels = (isDraft ? {} : (report.channels ?? {})) as unknown as Record<string, { label: string; answers: Record<string, LabeledAnswer> }>;
  const isOwn = report.user_id === ctx.user.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={`${who} · ${report.report_date}`} route="/dashboard/formularios/[id]/reportes/[reportId]" backHref={<BackLink href={`/dashboard/formularios/${id}/reportes`} label="Volver a Reportes" />} />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <section className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">{reportStatusLabel({ status: report.status, editCount: report.edit_count })}</span>
            <span className="text-muted-foreground">{form.name}</span>
            {version && <span className="text-muted-foreground">· versión {version.version_number}</span>}
            {report.submitted_at && <span className="text-muted-foreground">· enviado el {when(report.submitted_at)}</span>}
            {report.edited_at && (
              <span className="text-muted-foreground">
                · corregido el {when(report.edited_at)} ({report.edit_count === 1 ? "una vez" : `${report.edit_count} veces`})
              </span>
            )}
          </section>

          {isDraft ? (
            <div className="rounded-xl border border-border bg-card p-4 text-sm">
              <p>Este reporte todavía está en curso.</p>
              {isOwn && (
                <Link href={`/dashboard/eod/${id}?fecha=${report.report_date}`} className="mt-2 inline-block underline">
                  Seguir completándolo
                </Link>
              )}
            </div>
          ) : (
            <>
              <section aria-label="Preguntas generales" className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-1 text-sm font-semibold">Preguntas generales</h2>
                <Answers answers={(report.answers ?? {}) as unknown as Record<string, LabeledAnswer>} />
              </section>
              {Object.entries(channels).map(([key, channel]) => (
                <section key={key} aria-label={channel.label} className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-1 text-sm font-semibold">{channel.label}</h2>
                  <Answers answers={channel.answers ?? {}} />
                </section>
              ))}
            </>
          )}

          {isAdminRole(ctx.role) && !isDraft && (
            <section aria-label="Historial" className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Historial</h2>
              <Historial entityType="eod_report" entityId={report.id} names={{ users: names }} timeZone={timeZone} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
