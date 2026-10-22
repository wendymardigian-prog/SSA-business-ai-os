"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LinkPending } from "@/components/ui/link-pending";

/**
 * Las pestañas del detalle de un agente y de una tarea de IA. Cada una es un
 * link (`?tab=`), pero la pestaña clickeada se marca EN EL CLIC: antes el
 * subrayado no se movia hasta que llegaba la pagina entera del servidor y lo
 * unico que cambiaba era el puntito, asi que parecia que el clic no habia
 * andado. El contenido llega despues, con su esqueleto (el `<Suspense key={tab}>`
 * de cada pagina).
 */
export function DetailTabs({
  tabs,
  active,
  label,
}: {
  tabs: ReadonlyArray<{ key: string; label: string; href: string }>;
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
    <nav className="flex gap-1 overflow-x-auto" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          onClick={(e) => {
            // Un clic con modificador abre otra pestaña del navegador: esta no cambia.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            setClicked(t.key);
          }}
          aria-current={shown === t.key ? "page" : undefined}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
            shown === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          <LinkPending className="ml-1.5 align-middle" />
        </Link>
      ))}
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
