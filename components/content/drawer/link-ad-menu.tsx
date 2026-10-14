"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Search } from "lucide-react";
import { PopoverMenu, type MenuItem } from "@/components/automations/popover-menu";
import { Sheet } from "@/components/ui/sheet";
import { linkAdToPiece, searchAdsForPiece, unlinkAdFromPiece, type AdOption } from "@/lib/actions/content-ad-link";
import { linkMenuLabels, type LinkedAd } from "@/lib/meta/content-ad-summary";
import { useToast } from "./toast";

/**
 * El menú «⋯» del detalle de una pieza (Tirón 2, A2): «Vincular a un anuncio» y, si ya tiene, «Desvincular». Es el ÚNICO lugar
 * del lado del contenido donde se ve este vínculo manual; no hay botones ni secciones afuera. El que lo ve ya tiene los dos
 * permisos (lo decide la página); las acciones del servidor los vuelven a comprobar.
 */
export function LinkAdMenu({ pieceId, pieceTitle, ads }: { pieceId: string; pieceTitle: string; ads: LinkedAd[] }) {
  const [picking, setPicking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const labels = linkMenuLabels(ads.length);

  async function unlink(ad: LinkedAd) {
    setUnlinking(true);
    const res = await unlinkAdFromPiece({ adId: ad.adId });
    setUnlinking(false);
    if (res.ok) {
      toast.push({ tone: "ok", text: `Desvinculaste «${ad.name ?? ad.adId}». Si Meta lo asocia a esta pieza, el próximo sync lo vuelve a vincular.` });
      router.refresh();
    } else {
      toast.push({ tone: "error", text: res.error });
    }
  }

  const items: MenuItem[] = [{ key: "link", label: labels.link, onSelect: () => setPicking(true) }];
  if (ads.length > 0) {
    items.push({ key: "sep", separator: true });
    for (const ad of ads) {
      items.push({
        key: `unlink-${ad.adId}`,
        label: ads.length === 1 ? labels.unlink : `Desvincular «${ad.name ?? ad.adId}»`,
        onSelect: () => void unlink(ad),
        disabled: unlinking,
      });
    }
  }

  return (
    <>
      <PopoverMenu
        trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
        triggerLabel="Más acciones de la pieza"
        items={items}
        align="right"
        triggerClassName="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
      />
      {picking && (
        <Sheet title="Vincular a un anuncio" onClose={() => setPicking(false)}>
          <AdPicker
            pieceId={pieceId}
            pieceTitle={pieceTitle}
            onLinked={(name) => {
              setPicking(false);
              toast.push({ tone: "ok", text: `Vinculaste «${name}» con esta pieza.` });
              router.refresh();
            }}
          />
        </Sheet>
      )}
    </>
  );
}

/** El buscador de anuncios del catálogo: por nombre o id, a los 250 ms de dejar de escribir; con menos de 2 letras, la ayuda. */
function AdPicker({ pieceId, pieceTitle, onLinked }: { pieceId: string; pieceTitle: string; onLinked: (adName: string) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ query: string; options: AdOption[]; failed: boolean } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = text.trim();
  const enough = query.length >= 2;

  useEffect(() => {
    if (!enough) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchAdsForPiece(query);
      if (!cancelled) setResult({ query, options: found.ok ? found.options : [], failed: !found.ok });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enough]);

  const current = enough && result?.query === query ? result : null;
  const searching = enough && !current;

  async function pick(option: AdOption) {
    setSaving(option.adId);
    setError(null);
    const res = await linkAdToPiece({ adId: option.adId, pieceId });
    setSaving(null);
    if (res.ok) onLinked(option.name ?? option.adId);
    else setError(res.error);
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-muted-foreground">Pieza: {pieceTitle}</p>
      <label className="relative block">
        <span className="sr-only">Buscar un anuncio</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nombre o id del anuncio (mínimo 2 letras)"
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {current?.failed && <p className="text-xs text-destructive">No pude buscar. Probá de nuevo.</p>}
      {searching && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {current && !current.failed && current.options.length === 0 && (
        <p className="text-xs text-muted-foreground">No encontré nada con eso. Si el anuncio es muy nuevo, sincronizá la cuenta y probá de nuevo.</p>
      )}
      {!enough && <p className="text-xs text-muted-foreground">Escribí el nombre del anuncio, o pegá su id.</p>}

      <ul className="space-y-1.5">
        {(current?.options ?? []).map((option) => (
          <li key={option.adId}>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void pick(option)}
              className="w-full rounded-lg border border-border p-2.5 text-left hover:bg-accent disabled:opacity-60"
            >
              <span className="block text-sm font-medium">{option.name ?? option.adId}</span>
              <span className="block text-[11px] text-muted-foreground">
                {option.adId}
                {option.path ? ` · ${option.path}` : ""}
              </span>
              {option.linkedTo && <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">Ya está vinculado a «{option.linkedTo}»: pasará a esta pieza.</span>}
              {saving === option.adId && <span className="mt-0.5 block text-[11px] text-muted-foreground">Vinculando…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
