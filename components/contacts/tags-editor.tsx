"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus } from "lucide-react";
import { createAndAssignTag, setContactTags } from "@/lib/actions/contacts";
import { ActionError, TagChip } from "./ui";

export interface TagOption {
  id: string;
  name: string;
  color: string | null;
}

/** Tags del contacto: se agregan de una lista y se quitan con la X. */
export function TagsEditor({
  contactId,
  allTags,
  assignedIds,
}: {
  contactId: string;
  allTags: TagOption[];
  assignedIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const assigned = allTags.filter((t) => assignedIds.includes(t.id));
  const available = allTags.filter((t) => !assignedIds.includes(t.id));

  /** Crea el tag si no existe y lo asigna, en un paso. */
  function createTag() {
    const name = draft.trim();
    if (!name || pending) return;

    start(async () => {
      const result = await createAndAssignTag(contactId, name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setDraft("");
      router.refresh();
    });
  }

  function apply(next: string[]) {
    start(async () => {
      const result = await setContactTags(contactId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {assigned.map((tag) => (
          <span key={tag.id} className="inline-flex items-center gap-1">
            <TagChip name={tag.name} color={tag.color} />
            <button
              onClick={() => apply(assignedIds.filter((id) => id !== tag.id))}
              disabled={pending}
              aria-label={`Quitar el tag ${tag.name}`}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* El boton esta siempre, tambien cuando el workspace no tiene ningun
            tag: es desde aca que se crea el primero. */}
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Agregar
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
          <div className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createTag();
                }
              }}
              placeholder="Escribí un tag nuevo..."
              aria-label="Nombre del tag nuevo"
              maxLength={40}
              className="flex-1 rounded-lg border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={createTag}
              disabled={pending || !draft.trim()}
              className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Crear
            </button>
          </div>

          {available.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {available.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => apply([...assignedIds, tag.id])}
                  disabled={pending}
                  className="transition-opacity hover:opacity-70 disabled:opacity-50"
                >
                  <TagChip name={tag.name} color={tag.color} />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              {allTags.length === 0
                ? "El workspace todavía no tiene tags. El que crees queda disponible para todos."
                : "Este contacto ya tiene todos los tags del workspace."}
            </p>
          )}
        </div>
      )}

      <ActionError message={error} />
    </div>
  );
}
