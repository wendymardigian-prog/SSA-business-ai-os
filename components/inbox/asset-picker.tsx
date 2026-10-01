"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AssetKindIcon } from "@/components/response-assets/asset-kind-icon";
import type { InboxAsset } from "./message-thread";

/**
 * Selector de la banca de recursos (textos y audios) que aparece al escribir
 * "/" en la bandeja. Reemplaza a TemplatePicker y AudioPicker: mismo
 * esqueleto (teclado, scroll al activo), un icono por tipo, y el pie cambia
 * segun que hay seleccionado, porque elegir un texto lo inserta y elegir un
 * audio abre un preview (el composer decide que hacer con cada uno; esto
 * solo lista y avisa cual se eligio).
 */
export function AssetPicker({
  matches,
  activeIndex,
  onPick,
  onHover,
}: {
  matches: InboxAsset[];
  activeIndex: number;
  onPick: (asset: InboxAsset) => void;
  onHover: (index: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Con muchos recursos el seleccionado se va abajo del panel; las flechas
  // tienen que arrastrar el scroll con ellas.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const active = matches[activeIndex];
  const footer =
    active?.kind === "audio"
      ? "↑↓ para elegir · Enter para ver el audio · Esc para cerrar"
      : "↑↓ para elegir · Enter para insertar · Esc para cerrar";

  return (
    <div
      role="listbox"
      aria-label="Recursos guardados"
      className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-auto rounded-lg border border-border bg-background shadow-lg"
    >
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">No hay recursos con ese nombre.</p>
      ) : (
        <ul>
          {matches.map((asset, index) => (
            <li key={asset.id}>
              <button
                ref={index === activeIndex ? activeRef : null}
                role="option"
                aria-selected={index === activeIndex}
                // El mousedown adelanta al blur del textarea: con onClick el
                // campo pierde el foco antes de que llegue la eleccion.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(asset);
                }}
                onMouseEnter={() => onHover(index)}
                className={cn(
                  "block w-full px-3 py-2 text-left transition-colors",
                  index === activeIndex ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <AssetKindIcon kind={asset.kind} className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{asset.name}</span>
                  {asset.shortcut && (
                    <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                      {asset.shortcut}
                    </code>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {asset.kind === "audio" ? asset.transcript || "Sin transcripción todavía" : asset.content}
                </span>
                {asset.tags.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {asset.tags.map((tag) => (
                      <span key={tag} className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground/70">{footer}</p>
    </div>
  );
}
