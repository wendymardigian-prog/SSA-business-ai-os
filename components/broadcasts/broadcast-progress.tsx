"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pause, Play, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BroadcastRecipientStatus, BroadcastStatus } from "@/lib/types/database";
import { BROADCAST_STATUS, RECIPIENT_STATUS, TONE_CLASS, formatEta } from "@/lib/broadcasts/status";
import { describePolicy, estimateFinish, type SendPolicy } from "@/lib/send-queue/pace";
import { cancelBroadcastAction, deleteBroadcastAction, pauseBroadcastAction, resumeBroadcastAction, resumeLaneAction } from "@/lib/actions/broadcasts";
import { canDeleteBroadcast } from "@/lib/broadcasts/list";
import { EMAIL_RESULT_FILTERS, emailResultTiles, type EmailResultCounts, type EmailResultFilter } from "@/lib/broadcasts/email-results-view";

/**
 * Un broadcast que ya salió de borrador: cuánto falta, cuándo termina, y cada
 * destinatario con su estado (y por qué se salteó o falló). Mientras se envía,
 * se refresca solo cada 15 segundos (lo que tarda un tic de la cola).
 */

export interface ProgressRecipient {
  id: string;
  contactId: string;
  name: string;
  target: string | null;
  status: BroadcastRecipientStatus;
  reason: string | null;
  sentAt: string | null;
  conversationId: string | null;
  /** Lo que paso con SU email (A9): entregado, abrio, clic, rebote, spam, baja. Vacio en WhatsApp. */
  emailBadges?: string[];
}

