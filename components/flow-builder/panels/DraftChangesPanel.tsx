"use client";

import { GitCompare, Minus, Plus, Pencil, Link2, Unlink, X } from "lucide-react";
import type { GraphDiff, GraphDiffItem } from "@/lib/flow-engine/graph-diff";

const ICONS: Record<GraphDiffItem["kind"], typeof Plus> = { added: Plus, removed: Minus, changed: Pencil, connected: Link2, disconnected: Unlink };
const TONE: Record<GraphDiffItem["kind"], string> = {
  added: "text-emerald-700 dark:text-emerald-300",
  removed: "text-destructive",
  changed: "text-amber-700 dark:text-amber-300",
  connected: "text-muted-foreground",
  disconnected: "text-muted-foreground",
};

/**
 * «Cambios sin publicar»: qué es distinto entre el borrador y lo que corre, en palabras. Tocar una línea lleva al paso.
 * En el lienzo, mientras está abierto, lo nuevo se ve en verde y lo cambiado en ámbar (lo borrado ya no está).
 */
export function DraftChangesPanel({
  diff,
  onClose,
  onFocus,
  onPublish,
  onDiscard,
  canPublish,
}: {
  diff: GraphDiff;
  onClose: () => void;
  onFocus: (nodeId: string) => void;
  onPublish: () => void;
  onDiscard: () => void;
  canPublish: boolean;
}) {
  return (
    <div className="flex w-80 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold">Cambios sin publicar</h3>
        </div>
        <button onClick={onClose} aria-label="Cerrar los cambios" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {diff.empty ? (
          <p className="text-sm text-muted-foreground">El borrador es igual a lo que está corriendo (solo cambió el lugar de algún paso).</p>
        ) : (
          <ul className="space-y-1.5">
            {diff.items.map((item, i) => {
              const Icon = ICONS[item.kind];
              const content = (
                <>
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE[item.kind]}`} aria-hidden />
                  <span className="text-left">{item.text}</span>
                </>
              );
              return (
                <li key={`${item.kind}-${item.nodeId ?? ""}-${i}`}>
                  {item.nodeId ? (
                    <button type="button" onClick={() => onFocus(item.nodeId!)} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                      {content}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-2 py-1.5 text-sm">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-[11px] text-muted-foreground">En el lienzo: verde lo nuevo, ámbar lo que cambió. Lo que corre sigue siendo lo publicado hasta que publiques.</p>
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <button type="button" onClick={onDiscard} className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          Descartar
        </button>
        <button type="button" onClick={onPublish} disabled={!canPublish} className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          Publicar
        </button>
      </div>
    </div>
  );
}
