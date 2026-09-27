"use client";

import type { ReactNode } from "react";
import { ConfigHeader } from "./config-header";
import { ConfigNav } from "./config-nav";

/**
 * La pantalla de Configuracion de agenda (F8): la barra de 56 px con
 * "‹ Agendas" y el boton principal de la seccion, y debajo la navegacion
 * lateral (fila desplazable en el celular) con el contenido al lado.
 */
export function ConfigShell({
  route,
  title,
  right,
  filters,
  children,
}: {
  route: string;
  title?: string;
  right?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConfigHeader route={route} title={title} right={right} filters={filters} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:gap-8 md:p-6">
        <ConfigNav />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  );
}
