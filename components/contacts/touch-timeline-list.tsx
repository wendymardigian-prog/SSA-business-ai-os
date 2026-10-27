"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { ChannelChip } from "@/components/shared/channel-chip";
import { EntryUrlBlock } from "@/components/attribution/entry-url-block";
import type { TimelineItem } from "@/lib/contacts/touch-timeline";
import { cn } from "@/lib/utils";

/**
 * La linea de tiempo de toques de un contacto (Extra I, F45).
 *
 * Cada fila: fecha y hora, canal, origen (mensaje directo, comentario, clic en un link, agenda, formulario, webhook,
 * alta manual), la pieza o el anuncio con su link, y las marcas Primer toque / Último toque / Último con origen. Los UTM,
 * los ids de clic y la URL de entrada van en «Ver detalle», un boton con `aria-expanded` (no un `<details>`).
 *
 * Todo lo que decide el contenido lo arma `lib/contacts/touch-timeline.ts`; esto solo lo dibuja.
 */
export function TouchTimelineList({
  items,
  timeZone,
  adHrefs,
}: {
  items: TimelineItem[];
  timeZone: string;
  /** `ad_id` -> link al detalle del anuncio. Solo trae los que quien mira puede ver (`dashboards.ads.view`). */
  adHrefs: Record<string, string>;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <TouchRow key={item.id} item={item} timeZone={timeZone} adHref={item.adId ? (adHrefs[item.adId] ?? null) : null} />
      ))}
    </ol>
  );
}

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }
}

function TouchRow({ item, timeZone, adHref }: { item: TimelineItem; timeZone: string; adHref: string | null }) {
  const [open, setOpen] = useState(false);
  const { view } = item;
  const detailId = `touch-detail-${item.id}`;
  const hasDetail = view.details.length > 0 || Boolean(view.entryUrl) || Boolean(view.matchNote);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <time dateTime={item.occurredAt} className="text-xs text-muted-foreground">
          {formatWhen(item.occurredAt, timeZone)}
        </time>
        <ChannelChip channel={item.channel} />
        <span className="text-xs font-medium">{item.originLabel}</span>
        {item.markLabels.map((label) => (
          <span key={label} className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {label}
          </span>
        ))}
      </div>

      <p className="mt-1.5 break-words text-sm">
        <span className="font-medium">{view.origin}</span>
        {view.account && <span className="text-muted-foreground" title="Cuenta por la que entró"> · {view.account}</span>}
        {view.piece && (
          <>
            <span className="text-muted-foreground"> · </span>
            {view.href ? (
              <Link href={view.href} className="underline underline-offset-2 hover:text-foreground">
                «{view.piece}»
              </Link>
            ) : (
              <span>«{view.piece}»</span>
            )}
          </>
        )}
      </p>

      {view.adLine && (
        <div className="mt-1.5 flex items-center gap-2">
          {view.adThumbnail && (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage con vencimiento: next/image no la puede optimizar.
            <img src={view.adThumbnail} alt="" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
          )}
          <p className="min-w-0 break-words text-xs text-muted-foreground">
            {adHref ? (
              <Link href={adHref} className="underline underline-offset-2 hover:text-foreground">
                {view.adLine}
              </Link>
            ) : (
              view.adLine
            )}
          </p>
        </div>
      )}

      {hasDetail && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            Ver detalle
          </button>
          {open && (
            <div id={detailId} className="mt-1.5 space-y-2">
              {view.matchNote && <p className="text-[11px] text-muted-foreground/80">{view.matchNote}</p>}
              {view.details.length > 0 && (
                <dl className="space-y-1 text-xs">
                  {view.details.map((d) => (
                    <div key={d.label} className="flex flex-wrap gap-x-2">
                      <dt className="shrink-0 text-muted-foreground">{d.label}</dt>
                      <dd className="min-w-0 break-all">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {view.entryUrl && <EntryUrlBlock url={view.entryUrl} />}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
