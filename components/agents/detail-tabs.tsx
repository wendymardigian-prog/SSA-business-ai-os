"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { headerTabClass } from "@/components/ui/header-tabs";
import { LinkPending } from "@/components/ui/link-pending";

/**
 * Las pestañas del detalle de un agente y de una tarea de IA. Van en la barra
 * superior (`<PageHeader tabs={<DetailTabs … />} />`) con el mismo control que
 * el resto de las pantallas (`HeaderTabs`). Cada una es un link (`?tab=`), pero
 * la pestaña clickeada se marca EN EL CLIC: antes la marca no se movia hasta
 * que llegaba la pagina entera del servidor y lo unico que cambiaba era el
 * puntito, asi que parecia que el clic no habia andado. El contenido llega
 * despues, con su esqueleto (el `<Suspense key={tab}>` de cada pagina).
 *
 * Una pestaña con `unavailable` se ve apagada y no es un link (la razon va en
 * el `title`).
 */
export function DetailTabs({
  tabs,
  active,
  label,
}: {
  tabs: ReadonlyArray<{ key: string; label: string; href: string; unavailable?: string }>;
  active: string;
  /** Para lectores de pantalla: "Secciones de la tarea", "Secciones del agente". */
  label: string;
}) {
  const [clicked, setClicked] = useState<string | null>(null);
  // Cuando el servidor confirma la pestaña nueva (o se vuelve atras con el navegador), manda lo que dice la URL.
  // Se ajusta durante el render, no en un efecto: asi no hay un cuadro con la pestaña vieja marcada.
  const [confirmed, setConfirmed] = useState(active);
  if (confirmed !== active) {
    setConfirmed(active);
    setClicked(null);
  }
  const shown = clicked ?? active;

  return (
    <nav aria-label={label} className="flex shrink-0 items-center rounded-lg bg-muted/60 p-0.5">
      {tabs.map((t) =>
        t.unavailable ? (
          <span
            key={t.key}
            title={t.unavailable}
            aria-disabled="true"
            className={cn(headerTabClass(false), "cursor-not-allowed text-muted-foreground/50 hover:text-muted-foreground/50")}
          >
            {t.label} <span className="text-[10px]">· próximamente</span>
          </span>
        ) : (
          <Link
            key={t.key}
            href={t.href}
            onClick={(e) => {
              // Un clic con modificador abre otra pestaña del navegador: esta no cambia.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              setClicked(t.key);
            }}
            aria-current={shown === t.key ? "page" : undefined}
            className={headerTabClass(shown === t.key)}
          >
            {t.label}
            <LinkPending />
          </Link>
        ),
      )}
    </nav>
  );
}

/** Lo que se ve mientras llega el contenido de una pestaña. */
export function TabBodySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando">
      <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/50" />
      <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/50" />
      <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/50" />
    </div>
  );
}
