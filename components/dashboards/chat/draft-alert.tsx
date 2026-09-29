"use client";

import Link from "next/link";
import { Hourglass } from "lucide-react";
import { draftAlertText, type DraftsCard } from "@/lib/dashboards/chat/drafts";

/**
 * El aviso de borradores esperando (F17), arriba de todo.
 *
 * Es lo primero porque es lo unico de la pantalla que pide una accion hoy: el
 * resto son numeros para mirar. Lleva cuantos hay, cuantos estan por vencer y
 * cuantas ventanas se perdieron en la semana, que es la consecuencia de no
 * mirarlo.
 */
export function DraftAlert({ card, href }: { card: DraftsCard; href: string }) {
  const { headline, detail } = draftAlertText(card);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3.5 rounded-xl border border-warn/45 bg-warn/10 px-4 py-3"
    >
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-warn/20 text-warn">
        <Hourglass className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-[220px] flex-1">
        <b className="text-[15px] tabular-nums">{headline}</b>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {card.pendingUnder6h > 0 && (
            <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-bad align-[1px] motion-safe:animate-pulse" aria-hidden />
          )}
          {detail}
        </span>
      </span>
      <Link
        href={href}
        className="h-[34px] shrink-0 whitespace-nowrap rounded-[9px] bg-primary px-3.5 text-sm font-semibold leading-[34px] text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Ir a la cola de aprobación
      </Link>
    </div>
  );
}
