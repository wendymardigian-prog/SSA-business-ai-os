"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { ignoreTouchMeta, linkBookingToMeta, linkTouchToMeta, unlinkTouchMeta } from "@/lib/actions/meta-match";
import { metaLinkLine, type MetaLink, type MetaLinkStatus } from "@/lib/attribution/meta-link";
import { MetaLinkPicker, pickedIds } from "./meta-link-picker";

const STATUS_STYLE: Record<MetaLinkStatus, string> = {
  matched: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  manual: "border-primary-edge/40 bg-primary/10 text-primary-ink",
  unmatched: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ignored: "border-border text-muted-foreground",
  none: "border-border text-muted-foreground",
};

/**
 * El vínculo de un toque con Meta: Campaña › Conjunto › Anuncio, su estado, el motivo en palabras y, con permiso,
 * «Vincular», «Ignorar» o «Quitar». Las acciones vuelven a chequear el permiso, el workspace y que se pueda ver el contacto.
 *
 * `target` dice sobre qué actúa. Una reunión sin toque propio pasa `bookingId`: vincularla le crea el suyo.
 * `actionsOnly` deja solo los motivos y los botones, para donde el vínculo ya se ve (la ficha del contacto).
 */
export function MetaMatchControl({
  link,
  target,
  canManage,
  actionsOnly = false,
}: {
  link: MetaLink | null;
  target: { touchId: string } | { bookingId: string } | null;
  canManage: boolean;
  actionsOnly?: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const line = metaLinkLine(link);
  const status: MetaLinkStatus = link?.status ?? "none";
  const touchId = target && "touchId" in target ? target.touchId : null;

  function act(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      setPicking(false);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  // Lo heredado de un toque anterior no se cambia desde acá: vincular le da a esta reunión su propio vínculo.
  const own = !link?.inherited;
  const canUndo = own && touchId && !link?.autoIgnored && (status === "manual" || status === "ignored");
  const canIgnore = own && touchId && status === "unmatched";
  const canLink = target && status !== "ignored";

  return (
    <div className="space-y-1.5">
      {!actionsOnly &&
        (line ? (
          <p className="break-words text-sm">{line}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin campaña ni anuncio de Meta vinculados.</p>
        ))}
      {!actionsOnly && link?.statusLabel && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`rounded-full border px-2 py-0.5 font-medium ${STATUS_STYLE[status]}`}>{link.statusLabel}</span>
          {link.method && <span>{link.method}</span>}
          {link.inherited && <span>Viene de un toque anterior del contacto</span>}
        </p>
      )}
      {link?.reasons.map((reason) => (
        <p key={reason} className="text-[11px] leading-relaxed text-muted-foreground">
          {reason}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {canManage && (canLink || canUndo || canIgnore) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {canLink && (
            <button type="button" onClick={() => setPicking(true)} disabled={pending} className="h-7 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-60">
              {line && own ? "Cambiar vínculo" : "Vincular"}
            </button>
          )}
          {canIgnore && (
            <button type="button" onClick={() => act(() => ignoreTouchMeta(touchId))} disabled={pending} className="h-7 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-60">
              Ignorar
            </button>
          )}
          {canUndo && (
            <button type="button" onClick={() => act(() => unlinkTouchMeta(touchId))} disabled={pending} className="h-7 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-60">
              {status === "ignored" ? "Dejar de ignorar" : "Quitar vínculo manual"}
            </button>
          )}
        </div>
      )}

      {picking && target && (
        <Sheet title="Vincular con Meta" onClose={() => setPicking(false)}>
          <MetaLinkPicker
            onPick={(option) =>
              act(() =>
                "touchId" in target
                  ? linkTouchToMeta({ touchId: target.touchId, ...pickedIds(option) })
                  : linkBookingToMeta({ bookingId: target.bookingId, ...pickedIds(option) }),
              )
            }
          />
        </Sheet>
      )}
    </div>
  );
}
