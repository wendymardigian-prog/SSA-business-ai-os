"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { AudioLibraryItem } from "./message-thread";

/**
 * Selector de la banca de audios que aparece con "/a" en la bandeja (F21).
 *
 * Mismo esqueleto que TemplatePicker (teclado, scroll al activo), pero elegir
 * uno no inserta texto: abre un preview con reproductor y "Enviar" (el
 * composer lo decide, esto solo lista y avisa cual se eligio).
 */

export function AudioPicker({
  matches,
  activeIndex,
  onPick,
  onHover,
}: {
  matches: AudioLibraryItem[];
  activeIndex: number;
  onPick: (audio: AudioLibraryItem) => void;
  onHover: (index: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      role="listbox"
      aria-label="Banca de audios"
      className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-auto rounded-lg border border-border bg-background shadow-lg"
    >
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">No hay audios con ese nombre.</p>
      ) : (
        <ul>
          {matches.map((audio, index) => (
            <li key={audio.id}>
              <button
                ref={index === activeIndex ? activeRef : null}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(audio);
                }}
                onMouseEnter={() => onHover(index)}
                className={cn(
                  "block w-full px-3 py-2 text-left transition-colors",
                  index === activeIndex ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{audio.name}</span>
                  {audio.shortcut && (
                    <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                      {audio.shortcut}
                    </code>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {audio.transcript || "Sin transcripción todavía"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground/70">
        ↑↓ para elegir · Enter para ver el audio · Esc para cerrar
      </p>
    </div>
  );
}
