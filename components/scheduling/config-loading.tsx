"use client";

import { usePathname } from "next/navigation";
import { ConfigHeader } from "./config-header";
import { ConfigNav } from "./config-nav";
import { configSectionFor } from "@/lib/scheduling/config-sections";

/**
 * Mientras carga una seccion de la Configuracion de agenda: la misma barra y
 * el mismo menu lateral que la pantalla real (`ConfigShell`), con el item
 * NUEVO ya marcado, y el contenido en gris.
 *
 * Antes, al hacer clic en el menu quedaba marcada la seccion vieja hasta que
 * la nueva terminaba de cargar entera, y parecia que el clic no habia andado.
 */
export function ConfigLoading() {
  const pathname = usePathname();
  const section = configSectionFor(pathname);
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <ConfigHeader route={section?.href ?? pathname} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:flex-row md:gap-8 md:p-6">
        <ConfigNav />
        <div className="min-w-0 flex-1 space-y-4">
          <span className="sr-only">Cargando…</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/50" />
          ))}
        </div>
      </div>
    </div>
  );
}
