"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";

export function CreateFlowButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function handleCreate() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        console.error("[flows] no se pudo crear la automatizacion");
        setError("No se pudo crear la automatización. Probá de nuevo.");
        return;
      }

      const flow = await res.json();
      router.push(`/dashboard/flows/${flow.id}`);
    } catch (err) {
      console.error("[flows] no se pudo crear la automatizacion:", err);
      setError("No se pudo crear la automatización. Probá de nuevo.");
    } finally {
      pendingRef.current = false;
      setCreating(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleCreate}
        disabled={creating}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {creating ? "Creando…" : "Nueva automatización"}
      </button>
      {error && (
        <span role="alert" className="text-xs font-medium text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
