"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Share2, ExternalLink, ChevronDown } from "lucide-react";
import { CopyLinkButton } from "./copy-link-button";

export interface ShareableEvent {
  id: string;
  title: string;
  durationMinutes: number;
  areaLabel: string | null;
  url: string;
}

/**
 * "Compartir" en la barra superior (Agenda v2): el link de cada evento activo
 * a mano, sin tener que ir a Configuración > Eventos a buscarlo.
 */
export function ShareLinksMenu({ events }: { events: ShareableEvent[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Compartir los links de los eventos"
        title="Compartir los links de los eventos"
        className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 text-sm hover:bg-muted xl:px-3"
      >
        <Share2 className="h-4 w-4" aria-hidden />
        {/* Con poco ancho queda solo el icono: la barra de Agenda tiene siete controles. */}
        <span className="hidden xl:inline">Compartir</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-2 shadow-lg"
        >
          {events.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Todavía no hay eventos activos para compartir.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.areaLabel ? `${e.areaLabel} · ` : ""}
                      {e.durationMinutes} min
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <CopyLinkButton url={e.url} label="Copiar" />
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir ${e.title}`}
                      title="Abrir"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/agenda/configuracion/eventos"
            className="mt-1 block rounded-lg px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Ver todos los eventos
          </Link>
        </div>
      )}
    </div>
  );
}
