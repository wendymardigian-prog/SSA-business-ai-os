import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { CreateSequenceButton } from "@/components/sequences/create-sequence-button";
import { sequenceStatusStyle, stepCountLabel } from "@/lib/sequences/labels";
import { formatDateTime } from "@/components/contacts/ui";

export default async function SequencesPage() {
  const { workspace, supabase, role } = await getWorkspace();
  const canEdit = isAdminRole(role);

  const { data: sequences, error } = await supabase
    .from("sequences")
    .select("id, name, description, status, steps, updated_at")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  if (error) console.error("[sequences] listado fallido:", error.message);

  const sequenceIds = (sequences ?? []).map((s) => s.id);
  const enrolled: Record<string, number> = {};

  if (sequenceIds.length > 0) {
    const { data: counts } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id")
      .in("sequence_id", sequenceIds)
      .eq("status", "active");

    for (const row of counts ?? []) {
      enrolled[row.sequence_id] = (enrolled[row.sequence_id] ?? 0) + 1;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Secuencias</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Seguimientos que corren solos y se pausan apenas el contacto responde
            </p>
          </div>
          {canEdit && <CreateSequenceButton />}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {!sequences || sequences.length === 0 ? (
          <div className="mt-12 rounded-xl border border-dashed border-border p-12 text-center">
            <ListOrdered className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h2 className="mt-4 text-lg font-semibold">Todavía no hay secuencias</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {canEdit
                ? "Una secuencia es un seguimiento que se manda solo: un mensaje, una espera, otro mensaje. Si el contacto responde, se frena."
                : "Cuando un Owner o Admin cree la primera, la vas a ver acá."}
            </p>
            {canEdit && (
              <div className="mt-4 flex justify-center">
                <CreateSequenceButton label="Crear la primera" />
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sequences.map((sequence) => {
              const status = sequenceStatusStyle(sequence.status);
              const stepCount = Array.isArray(sequence.steps) ? sequence.steps.length : 0;
              const active = enrolled[sequence.id] ?? 0;

              return (
                <Link
                  key={sequence.id}
                  href={`/dashboard/sequences/${sequence.id}`}
                  className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <ListOrdered className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium transition-colors group-hover:text-primary">
                          {sequence.name}
                        </h3>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${status.classes}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {stepCountLabel(stepCount)}
                        {active > 0 && <span className="ml-2">{active} en curso</span>}
                      </p>
                    </div>
                  </div>

                  {sequence.description && (
                    <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                      {sequence.description}
                    </p>
                  )}

                  <p className="mt-4 text-xs text-muted-foreground">
                    Editada el {formatDateTime(sequence.updated_at)}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
