"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { linkServiceCalls } from "@/lib/actions/calls-service";
import { MEETING_STATE_LABEL, recentMeetings, type MeetingRow, type MeetingState } from "@/lib/services/screens/service-meetings";
import { cn } from "@/lib/utils";

/**
 * El bloque «Reuniones» de la ficha del servicio (Servicios A4, F137). Escritorio: tabla de 5 columnas (Fecha, Tipo,
 * Anfitrión, Estado, Nota); teléfono: tarjetas. Los estados con color y texto, nunca solo color.
 */

const STATE_CLASS: Record<MeetingState, string> = {
  scheduled: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  missing_recording: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  no_show: "bg-muted text-muted-foreground",
  recorded: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  analyzed: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground line-through",
};

function hrefOf(r: MeetingRow): string {
  if (r.callId) return `/dashboard/llamadas/${r.callId}`;
  return `/dashboard/agenda?agenda=${r.bookingId}`;
}

export function ServiceMeetingsBlock({
  serviceId,
  rows,
  userNames,
  timeZone,
  canLink,
}: {
  serviceId: string;
  rows: MeetingRow[];
  userNames: Record<string, string>;
  timeZone: string;
  canLink: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { rows: visible, more } = recentMeetings(rows);
  const fmt = new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const link = () => {
    setMessage(null);
    start(async () => {
      const r = await linkServiceCalls({ serviceId });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setMessage(
        r.data.linked + r.data.review === 0
          ? "No había reuniones para vincular."
          : `${r.data.linked} vinculada(s)${r.data.review ? `, ${r.data.review} por revisar` : ""}.`,
      );
      router.refresh();
    });
  };

  return (
    <section aria-labelledby={`meetings-${serviceId}`} className="rounded-xl border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 id={`meetings-${serviceId}`} className="text-sm font-semibold">Reuniones</h3>
        {canLink && (
          <button
            type="button"
            onClick={link}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50 max-topbar:h-10"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
            Vincular las reuniones de este servicio
          </button>
        )}
      </header>
      {message && <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">{message}</p>}
      {visible.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">Todavía no hay reuniones de este servicio.</p>
      ) : (
        <>
          {/* Una lista y no una tabla: es un bloque chico de solo lectura dentro de la ficha (sin columnas que ajustar). */}
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.key}>
                <Link href={hrefOf(r)} className="block px-3 py-3 hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{fmt.format(new Date(r.at))}</span>
                    {r.score !== null && <span className="text-sm tabular-nums">{r.score}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{r.typeLabel}{r.hostUserId && userNames[r.hostUserId] ? ` · ${userNames[r.hostUserId]}` : ""}</p>
                  <div className="mt-1"><StateChips row={r} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {more && (
        <div className="border-t border-border px-3 py-2 text-right">
          <Link href={`/dashboard/llamadas?servicio=${serviceId}`} className="text-xs font-medium text-primary-ink hover:underline">Ver todas en Grabaciones</Link>
        </div>
      )}
    </section>
  );
}

function StateChips({ row }: { row: MeetingRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATE_CLASS[row.state])}>{MEETING_STATE_LABEL[row.state]}</span>
      {row.pendingProposals > 0 && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-ink">{row.pendingProposals} propuesta{row.pendingProposals === 1 ? "" : "s"} por aprobar</span>
      )}
      {row.review && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300">Por revisar</span>}
    </span>
  );
}
