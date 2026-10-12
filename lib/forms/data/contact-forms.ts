/**
 * Las respuestas de formularios de un contacto (R8). Se leen con el cliente de QUIEN MIRA: la RLS
 * (`can_see_form_submission`) decide cuáles ve; un Member no ve las respuestas de un contacto que no es suyo.
 * Las marcadas como spam no se muestran. Nunca se leen las respuestas (`answers`) ni la atribución.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildContactFormRows, CONTACT_FORMS_LIMIT, type ContactFormRow } from "../contact-forms";

type Db = SupabaseClient<Database>;

export async function loadContactForms(
  supabase: Db,
  args: { workspaceId: string; contactId: string; limit?: number; offset?: number },
): Promise<{ rows: ContactFormRow[]; total: number }> {
  const limit = args.limit ?? CONTACT_FORMS_LIMIT;
  const offset = args.offset ?? 0;
  const { data, count, error } = await supabase
    .from("form_submissions")
    .select("id, form_id, form_version_id, created_at, score, nps_category", { count: "exact" })
    .eq("workspace_id", args.workspaceId)
    .eq("contact_id", args.contactId)
    .neq("status", "spam")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error("[forms] no pude leer las respuestas del contacto, code=", error.code);
    return { rows: [], total: 0 };
  }
  const submissions = data ?? [];
  if (submissions.length === 0) return { rows: [], total: count ?? 0 };

  const formIds = [...new Set(submissions.map((s) => s.form_id))];
  const { data: forms } = await supabase.from("forms").select("id, name, type").in("id", formIds);

  const contractFormIds = new Set((forms ?? []).filter((f) => f.type === "contract").map((f) => f.id));
  const contractSubs = submissions.filter((s) => contractFormIds.has(s.form_id));
  const versionIds = [...new Set(contractSubs.map((s) => s.form_version_id).filter((v): v is string => !!v))];

  const [versions, signatures] = await Promise.all([
    versionIds.length ? supabase.from("form_versions").select("id, version_number").in("id", versionIds) : Promise.resolve({ data: [] as Array<{ id: string; version_number: number }> }),
    contractSubs.length
      ? supabase.from("contract_signatures").select("submission_id, email_status, pdf_status").in("submission_id", contractSubs.map((s) => s.id))
      : Promise.resolve({ data: [] as Array<{ submission_id: string; email_status: string | null; pdf_status: string | null }> }),
  ]);

  return {
    rows: buildContactFormRows({
      submissions,
      forms: forms ?? [],
      versions: versions.data ?? [],
      signatures: signatures.data ?? [],
    }),
    total: count ?? 0,
  };
}