export function BroadcastProgress({
  broadcast,
  channel,
  policy,
  lane,
  counts,
  emailResults = null,
  deferredCount = null,
  emailFilter = "",
  recipients,
  filter,
  page,
  pageCount,
  timeZone,
  businessTimeZone,
}: {
  broadcast: { id: string; name: string; status: BroadcastStatus; scheduledFor: string | null; startedAt: string | null; completedAt: string | null; previewText: string };
  channel: { id: string; label: string } | null;
  policy: SendPolicy | null;
  lane: { pausedReason: string | null; paused: boolean } | null;
  counts: Record<BroadcastRecipientStatus, number>;
  /** Los resultados por email (A9, 00287). Null en WhatsApp o si no se pudieron leer. */
  emailResults?: EmailResultCounts | null;
  /** Cuantos esperan el tope del dia o la pausa del marketing. */
  deferredCount?: number | null;
  emailFilter?: EmailResultFilter | "";
  recipients: ProgressRecipient[];
  filter: BroadcastRecipientStatus | "";
  page: number;
  pageCount: number;
  timeZone: string;
  /** La de la cola (horario permitido y tope por dia): solo para estimar cuando termina. */
  businessTimeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = BROADCAST_STATUS[broadcast.status];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const open = counts.pending + counts.sending;
  const live = broadcast.status === "sending" || broadcast.status === "scheduled";
  // Lo que esta saliendo cuenta como enviado: la base tampoco lo deja borrar.
  const deletable = canDeleteBroadcast({ status: broadcast.status, sent: counts.sent + counts.sending, failed: counts.failed });

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("¿Eliminar este broadcast? No salió ningún mensaje: se borra junto con su cola y no se puede deshacer.")) return;
    setError(null);
    start(async () => {
      const res = await deleteBroadcastAction(broadcast.id);
      if (res.ok) router.push("/dashboard/broadcasts");
      else setError(res.error);
    });
  }

  const eta = policy && open > 0 && broadcast.status !== "paused" && broadcast.status !== "cancelled" ? estimateFinish(open, policy, new Date(), businessTimeZone) : null;
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  const href = (next: { estado?: string; pag?: number; email?: string }) => {
    const qs = new URLSearchParams();
    const estado = next.estado ?? filter;
    if (estado) qs.set("estado", estado);
    const email = next.email ?? emailFilter;
    if (email) qs.set("email", email);
    const pag = next.pag ?? 1;
    if (pag > 1) qs.set("pag", String(pag));
    const s = qs.toString();
    return `/dashboard/broadcasts/${broadcast.id}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{broadcast.name}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[status.tone])}>{status.label}</span>
        {(broadcast.status === "sending" || broadcast.status === "scheduled") && (
          <button type="button" disabled={pending} onClick={() => run(() => pauseBroadcastAction(broadcast.id))} className={btn}>
            <Pause className="h-4 w-4" aria-hidden /> Pausar
          </button>
        )}
        {broadcast.status === "paused" && (
          <button type="button" disabled={pending} onClick={() => run(() => resumeBroadcastAction(broadcast.id))} className={btn}>
            <Play className="h-4 w-4" aria-hidden /> Reanudar
          </button>
        )}
        {(broadcast.status === "sending" || broadcast.status === "scheduled" || broadcast.status === "paused") && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => cancelBroadcastAction(broadcast.id), "¿Cancelar el broadcast? Lo que ya salió no se puede deshacer; lo que falta no se manda.")}
            className={cn(btn, "text-red-700 dark:text-red-400")}
          >
            <XCircle className="h-4 w-4" aria-hidden /> Cancelar
          </button>
        )}
        {deletable && (
          <button type="button" disabled={pending} onClick={remove} className={cn(btn, "text-red-700 dark:text-red-400")}>
            <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
          </button>
        )}
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {lane?.paused && live && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Los envíos por este canal están pausados.</p>
            {lane.pausedReason && <p className="text-amber-900 dark:text-amber-200">{lane.pausedReason}</p>}
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Revisá que el número esté conectado en Canales antes de reanudar.</p>
          </div>
          {channel && (
            <button type="button" disabled={pending} onClick={() => run(() => resumeLaneAction(channel.id))} className={btn}>
              Reanudar envíos
            </button>
          )}
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4 md:p-5">
        <p className="text-sm text-muted-foreground">
          {channel?.label ?? "Canal desconectado"}
          {broadcast.status === "scheduled" && broadcast.scheduledFor && <> · empieza el {formatEta(new Date(broadcast.scheduledFor), timeZone)}</>}
          {broadcast.completedAt && <> · terminó el {formatEta(new Date(broadcast.completedAt), timeZone)}</>}
        </p>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="bg-green-500" style={{ width: pct(counts.sent) }} />
          <div className="bg-red-500" style={{ width: pct(counts.failed) }} />
          <div className="bg-muted-foreground/40" style={{ width: pct(counts.skipped + counts.cancelled) }} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Count label="Enviados" value={counts.sent} />
          <Count label="En cola" value={open} />
          <Count label="Fallidos" value={counts.failed} />
          <Count label="Salteados" value={counts.skipped} />
          <Count label="Cancelados" value={counts.cancelled} />
        </dl>
        {deferredCount !== null && deferredCount > 0 && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
            <strong>{deferredCount.toLocaleString("es")}</strong> esperan el máximo de emails de marketing del día (o la pausa del freno): salen
            solos, en orden, cuando haya lugar. No es un error.
          </p>
        )}
        {policy && <p className="text-xs text-muted-foreground">Ritmo: {describePolicy(policy)}</p>}
        {eta && (
          <p className="text-sm">
            A este ritmo terminaría aprox. el <strong>{formatEta(eta, timeZone)}</strong>.
          </p>
        )}
        {broadcast.previewText && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Ver el mensaje</summary>
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-background p-3">{broadcast.previewText}</p>
          </details>
        )}
      </section>

      {emailResults && (
        <section aria-labelledby="bc-email-results" className="space-y-3 rounded-xl border border-border bg-card p-4 md:p-5">
          <h2 id="bc-email-results" className="text-sm font-semibold">
            Resultados del email
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {emailResultTiles(emailResults).map((t) => (
              <div key={t.key}>
                <dt className="text-xs text-muted-foreground" title={t.hint}>
                  {t.label}
                  {t.hint ? " *" : ""}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {t.value.toLocaleString("es")} <span className="text-xs font-normal text-muted-foreground">{t.rate}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-muted-foreground">
            Sobre {emailResults.sent.toLocaleString("es")} enviados. * Las aperturas son aproximadas: dependen de que el correo de la persona cargue las
            imágenes. Los resultados llegan por el webhook de Resend.
          </p>
        </section>
      )}

      <section className="space-y-2">
        {emailResults && (
          <nav aria-label="Filtrar por lo que pasó con el email" className="flex flex-wrap gap-1.5">
            {([["", "Cualquier resultado"], ...(Object.entries(EMAIL_RESULT_FILTERS).map(([k, v]) => [k, v.label]))] as Array<[string, string]>).map(([value, label]) => (
              <Link
                key={value || "any"}
                href={href({ email: value, pag: 1 })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  emailFilter === value ? "border-primary-edge bg-primary/10 font-medium" : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
        <nav aria-label="Filtrar destinatarios" className="flex flex-wrap gap-1.5">
          {([["", "Todos", total], ...(["sent", "pending", "failed", "skipped", "cancelled"] as const).map((s) => [s, RECIPIENT_STATUS[s], s === "pending" ? open : counts[s]] as const)] as const).map(
            ([value, label, n]) => (
              <Link
                key={value || "all"}
                href={href({ estado: value, pag: 1 })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  filter === value ? "border-primary-edge bg-primary/10 font-medium" : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {label} · {n}
              </Link>
            ),
          )}
        </nav>
        {recipients.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay destinatarios con este estado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {recipients.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <Link href={`/dashboard/contacts/${r.contactId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {r.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground sm:w-44">{r.target ?? "—"}</span>
                <span className="text-xs sm:w-56">
                  {RECIPIENT_STATUS[r.status]}
                  {r.reason && <span className="text-muted-foreground"> · {r.reason}</span>}
                  {r.status === "sent" && r.sentAt && <span className="text-muted-foreground"> · {formatEta(new Date(r.sentAt), timeZone)}</span>}
                  {r.emailBadges && r.emailBadges.length > 0 && <span className="block text-muted-foreground">{r.emailBadges.join(" · ")}</span>}
                </span>
                {r.conversationId ? (
                  <Link href={`/dashboard/inbox?c=${r.conversationId}`} className="text-xs font-medium text-primary-ink hover:underline">
                    Ver chat
                  </Link>
                ) : (
                  <span className="w-[52px]" />
                )}
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between text-sm">
            {page > 1 ? <Link href={href({ pag: page - 1 })} className={btn}>Anterior</Link> : <span />}
            <span className="text-xs text-muted-foreground">
              Página {page} de {pageCount}
            </span>
            {page < pageCount ? <Link href={href({ pag: page + 1 })} className={btn}>Siguiente</Link> : <span />}
          </div>
        )}
      </section>
    </div>
  );
}

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50";

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value.toLocaleString("es")}</dd>
    </div>
  );
}
