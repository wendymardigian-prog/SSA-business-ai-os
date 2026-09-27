"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, XCircle } from "lucide-react";
import {
  approvePost,
  archivePost,
  requestReview,
  retryFailedNetworks,
  returnPost,
} from "@/lib/actions/content-review";
import { scheduleNetworks } from "@/lib/actions/content-schedule";
import { platformLabel } from "@/lib/platforms";
import {
  detailActions,
  detailHeadline,
  networkRows,
  type DetailAction,
  type PublicationSummary,
} from "@/lib/content/detail";
import type { ContentPermissions } from "@/lib/content/status";
import type { ContentPostStatus } from "@/lib/types/database";
import { NetworkBadge } from "./network-badge";

/**
 * El detalle de una pieza (F36, F37).
 *
 * Una fila por red con como quedo, y los botones que de verdad se pueden
 * apretar. Devolver abre un cuadro con el comentario obligatorio: sin motivo,
 * quien la escribio no sabe que cambiar.
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

export function PostDetail({
  postId,
  title,
  status,
  caption,
  reviewNote,
  perms,
  publications,
  timeZone,
}: {
  postId: string;
  title: string;
  status: ContentPostStatus;
  caption: string | null;
  reviewNote: string | null;
  perms: ContentPermissions;
  publications: PublicationSummary[];
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");

  const rows = networkRows(publications, { timeZone, canPublish: perms.publish });
  const actions = detailActions({ perms, status, publications });

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "No se pudo");
        return;
      }
      if (done) setNotice(done);
      router.refresh();
    });
  }

  function onAction(action: DetailAction["action"]) {
    switch (action) {
      case "edit":
        router.push(`/dashboard/content/${postId}/edit`);
        return;
      case "request_review":
        run(() => requestReview({ postId }), "La mandaste a revision.");
        return;
      case "approve":
        run(() => approvePost({ postId }), "Aprobada.");
        return;
      case "return":
        setReturning(true);
        return;
      case "schedule":
        run(() => scheduleNetworks({ postId }), "Programada.");
        return;
      case "retry_all":
        run(() => retryFailedNetworks({ postId }), "Reintentando.");
        return;
      case "archive":
        // Antes mandaba al editor y el editor contestaba "eso se hace desde
        // el detalle": un circulo del que no se salia (C5, C16).
        if (!window.confirm("¿Archivar esta pieza? Sale del tablero y queda en el historial.")) {
          return;
        }
        run(async () => {
          const result = await archivePost({ postId });
          if (result.ok) router.push("/dashboard/content");
          return result;
        }, "Archivada.");
        return;
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{detailHeadline({ status, publications })}</p>
      </header>

      {reviewNote && (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-medium">Te la devolvieron</p>
            <p className="text-muted-foreground">{reviewNote}</p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <section aria-labelledby="redes">
        <h3 id="redes" className="text-sm font-semibold">
          Redes
        </h3>

        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Todavia no hay ninguna red programada para esta pieza.
          </p>
        ) : (
          <ul className="mt-2 divide-y rounded-lg border">
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
        )}
      </section>

      {caption && (
        <section aria-labelledby="caption">
          <h3 id="caption" className="text-sm font-semibold">
            Caption
          </h3>
          <p className="mt-2 whitespace-pre-wrap rounded-lg border p-3 text-sm">{caption}</p>
        </section>
      )}

      {returning && (
        <div className="space-y-2 rounded-lg border p-3">
          <label htmlFor="devolver" className="text-sm font-medium">
            Que hay que cambiar
          </label>
          <textarea
            id="devolver"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg border bg-background p-2 text-sm"
            placeholder="El hook no engancha, probá empezar por el resultado."
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => returnPost({ postId, comment }), "La devolviste a produccion.")
              }
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              Devolver
            </button>
            <button
              type="button"
              onClick={() => setReturning(false)}
              className="rounded-lg border px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.action}
            type="button"
            disabled={pending}
            onClick={() => onAction(action.action)}
            className={
              action.tone === "primary"
                ? "rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                : action.tone === "danger"
                  ? "rounded-lg border border-destructive/40 px-3 py-1.5 text-sm text-destructive disabled:opacity-50"
                  : "rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
            }
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
