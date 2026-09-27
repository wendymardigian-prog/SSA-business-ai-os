"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";

/**
 * La barra de las pantallas de configuracion de agenda (F8): siempre con
 * "‹ Agendas" para volver, el titulo de la seccion y su boton principal.
 */
export function ConfigHeader({ route, title, right, filters }: { route: string; title?: string; right?: ReactNode; filters?: ReactNode }) {
  return (
    <PageHeader
      route={route}
      title={title}
      right={right}
      filters={filters}
      backHref={
        <Link
          href="/dashboard/agenda"
          aria-label="Volver a Agendas"
          className="-ml-1 flex items-center gap-1 rounded-lg p-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Agendas</span>
        </Link>
      }
    />
  );
}
