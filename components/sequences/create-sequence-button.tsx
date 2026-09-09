"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { createSequence } from "@/lib/actions/sequences";
import { ActionError } from "@/components/contacts/ui";

export function CreateSequenceButton({ label }: { label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function handleCreate() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);

    try {
      const result = await createSequence("Secuencia sin nombre");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.sequenceId) router.push(`/dashboard/sequences/${result.sequenceId}`);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleCreate}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {label ?? "Nueva secuencia"}
      </button>
      <ActionError message={error} />
    </div>
  );
}
