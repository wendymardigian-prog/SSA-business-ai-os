import { requirePermission } from "@/lib/auth/guards";
import { FormsList } from "@/components/forms/list/forms-list";
import { formListRow } from "@/lib/forms/list";
import type { FormStatus, FormType } from "@/lib/forms/fields";

export const dynamic = "force-dynamic";

/**
 * Lista de formularios (F3). Lee con el cliente de la persona: la RLS decide
 * qué ve. Los envíos y el último envío se cuentan sobre las respuestas que esa
 * persona puede ver (un Member ve las de sus contactos).
 */
export default async function FormulariosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("forms.view");
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  const filter = typeof sp.estado === "string" ? sp.estado : undefined;

  const { data: forms, error } = await supabase
    .from("forms")
    .select("id, name, type, status, slug, updated_at")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  // Un tope razonable: la lista no necesita contar millones de filas, solo dar una idea.
  const { data: submissions } = await supabase
    .from("form_submissions")
    .select("form_id, created_at")
    .eq("workspace_id", workspace.id)
    .neq("status", "spam")
    .order("created_at", { ascending: false })
    .limit(10000);

  const stats = new Map<string, { submissions: number; lastSubmissionAt: string | null }>();
  for (const s of submissions ?? []) {
    const current = stats.get(s.form_id) ?? { submissions: 0, lastSubmissionAt: null };
    current.submissions += 1;
    current.lastSubmissionAt ??= s.created_at; // viene de la más nueva a la más vieja
    stats.set(s.form_id, current);
  }

  const rows = (forms ?? []).map((f) =>
    formListRow({ id: f.id, name: f.name, type: f.type as FormType, status: f.status as FormStatus, slug: f.slug, updated_at: f.updated_at }, stats.get(f.id)),
  );

  return (
    <FormsList
      rows={rows}
      canManage={ctx.can("forms.manage")}
      loadError={!!error}
      initialFilter={filter}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}
