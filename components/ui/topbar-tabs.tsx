"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { HEADER_TABS_CONTAINER, headerTabClass, tabCountLabel } from "@/lib/ui/topbar-tabs";

/**
 * Las pestañas de una pantalla, en la barra superior (`<PageHeader tabs={<TopbarTabs … />} />`). Es el ÚNICO control
 * de pestañas de la barra: Ajustes, Equipo/Roles y el resto de las pantallas lo usan (directo
 * o con `HeaderTabs`, que es lo mismo con otros nombres de props).
 *
 * Un control segmentado: fondo gris y la activa en blanco. Son links (cambian la URL) y la activa se anuncia con
 * `aria-current="page"`. Una pestaña puede llevar un ícono y un contador (`count`): un círculo con el número, que no
 * se dibuja con 0. En el celular la barra baja a su propia fila y se desplaza adentro (lo resuelve `PageHeader`). Si
 * una pantalla cambia de pestaña sin ir al servidor, pasa `onSelect` y el link no navega.
 */
export interface TopbarTab {
  key: string;
  label: string;
  href: string;
  icon?: ComponentType<{ className?: string }>;
  count?: number | null;
  /** Qué dice el lector de pantalla del contador («3 por revisar»). Sin esto, el número solo. */
  countLabel?: string;
}

export function TopbarTabs({
  tabs,
  active,
  label,
  onSelect,
}: {
  tabs: readonly TopbarTab[];
  active: string;
  /** Nombre accesible del grupo («Secciones del Portal»). */
  label: string;
  onSelect?: (key: string) => void;
}) {
  // La pestaña elegida se marca en el clic, no cuando responde el servidor (traído de RER-BAIOS #149: una pestaña
  // quedaba casi 2 s sin ningún cambio). Mismo patrón que `components/agents/detail-tabs.tsx`: cuando el servidor
  // confirma (o se vuelve atrás con el navegador), manda lo que dice `active`. Se ajusta durante el render.
  const [clicked, setClicked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(active);
  if (confirmed !== active) {
    setConfirmed(active);
    setClicked(null);
  }
  const shown = clicked ?? active;
  if (tabs.length === 0) return null;
  return (
    <nav aria-label={label} className={HEADER_TABS_CONTAINER}>
      {tabs.map((tab) => {
        const isActive = tab.key === shown;
        const count = tabCountLabel(tab.count);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            scroll={false}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              if (!onSelect) {
                setClicked(tab.key);
                return;
              }
              e.preventDefault();
              onSelect(tab.key);
            }}
            aria-current={isActive ? "page" : undefined}
            className={headerTabClass(isActive)}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {tab.label}
            {count && (
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                aria-label={tab.countLabel ? `${tab.count} ${tab.countLabel}` : undefined}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
