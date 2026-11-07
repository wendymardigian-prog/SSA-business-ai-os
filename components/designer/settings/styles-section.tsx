"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { archiveStyle, saveStyle } from "@/lib/actions/designer/settings";
import type { UploadedFont } from "@/lib/designer/fonts";
import { draftFromStyle, styleCards, type StyleCard, type StyleDraft } from "@/lib/designer/screens/settings";
import type { DesignStyle } from "@/lib/designer/styles";
import { ExtractDialog, type PickableDesign } from "./extract-dialog";
import { StyleEditor } from "./style-editor";

function Card({ card, onEdit, onArchive, onRestore, busy }: { card: StyleCard; onEdit: () => void; onArchive: () => void; onRestore: () => void; busy: boolean }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-1 p-4" style={{ background: card.palette.bg, color: card.palette.text }}>
        <span className="text-2xl leading-none" style={{ fontFamily: `"${card.fonts.title}", sans-serif`, fontWeight: 700 }}>
          Aa Bb Cc
        </span>
        <span className="text-xs" style={{ fontFamily: `"${card.fonts.body}", sans-serif` }}>
          Así se ve el cuerpo del texto.
        </span>
        <span className="mt-1 h-1 w-12 rounded-full" style={{ background: card.palette.accent }} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <b className="min-w-0 break-words text-sm">{card.name}</b>
          <span className="flex shrink-0 -space-x-1" aria-label={`Colores: fondo ${card.palette.bg}, texto ${card.palette.text}, acento ${card.palette.accent}`}>
            {[card.palette.bg, card.palette.text, card.palette.accent].map((c, i) => (
              <i key={i} className="h-4 w-4 rounded-full border border-border" style={{ background: c }} />
            ))}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {`${card.fonts.title} + ${card.fonts.body}`}
        </p>
        {card.densityLine && <p className="text-xs text-muted-foreground">{card.densityLine}</p>}
        {card.rulesPreview && <p className="text-xs text-muted-foreground">{card.rulesPreview}</p>}
        <div className="mt-auto flex gap-2 pt-1">
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">
            <Pencil className="h-3 w-3" aria-hidden /> Editar
          </button>
          {card.archived ? (
            <button type="button" onClick={onRestore} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50">
              <RotateCcw className="h-3 w-3" aria-hidden /> Restaurar
            </button>
          ) : (
            <button type="button" onClick={onArchive} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50">
              <Archive className="h-3 w-3" aria-hidden /> Archivar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** «Estilos propios»: tarjetas con su paleta y fuentes; + Crear desde mis piezas; editar; archivar. */
export function StylesSection({ styles, designs, google, uploaded }: { styles: DesignStyle[]; designs: PickableDesign[]; google: string[]; uploaded: UploadedFont[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ draft: StyleDraft; corrections: string[] } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cards = styleCards(styles);
  const byKey = new Map(styles.map((s) => [s.key, s]));

  function archive(key: string, archived: boolean) {
    setError(null);
    start(async () => {
      try {
        const style = byKey.get(key);
        if (!style) return;
        const result = archived ? await archiveStyle({ key }) : await saveStyle({ style: { ...style, archived: false } });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setStatus(archived ? `Archivé «${style.name}». Ya no se ofrece, pero los diseños que lo usaron no cambian.` : `Restauré «${style.name}».`);
        router.refresh();
      } catch {
        setError("No pude hacerlo ahora. Probá de nuevo.");
      }
    });
  }

  return (
    <section aria-labelledby="estilos-propios" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="estilos-propios" className="text-base font-semibold">
            Estilos propios
          </h2>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">Aparecen junto a los 6 de fábrica cuando le pedís algo a la IA. Un estilo es un punto de partida, no un límite.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setExtracting(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Sparkles className="h-4 w-4" aria-hidden /> + Crear desde mis piezas
          </button>
          <button type="button" onClick={() => setEditing({ draft: draftFromStyle(null), corrections: [] })} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Crear a mano
          </button>
        </div>
      </div>

      {status && (
        <p className="text-xs text-good" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {cards.active.length === 0 && cards.archived.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">Todavía no tenés estilos propios</p>
          <p className="mt-1 text-xs text-muted-foreground">Subí de 3 a 5 piezas que te gusten y la IA arma uno. Mientras tanto tenés los 6 estilos de fábrica.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.active.map((card) => (
            <Card key={card.key} card={card} busy={pending} onEdit={() => setEditing({ draft: draftFromStyle(byKey.get(card.key) ?? null), corrections: [] })} onArchive={() => archive(card.key, true)} onRestore={() => archive(card.key, false)} />
          ))}
        </ul>
      )}

      {cards.archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} className="w-fit text-xs text-muted-foreground underline hover:text-foreground">
            {showArchived ? "Ocultar archivados" : `Ver archivados (${cards.archived.length})`}
          </button>
          {showArchived && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.archived.map((card) => (
                <Card key={card.key} card={card} busy={pending} onEdit={() => setEditing({ draft: draftFromStyle(byKey.get(card.key) ?? null), corrections: [] })} onArchive={() => archive(card.key, true)} onRestore={() => archive(card.key, false)} />
              ))}
            </ul>
          )}
        </div>
      )}

      {extracting && (
        <ExtractDialog
          designs={designs}
          onClose={() => setExtracting(false)}
          onExtracted={(style, corrections) => {
            setExtracting(false);
            setEditing({ draft: { ...draftFromStyle(style), key: null }, corrections });
          }}
        />
      )}
      {editing && (
        <StyleEditor
          initial={editing.draft}
          corrections={editing.corrections}
          google={google}
          uploaded={uploaded}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setError(null);
            setStatus(`Guardé «${name}». Ya aparece cuando elegís un estilo.`);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
