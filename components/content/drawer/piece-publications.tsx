"use client";

import { AlertTriangle, CheckCircle2, Clock, ExternalLink, XCircle } from "lucide-react";
import { networkRows, type PublicationSummary } from "@/lib/content/detail";
import { NetworkBadge } from "../network-badge";

/**
 * Como le fue a cada red (F36), dentro del drawer de la pieza.
 *
 * Aparece cuando alguna red tiene una publicacion viva. "No salio" va con el
 * motivo al lado, y no con un codigo: quien mira quiere saber si tiene que
 * hacer algo, no depurar una API. El rendimiento por red (F102) esta justo debajo, en `piece-performance.tsx`.
 */

const TONE_ICON = {
  ok: CheckCircle2,
  pending: Clock,
  error: XCircle,
  muted: Clock,
} as const;

const TONE_CLASS = {
  ok: "text-emerald-600 dark:text-emerald-400",
  pending: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  muted: "text-muted-foreground",
} as const;

export function PiecePublications({
  publications,
  timeZone,
  canPublish,
  reviewNote,
}: {
  publications: PublicationSummary[];
  timeZone: string;
  canPublish: boolean;
  /** El comentario con el que la devolvieron, si la devolvieron. */
  reviewNote: string | null;
}) {
  const rows = networkRows(
    publications.filter((p) => p.status && p.status !== "cancelled"),
    { timeZone, canPublish },
  );

  return (
    <div className="space-y-3">
      {reviewNote && (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-medium">Te la devolvieron</p>
            <p className="text-muted-foreground">{reviewNote}</p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <section aria-labelledby="estado-por-red">
          <h2 id="estado-por-red" className="text-sm font-semibold">
            Estado por red
          </h2>
          <ul className="mt-2 divide-y rounded-lg border border-border">
            {rows.map((row) => {
              const Icon = TONE_ICON[row.tone];
              return (
                <li key={row.platform} className="flex items-start gap-3 p-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_CLASS[row.tone]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <NetworkBadge platform={row.platform} />
                    <p className="text-xs text-muted-foreground">{row.state}</p>
                    {row.note && <p className="mt-1 text-xs text-destructive">{row.note}</p>}
                  </div>
                  {row.url && (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Ver <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
