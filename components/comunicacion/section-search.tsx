"use client";

import { useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { sanitizeSearch } from "@/lib/url-params";
import { useInboxUrl } from "@/components/inbox/use-inbox-url";

/**
 * El buscador de la barra superior de las pantallas de comunicacion (Bloque I, I4).
 *
 * Hace commit a `?q=` al enviar (Enter), no mientras se escribe: en la Bandeja
 * cada commit es una consulta al servidor. Pasa por `sanitizeSearch` aca y el
 * servidor lo vuelve a pasar: la URL se puede escribir a mano.
 *
 * La `×` borra solo la busqueda; el resto de los filtros queda puesto.
 *
 * `PageHeader` dibuja los `filters` dos veces (barra en la computadora, franja
 * abajo en el telefono), asi que cada copia tiene su borrador. Si `?q=` cambia
 * desde afuera (limpiar filtros, un link), el borrador se pone al dia.
 */
export function SectionSearch({ value, placeholder, label }: { value: string; placeholder: string; label: string }) {
  const { pending, setParam } = useInboxUrl();
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  function commit(raw: string) {
    setParam("q", sanitizeSearch(raw));
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(draft);
      }}
      className="relative min-w-0 flex-1 topbar:w-64 topbar:flex-none"
    >
      {pending ? (
        <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      )}
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-8 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {(draft || value) && (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            if (value) commit("");
          }}
          aria-label="Limpiar la búsqueda"
          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </form>
  );
}
