"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { getContractPdfUrl } from "@/lib/actions/forms/contracts";

/**
 * "Ver PDF" de un contrato firmado: el mismo link firmado de 60 segundos y el mismo control de permisos que el
 * detalle de la respuesta (la acción vuelve a comprobar `forms.view` y que quien pide vea la respuesta).
 */
export function FormPdfButton({ submissionId }: { submissionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    start(async () => {
      const result = await getContractPdfUrl({ submissionId });
      if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
      else setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={open} disabled={pending} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium hover:bg-accent disabled:opacity-60">
        {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        Ver PDF
      </button>
      {error && (
        <span role="alert" className="mt-0.5 text-[11px] text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
