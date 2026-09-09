import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { SequenceEditor } from "@/components/sequences/sequence-editor";
import { EnrollmentList, type EnrollmentRow } from "@/components/sequences/enrollment-list";
import type { SequenceEnrollmentStatus, SequenceStep } from "@/lib/types/database";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ sequenceId: string }>;
}) {
  const { sequenceId } = await params;
  const { workspace, supabase, role } = await getWorkspace();
  const canEdit = isAdminRole(role);

  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, name, description, status, steps")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!sequence) notFound();

  // El scope de leads lo aplica la RLS (migracion 00041): un Member solo ve
  // las inscripciones de los contactos que le corresponden.
  const [{ data: enrollments }, aiProviders] = await Promise.all([
    supabase
      .from("sequence_enrollments")
      .select(
        "id, contact_id, current_step_index, status, paused_reason, enrolled_at, collision_detected_at, collision_reviewed_at, contacts(display_name, email)"
      )
      .eq("sequence_id", sequenceId)
      .order("enrolled_at", { ascending: false })
      .limit(200),
    listConnectedAiProviders(workspace.id, supabase),
  ]);

  const rows: EnrollmentRow[] = (enrollments ?? []).map((e) => {
    const contact = e.contacts as { display_name: string | null; email: string | null } | null;
    return {
      id: e.id,
      contactId: e.contact_id,
      contactName: contact?.display_name || contact?.email || "Contacto sin nombre",
      currentStepIndex: e.current_step_index,
      status: e.status as SequenceEnrollmentStatus,
      pausedReason: e.paused_reason,
      enrolledAt: e.enrolled_at,
      hasOpenCollision: Boolean(e.collision_detected_at) && !e.collision_reviewed_at,
    };
  });

  return (
    <div className="flex h-full flex-col">
      <SequenceEditor
        sequence={{
          id: sequence.id,
          name: sequence.name,
          description: sequence.description,
          status: sequence.status,
          steps: (sequence.steps as unknown as SequenceStep[]) || [],
        }}
        canEdit={canEdit}
        aiProviders={aiProviders}
      />
      <div className="border-t border-border">
        <EnrollmentList enrollments={rows} canManage={canEdit} />
      </div>
    </div>
  );
}
