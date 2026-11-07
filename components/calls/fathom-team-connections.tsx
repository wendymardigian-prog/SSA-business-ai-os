"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CategoryGroup } from "@/lib/calls/catalog";
import { FATHOM_MODE_LABELS, type FathomSettings } from "@/lib/fathom/settings";
import { cn } from "@/lib/utils";
import { FathomImportSettings } from "./fathom-import-settings";

export interface TeamFathomConnection {
  id: string;
  name: string;
  settings: FathomSettings;
}

/** Lo que importa cada persona del equipo: quien configura el análisis lo ve y lo puede cambiar. */
export function FathomTeamConnections({ connections, groups }: { connections: TeamFathomConnection[]; groups: CategoryGroup[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (connections.length === 0) return null;
  return (
    <section aria-labelledby="fathom-team-title" className="mt-4 rounded-xl border border-border bg-card p-5">
      <h2 id="fathom-team-title" className="text-base font-semibold">Conexiones del equipo</h2>
      <p className="mt-1 text-sm text-muted-foreground">Qué importa cada persona. Si cambiás algo, queda en el historial.</p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {connections.map((c) => {
          const isOpen = open === c.id;
          return (
            <li key={c.id}>
              <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{FATHOM_MODE_LABELS[c.settings.mode]}</span>
                <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent">
                  Cambiar <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-border p-3">
                  <FathomImportSettings settings={c.settings} groups={groups} connectionId={c.id} title={`Qué entra de ${c.name}`} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
