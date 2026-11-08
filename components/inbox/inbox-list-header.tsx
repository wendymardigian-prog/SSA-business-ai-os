"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InboxFilters } from "@/lib/inbox/filters";
import type { InboxAccount } from "@/lib/inbox/accounts";
import type { FilterSummaryCatalog } from "@/lib/inbox/filter-summary";
import type { PendingDraftCounts } from "@/lib/agent/drafts/pending-count";
import { SectionSearch } from "@/components/comunicacion/section-search";
import { InboxDraftsLink, InboxFilterSummary, InboxFiltersMenu } from "@/components/inbox/inbox-filters";

/**
 * El encabezado de la lista de la Bandeja: la cantidad, el boton de Filtros, el icono de buscar y los
 * borradores. Abajo se despliegan el buscador y la linea con lo que esta filtrado.
 *
 * El buscador arranca cerrado, salvo que la URL ya traiga una busqueda. La `×` borra lo buscado y lo cierra. Si `?q=`
 * cambia desde afuera ("Limpiar filtros", un link), se abre o se cierra segun corresponda.
 */
export function InboxListHeader({
  filters,
  countLabel,
  workspaceId,
  draftCounts,
  accounts,
  tags,
  members,
  hasGroups,
  catalog,
}: {
  filters: InboxFilters;
  /** "1037 chats" o "3 grupos". */
  countLabel: string;
  workspaceId: string;
  draftCounts?: PendingDraftCounts;
  accounts: InboxAccount[];
  tags: { id: string; name: string; color: string | null }[];
  members: { userId: string; label: string }[];
  hasGroups: boolean;
  catalog: FilterSummaryCatalog;
}) {
  const [searchOpen, setSearchOpen] = useState(!!filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  if (syncedSearch !== filters.search) {
    setSyncedSearch(filters.search);
    setSearchOpen(!!filters.search);
  }

  return (
    <>
      {/* Los margenes estan medidos: la lista mide 320 px. "Bandeja" ya esta justo arriba, en la barra: repetirlo acá
          cortaba el "1037 chats". */}
      <div className="flex h-12 flex-shrink-0 items-center gap-1.5 border-b border-border px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums">
          <span className="sr-only">Bandeja: </span>
          {countLabel}
        </h2>
        <InboxFiltersMenu filters={filters} accounts={accounts} tags={tags} members={members} hasGroups={hasGroups} communities={catalog.communities} />
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          aria-label="Buscar conversaciones"
          aria-expanded={searchOpen}
          title="Buscar"
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
            searchOpen ? "border-primary-edge bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60",
          )}
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </button>
        <InboxDraftsLink workspaceId={workspaceId} draftCounts={draftCounts} />
      </div>

      {searchOpen && (
        <div className="flex flex-shrink-0 border-b border-border px-3 py-2">
          <SectionSearch
            value={filters.search}
            placeholder="Nombre, teléfono o usuario"
            label="Buscar conversaciones"
            autoFocus={!filters.search}
            onClose={() => setSearchOpen(false)}
          />
        </div>
      )}

      <InboxFilterSummary filters={filters} catalog={catalog} />
    </>
  );
}
