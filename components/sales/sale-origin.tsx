import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";
import { AssigneeAvatar } from "@/components/content/assignee-avatar";
import { ChannelChip } from "@/components/sales/channel-chip";
import type { SaleAttributionViewModel } from "@/lib/sales/attribution-view";
import { shortDayMonth } from "@/lib/sales/touch-label";

/**
 * «De dónde vino» en la ficha de una venta (Extra I, F49): el canal y, según el toque, la pieza con su responsable, el
 * anuncio con su camino, quién refirió o «Sin origen identificado». No decide nada: pinta el modelo que arma
 * `saleAttributionView`. «Cambiar» solo aparece para quien puede editar la venta.
 */
export function SaleOrigin({ view, timeZone, onChange }: { view: SaleAttributionViewModel; timeZone: string; onChange?: () => void }) {
  const day = view.occurredAt ? shortDayMonth(view.occurredAt, timeZone) : null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {view.channel ? <ChannelChip channel={view.channel} /> : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{view.channelLabel}</span>}
        {day && <span className="text-xs text-muted-foreground">Toque del {day}</span>}
        {onChange && (
          <button type="button" onClick={onChange} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent">
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Cambiar
          </button>
        )}
      </div>

      {view.unidentified && (
        <div>
          <p className="font-medium">Sin origen identificado</p>
          {view.note && <p className="mt-0.5 text-xs text-muted-foreground">{view.note}</p>}
        </div>
      )}

      {view.piece && (
        <div className="space-y-2">
          <p className="min-w-0 break-words">
            {view.piece.href && view.piece.title ? (
              <Link href={view.piece.href} className="font-medium underline-offset-2 hover:underline">
                {view.piece.title}
              </Link>
            ) : (
              <span className="font-medium">{view.piece.title ?? "Pieza sin identificar"}</span>
            )}
            {view.piece.network && <span className="text-muted-foreground"> · {view.piece.network}</span>}
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AssigneeAvatar assignee={view.piece.responsible} size="sm" />
            {view.piece.responsible ? <span>Responsable: {view.piece.responsible.name}</span> : <span>Sin responsable</span>}
          </p>
        </div>
      )}

      {view.ad && (
        <div className="flex items-start gap-3">
          {view.ad.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage con vencimiento: next/image no la puede optimizar.
            <img src={view.ad.thumbnailUrl} alt="" className="h-12 w-12 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
          )}
          <div className="min-w-0 space-y-0.5">
            {view.ad.path.length > 0 ? (
              <p className="break-words font-medium">{view.ad.path.join(" › ")}</p>
            ) : (
              <p className="font-medium">Anuncio sin identificar</p>
            )}
            {view.note && <p className="text-xs text-muted-foreground">{view.note}</p>}
            {view.ad.href && (
              <Link href={view.ad.href} className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
                Ver el anuncio <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      )}

      {view.channel === "referral" && (
        <p className="break-words">
          {view.referrer?.name ? (
            <>
              Lo recomendó{" "}
              {view.referrer.href ? (
                <Link href={view.referrer.href} className="font-medium underline-offset-2 hover:underline">
                  {view.referrer.name}
                </Link>
              ) : (
                <span className="font-medium">{view.referrer.name}</span>
              )}
              {view.referrer.kind === "member" && <span className="text-muted-foreground"> (del equipo)</span>}
            </>
          ) : (
            <span className="text-muted-foreground">No se sabe quién lo recomendó.</span>
          )}
        </p>
      )}
    </div>
  );
}
