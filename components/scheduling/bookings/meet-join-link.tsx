"use client";

/**
 * El iconito para entrar al Meet de una reunion desde el calendario, la lista o
 * el tablero, sin abrir el panel. Va AL LADO de la tarjeta (nunca adentro de su
 * boton) y frena el clic para que no abra la reunion.
 */

import { Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/scheduling/types";
import { canJoinMeet, meetJoinHref } from "@/lib/scheduling/meet-link";

export function MeetJoinLink({ meetUrl, status, className }: { meetUrl: string | null; status: BookingStatus; className?: string }) {
  const href = meetJoinHref(meetUrl);
  if (!href || !canJoinMeet({ meetUrl, status })) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Unirse a Meet"
      aria-label="Unirse a Meet"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-card text-primary-ink hover:bg-accent",
        className,
      )}
    >
      <Video className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}
