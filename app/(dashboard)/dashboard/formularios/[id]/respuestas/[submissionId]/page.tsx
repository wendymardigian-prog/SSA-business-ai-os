import { notFound } from "next/navigation";
import { requirePermission, isAdminRole } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { SubmissionDetail } from "@/components/forms/responses/submission-detail";
import { fieldsOf } from "@/lib/forms/server-ports";
import type { StoredAnswer } from "@/lib/forms/responses";
import type { ContractView } from "@/components/forms/responses/contract-panel";
import type { SubmissionStatus } from "@/lib/forms/responses";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El detalle de una respuesta (F13). Se lee con el cliente de la persona: si la
 * RLS no la deja ver, es como si no existiera (404), y un Member nunca obtiene el
 * link de un archivo de una respuesta que no ve.
 */
export default async function RespuestaPage({ params }: { params: Promise<{ id: string; submissionId: string }> }) {
  const ctx = await requirePermission("forms.view");
  const { id, submissionId } = await params;
  if (!UUID.test(id) || !UUID.test(submissionId)) notFound();
  const { supabase, workspace } = ctx;

  const { data: submission } = await supabase
    .from("form_submissions")
    .select("id, form_id, form_version_id, status, answers, contact_id, contact_created, dedupe, score, nps_category, attribution, meta, created_at")
    .eq("id", submissionId)
    .eq("form_id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!submission) notFound();

  const [{ data: form }, { data: version }, contactRes, members, timeZone] = await Promise.all([
    supabase.from("forms").select("id, name, type").eq("id", id).maybeSingle(),
    supabase.from("form_versions").select("version_number, definition").eq("id", submission.form_version_id).maybeSingle(),
    submission.contact_id ? supabase.from("contacts").select("id, display_name, email").eq("id", submission.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
  ]);
  if (!form) notFound();

  // La firma de un contrato (con la sesión de quien mira: la RLS decide).
  let contract: ContractView | null = null;
  if (form.type === "contract") {
    const { data: sig } = await supabase.from("contract_signatures").select("*").eq("submission_id", submissionId).maybeSingle();
    if (sig) {
      const legal = (sig.legal ?? {}) as Record<string, unknown>;
      const text = (key: string) => (typeof legal[key] === "string" ? (legal[key] as string) : null);
      const { data: sigVersion } = await supabase.from("form_versions").select("version_number").eq("id", sig.form_version_id).maybeSingle();
      contract = {
        signedAt: sig.signed_at,
        signerName: sig.signer_name,
        signerEmail: sig.signer_email,
        versionNumber: sigVersion?.version_number ?? null,
        sha256: sig.text_sha256,
        hasSignatureImage: !!sig.signature_path,
        pdfStatus: sig.pdf_status,
        pdfAttempts: sig.pdf_attempts,
        emailStatus: sig.email_status,
        emailAttempts: sig.email_attempts,
        emailNextRetryAt: sig.email_next_retry_at,
        emailSentAt: sig.email_sent_at,
        emailLastError: sig.email_last_error,
        device: text("device"),
        os: text("os"),
        browser: text("browser"),
        ip: text("ip"),
      };
    }
  }

  const meta = (submission.meta ?? {}) as Record<string, unknown>;
  const dedupe = (submission.dedupe ?? {}) as { matched_by?: string | null; conflict_contact_id?: string | null };

  return (
    <SubmissionDetail
      formId={form.id}
      formName={form.name}
      formType={form.type as "custom" | "survey" | "contract"}
      submission={{
        id: submission.id,
        status: submission.status as SubmissionStatus,
        createdAt: submission.created_at,
        answers: (submission.answers ?? {}) as unknown as Record<string, StoredAnswer>,
        score: submission.score,
        npsCategory: submission.nps_category,
        attribution: (submission.attribution ?? {}) as Record<string, unknown>,
        versionNumber: version?.version_number ?? null,
        origin: typeof meta.origin === "string" ? meta.origin : null,
        sitePath: typeof meta.site_path === "string" ? meta.site_path : null,
        timezone: typeof meta.timezone === "string" ? meta.timezone : null,
        contactCreated: submission.contact_created,
        matchedBy: dedupe.matched_by ?? null,
        conflictContactId: dedupe.conflict_contact_id ?? null,
      }}
      fieldOrder={fieldsOf(version?.definition).map((f) => f.key)}
      contact={contactRes.data ? { id: contactRes.data.id, name: contactRes.data.display_name || contactRes.data.email || "Sin nombre" } : null}
      canManage={ctx.can("forms.manage")}
      showHistory={isAdminRole(ctx.role)}
      names={Object.fromEntries(members.map((m) => [m.userId, m.name]))}
      timeZone={timeZone}
      contract={contract}
    />
  );
}
