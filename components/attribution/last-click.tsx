"use client";

import Link from "next/link";
import { Megaphone, MousePointerClick, Sprout } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { formatDateTime } from "@/components/contacts/ui";
import { ChannelChip } from "@/components/shared/channel-chip";
import { Tip } from "@/components/ui/tooltip";
import type { BookingTouchView } from "@/lib/attribution/last-touches";
import { pieceHref } from "@/lib/contacts/attribution-view";
import { cn } from "@/lib/utils";

/**
 * «Último click» de una reunión: el toque más reciente del contacto antes de agendar, sea pauta u orgánico.
 *
 * - En la lista: una celda con el canal y el nombre del anuncio, la pieza o de dónde vino. Al pasar el mouse
 *   (o con el foco) se ve el preview (la miniatura del anuncio) y los últimos 3 toques.
 * - En el panel de la reunión: `LastClicksBlock`, lo mismo abierto y con links a la pieza.
 *
 * Todo lo que llega ya viene resuelto (`BookingTouchView`): nada se calcula acá. Sin toques es «—», nunca un 0.
 */

const KIND_ICONS = { ad: Megaphone, piece: Sprout, other: MousePointerClick } as const;

/** La miniatura del anuncio, o un ícono si no hay (sin permiso para ver anuncios, o todavía no se bajó). */
function Preview({ touch, size }: { touch: BookingTouchView; size: number }) {
  const Icon = KIND_ICONS[touch.kind];
  if (touch.thumbnailUrl) {
    // Es una URL firmada de nuestro Storage: no pasa por el optimizador de imágenes (está apagado).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={touch.thumbnailUrl} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-md border border-border object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground" style={{ width: size, height: size }} aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** «10 nov 2026, 07:01 p. m.» · Mensaje directo */
function metaLine(touch: BookingTouchView, timeZone: string): string {
  return [formatDateTime(touch.at, timeZone), touch.originLabel, touch.sourceLine].filter(Boolean).join(" · ");
}

/** Lo que se ve al pasar el mouse por la celda de la lista. */
function HoverCard({ touches }: { touches: readonly BookingTouchView[] }) {
  const timeZone = useViewerTimezone();
  const [last, ...earlier] = touches;
  return (
    <span className="block w-72 space-y-2">
      <span className="flex items-start gap-2.5">
        <Preview touch={last} size={64} />
        <span className="min-w-0 space-y-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Último click</span>
            <ChannelChip channel={last.channel} />
          </span>
          <span className="block break-words font-medium leading-snug">{last.title}</span>
          <span className="block text-muted-foreground">{metaLine(last, timeZone)}</span>
        </span>
      </span>
      {earlier.length > 0 && (
        <span className="block border-t border-border pt-2">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Antes</span>
          <span className="block space-y-1.5">
            {earlier.map((t) => (
              <span key={t.id} className="flex items-start gap-2">
                <ChannelChip channel={t.channel} className="mt-px" />
                <span className="min-w-0">
                  <span className="block truncate">{t.title}</span>
                  <span className="block text-muted-foreground">{metaLine(t, timeZone)}</span>
                </span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** La celda de la columna «Último click» de la lista de Agenda. */
export function LastClickCell({ touches, className }: { touches: readonly BookingTouchView[] | undefined; className?: string }) {
  const last = touches?.[0];
  if (!touches || !last) return <td className={cn("px-3 py-2 text-muted-foreground", className)}>—</td>;
  return (
    <td className={cn("max-w-[18rem] px-3 py-2", className)}>
      <Tip content={<HoverCard touches={touches} />} align="start" className="max-w-full">
        <span tabIndex={0} className="flex min-w-0 max-w-full items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChannelChip channel={last.channel} />
          <span className="min-w-0 truncate">{last.title}</span>
        </span>
      </Tip>
    </td>
  );
}

/** Una fila del panel: la miniatura, el canal, el nombre (con link a la pieza si la hay) y cuándo y por dónde entró. */
function TouchRowView({ touch, timeZone, featured }: { touch: BookingTouchView; timeZone: string; featured?: boolean }) {
  const title = touch.pieceId ? (
    <Link href={pieceHref(touch.pieceId)} className="break-words font-medium underline-offset-2 hover:underline">
      {touch.title}
    </Link>
  ) : (
    <span className="break-words font-medium">{touch.title}</span>
  );
  return (
    <div className="flex items-start gap-2.5">
      <Preview touch={touch} size={featured ? 48 : 32} />
      <div className="min-w-0 space-y-0.5 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChannelChip channel={touch.channel} />
          {title}
        </div>
        <p className="text-xs text-muted-foreground">{metaLine(touch, timeZone)}</p>
      </div>
    </div>
  );
}

/** El bloque del panel lateral de la reunión: el último click, y debajo los anteriores. */
export function LastClicksBlock({ touches, contactId }: { touches: readonly BookingTouchView[]; contactId?: string | null }) {
  const timeZone = useViewerTimezone();
  const [last, ...earlier] = touches;
  if (!last) {
    return (
      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Último click</h4>
        <p className="text-sm text-muted-foreground">Todavía no hay ningún click registrado antes de agendar.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Último click antes de agendar</h4>
        <TouchRowView touch={last} timeZone={timeZone} featured />
      </div>
      {earlier.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Antes</h4>
          {earlier.map((t) => (
            <TouchRowView key={t.id} touch={t} timeZone={timeZone} />
          ))}
        </div>
      )}
      {contactId && (
        <Link href={`/dashboard/contacts/${contactId}/toques`} className="inline-block text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Ver todos los toques del contacto
        </Link>
      )}
    </div>
  );
}
