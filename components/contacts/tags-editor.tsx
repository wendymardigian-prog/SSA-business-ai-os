"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus } from "lucide-react";
import { setContactTags } from "@/lib/actions/contacts";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const assigned = allTags.filter((t) => assignedIds.includes(t.id));
  const available = allTags.filter((t) => !assignedIds.includes(t.id));

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

        {available.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Agregar
          </button>
        )}
      </div>

      {assigned.length === 0 && available.length === 0 && (
        <p className="text-sm text-muted-foreground/70">
          Todavía no hay tags en el workspace.
        </p>
      )}

      {open && available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border p-2">
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
      )}

      <ActionError message={error} />
    </div>
  );
}
