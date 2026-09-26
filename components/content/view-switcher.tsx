"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Columns3, List } from "lucide-react";
import type { ContentView } from "@/lib/content/filters";

/**
 * Kanban / Calendario / Lista, en la barra superior (F7, F21).
 *
 * La vista vive en la URL y no en el estado del componente: asi se comparte
 * con un link, el boton "atras" hace lo que se espera, y la pagina la lee en
 * el servidor para traer solo lo que esa vista necesita.
 */

const VIEWS: Array<{ value: ContentView; label: string; Icon: typeof Columns3 }> = [
  { value: "kanban", label: "Kanban", Icon: Columns3 },
  { value: "calendar", label: "Calendario", Icon: CalendarDays },
  { value: "list", label: "Lista", Icon: List },
];

export function ContentViewSwitcher({ current }: { current: ContentView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(view: ContentView) {
    const next = new URLSearchParams(params.toString());
    if (view === "kanban") next.delete("vista");
    else next.set("vista", view);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex items-center rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
      {VIEWS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => go(value)}
          aria-pressed={current === value}
          title={label}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm ${
            current === value ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Contar piezas o publicaciones. Solo tiene sentido en el calendario. */
export function CountModeSwitcher({ current }: { current: "pieces" | "publications" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(mode: "pieces" | "publications") {
    const next = new URLSearchParams(params.toString());
    if (mode === "pieces") next.delete("contar");
    else next.set("contar", mode);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="hidden text-muted-foreground lg:inline">Contar:</span>
      <select
        value={current}
        onChange={(e) => go(e.target.value as "pieces" | "publications")}
        className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
        aria-label="Que se cuenta en el resumen"
      >
        <option value="pieces">Piezas</option>
        <option value="publications">Publicaciones</option>
      </select>
    </label>
  );
}
