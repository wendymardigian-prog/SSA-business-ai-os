"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { getDocumentSignedUrl } from "@/lib/actions/knowledge";

/**
 * Descarga el archivo original.
 *
 * El bucket es privado, asi que no hay una URL fija que poner en un href: se
 * pide una firmada al servidor —que verifica el rol y que el documento sea de
 * este workspace— y recien ahi se abre. El link dura un minuto.
 */
export function DownloadOriginalButton({
  documentId,
  filename,
}: {
  documentId: string;
  filename: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    startTransition(async () => {
      const result = await getDocumentSignedUrl(documentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        Descargar original
      </button>
      <p className="mt-1 max-w-[16rem] truncate text-xs text-muted-foreground" title={filename}>
        {filename}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
