"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Search } from "lucide-react";
import { PopoverMenu, type MenuItem } from "@/components/automations/popover-menu";
import { Sheet } from "@/components/ui/sheet";
import { linkAdToPiece, searchPiecesForAd, unlinkAdFromPiece, type PieceOption } from "@/lib/actions/content-ad-link";
import type { AdContentLink } from "@/lib/meta/content-ad-summary";

/**
 * El menú «⋯» del detalle de un anuncio (Tirón 2, A2): «Vincular a una pieza de contenido» y, si ya tiene una,
 * «Desvincular». Es el ÚNICO lugar del lado de los anuncios donde se ve este vínculo manual. Solo se muestra a quien tiene
 * los dos permisos (lo decide la página; las acciones del servidor los vuelven a comprobar).
 */
export function LinkContentMenu({ adId, adName, link }: { adId: string; adName: string; link: AdContentLink | null }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const router = useRouter();

  // El aviso se va solo a los 6 segundos.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function unlink() {
    setBusy(true);
    const res = await unlinkAdFromPiece({ adId });
    setBusy(false);
    if (res.ok) {
      setNotice({ tone: "ok", text: "Desvinculaste el anuncio. Si Meta lo asocia a una pieza, el próximo sync lo vuelve a vincular." });
      router.refresh();
    } else {
      setNotice({ tone: "error", text: res.error });
    }
  }

  const items: MenuItem[] = [
    {
      key: "link",
      label: "Vincular a una pieza de contenido",
      hint: link ? `Hoy: ${link.pieceTitle}${link.manual ? "" : " (automático)"}` : undefined,
      onSelect: () => setPicking(true),
    },
  ];
  if (link) items.push({ key: "unlink", label: "Desvincular", onSelect: () => void unlink(), disabled: busy });

  return (
    <>
      <PopoverMenu
        trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
        triggerLabel="Más acciones del anuncio"
        items={items}
        align="right"
        triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent"
      />
      {picking && (
        <Sheet title="Vincular a una pieza de contenido" onClose={() => setPicking(false)}>
          <PiecePicker
            adId={adId}
            adName={adName}
            onLinked={(title) => {
              setPicking(false);
              setNotice({ tone: "ok", text: `Vinculaste este anuncio con «${title}».` });
              router.refresh();
            }}
          />
        </Sheet>
      )}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-3 py-2 text-sm shadow-lg ${
            notice.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
              : "border-red-500/40 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
          }`}
        >
          {notice.text}
        </div>
      )}
    </>
  );
}

const DATE = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

/** El buscador de piezas: por título (a los 250 ms de dejar de escribir); sin texto, las más recientes. */
function PiecePicker({ adId, adName, onLinked }: { adId: string; adName: string; onLinked: (pieceTitle: string) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ query: string; options: PieceOption[]; failed: boolean } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = text.trim().length >= 2 ? text.trim() : "";

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchPiecesForAd(query);
      if (!cancelled) setResult({ query, options: found.ok ? found.options : [], failed: !found.ok });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const current = result?.query === query ? result : null;

  async function pick(option: PieceOption) {
    setSaving(option.id);
    setError(null);
    const res = await linkAdToPiece({ adId, pieceId: option.id });
    setSaving(null);
    if (res.ok) onLinked(option.title);
    else setError(res.error);
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-muted-foreground">Anuncio: {adName}</p>
      <label className="relative block">
        <span className="sr-only">Buscar una pieza de contenido</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Título de la pieza (mínimo 2 letras)"
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>
      {!query && <p className="text-xs text-muted-foreground">Estas son las piezas más recientes. Escribí para buscar por título.</p>}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {current?.failed && <p className="text-xs text-destructive">No pude buscar. Probá de nuevo.</p>}
      {!current && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {current && !current.failed && current.options.length === 0 && <p className="text-xs text-muted-foreground">No encontré ninguna pieza con eso.</p>}

      <ul className="space-y-1.5">
        {(current?.options ?? []).map((option) => (
          <li key={option.id}>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void pick(option)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left hover:bg-accent disabled:opacity-60"
            >
              {option.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura de una red externa (CDN de Meta/YouTube): next/image no la optimiza.
                <img src={option.thumbnailUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-md border border-dashed border-border" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{option.title}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {DATE.format(new Date(option.date))}
                  {option.platforms.length > 0 ? ` · ${option.platforms.join(", ")}` : ""}
                  {option.paid ? " · ya pautada" : ""}
                </span>
                {saving === option.id && <span className="block text-[11px] text-muted-foreground">Vinculando…</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
