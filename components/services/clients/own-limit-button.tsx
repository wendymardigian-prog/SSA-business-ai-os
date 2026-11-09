"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOwnAssistantLimit } from "@/lib/actions/tutor";

/** «Límite propio» del asistente para este estudiante (tutor.manage). Vacío = vuelve al de su variante o del programa. */
export function OwnLimitButton({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const raw = prompt("Límite propio por mes, en dólares (vacío para volver al del programa):");
          if (raw === null) return;
          const value = raw.trim() === "" ? null : Number(raw.replace(",", "."));
          start(async () => {
            setError(null);
            const r = await setOwnAssistantLimit(serviceId, value);
            if (!r.ok) return setError(r.error.message);
            router.refresh();
          });
        }}
        className="text-xs text-primary-ink hover:underline"
      >
        Límite propio
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
