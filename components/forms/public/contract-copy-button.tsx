"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

const RETRY_MS = 2000;
const MAX_TRIES = 15;

/**
 * "Descargar contrato" en la pantalla de éxito. El PDF se arma unos segundos después de firmar: si todavía no está
 * (202), el botón dice "Preparando tu copia…" y vuelve a preguntar solo. El link sirve 24 horas
 * (`lib/forms/contract/copy-link.ts`).
 */
export function ContractCopyButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "waiting" | "error">("idle");

  async function download() {
    setState("waiting");
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.status === 200) {
          const blob = await response.blob();
          const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "contrato-firmado.pdf";
          const href = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = href;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(href), 10_000);
          setState("idle");
          return;
        }
        if (response.status !== 202) break;
      } catch {
        // Un corte de red: se vuelve a probar.
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    setState("error");
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={download}
        disabled={state === "waiting"}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-70"
      >
        {state === "waiting" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        {state === "waiting" ? "Preparando tu copia…" : "Descargar contrato"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-xs text-muted-foreground">
          No pudimos bajar la copia ahora. Te llega por correo; si no, probá de nuevo en unos minutos.
        </p>
      )}
    </div>
  );
}
