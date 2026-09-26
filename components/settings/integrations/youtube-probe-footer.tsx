"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { probeYouTubeUpload } from "@/lib/actions/youtube-probe";

/**
 * El boton que prueba la subida directa a YouTube (F38).
 *
 * Dice exactamente lo que va a hacer antes de hacerlo: sube un video de un
 * segundo a la cuenta real y lo borra. Es la unica forma de descubrir que
 * YouTube deja los videos en privado cuando el proyecto de Google no paso la
 * auditoria, y descubrirlo asi es mucho mejor que descubrirlo con un video
 * del cliente.
 */
export function YouTubeProbeFooter({ verifiedAt }: { verifiedAt: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div>
      <p className="text-sm font-medium">Probar la subida directa a YouTube</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Sube un video de un segundo como &quot;no listado&quot;, mira como quedo y lo borra. Sirve
        para saber, antes de publicar algo de verdad, si YouTube respeta la visibilidad que se pide.
      </p>

      {verifiedAt && !result && (
        <p className="mt-1 text-xs text-muted-foreground">
          Ultima prueba: {new Date(verifiedAt).toLocaleDateString("es-AR")}.
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const outcome = await probeYouTubeUpload();
            setResult(
              outcome.ok
                ? { ok: outcome.verified, message: outcome.message }
                : { ok: false, message: outcome.error },
            );
          })
        }
        className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Probar ahora
      </button>

      {result && (
        <p
          role="status"
          className={`mt-2 rounded-lg p-2 text-xs ${
            result.ok
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
