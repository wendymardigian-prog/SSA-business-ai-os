"use client";

import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/tooltip";
import { PAGE_META } from "@/lib/nav/page-actions";
import {
  MobileChromeActions,
  MobileMenuButton,
  useDashboardChrome,
} from "@/components/dashboard-chrome";

/**
 * La barra superior, la misma en todas las pantallas (F7).
 *
 * 56 px: el menu (solo en el celular), el titulo, el ⓘ con la explicacion, y a
 * la derecha los filtros y botones de la pagina. No hay barras de herramientas
 * adentro del contenido.
 *
 * En el celular esta es la UNICA barra —antes convivian la del workspace y la
 * de la pagina— y por eso lleva el boton del menu y la campana. Los filtros,
 * que no entran al lado del titulo en una pantalla angosta, bajan a una
 * segunda franja que se desplaza de costado.
 */
export function PageHeader({
  route,
  title,
  tooltip,
  left,
  right,
  filters,
  backHref,
  filtersBreakpoint = "topbar",
}: {
  /**
   * La ruta de la pantalla. De ahi salen el titulo y la explicacion
   * (lib/nav/page-actions.ts), asi no quedan repartidos por 22 archivos y
   * cambiarlos es tocar un solo lugar.
   */
  route?: string;
  /** Titulo propio. Lo usan las pantallas de detalle, donde depende del dato. */
  title?: string;
  tooltip?: string;
  /** Controles pegados al titulo (pestañas cortas, selector de vista). */
  left?: ReactNode;
  /** Botones y filtros de la pagina. */
  right?: ReactNode;
  /**
   * Filtros que en el celular bajan a su propia franja. En la computadora van
   * a la derecha, junto al resto.
   */
  filters?: ReactNode;
  /** Flecha de volver, para las pantallas de detalle. */
  backHref?: ReactNode;
  /**
   * A partir de que ancho los filtros van en la barra y no en su franja:
   * "topbar" (860 px, el de siempre) o "wide" (1080 px) para una pantalla con
   * tantos controles que a 900 px el titulo desaparece y los botones se cortan
   * (Agenda).
   */
  filtersBreakpoint?: "topbar" | "wide";
}) {
  const chrome = useDashboardChrome();
  const meta = route ? PAGE_META[route] : undefined;
  const shownTitle = title ?? meta?.title ?? "";
  const shownTooltip = tooltip ?? meta?.tooltip;
  // Las clases van completas y no interpoladas: Tailwind genera lo que lee en el codigo.
  const wide = filtersBreakpoint === "wide";

  return (
    <>
      <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
        {chrome && <MobileMenuButton chrome={chrome} />}
        {backHref}
        <h1 className="truncate text-base font-semibold">{shownTitle}</h1>
        {shownTooltip && <InfoTooltip text={shownTooltip} />}
        {left}
        <div className="min-w-0 flex-1" />
        {/* shrink-0: lo que se aprieta primero es el titulo (que se trunca), nunca
            los botones. Sin esto un boton con "+" y texto se partia en dos
            renglones y el ultimo quedaba cortado contra el borde. */}
        <div className={wide ? "hidden shrink-0 items-center gap-2 topbar-wide:flex" : "hidden shrink-0 items-center gap-2 topbar:flex"}>
          {filters}
          {right}
        </div>
        {/* En el celular a la derecha solo entran la campana y los borradores. */}
        <div className={wide ? "flex shrink-0 items-center gap-1 topbar-wide:hidden" : "flex shrink-0 items-center gap-1 topbar:hidden"}>
          {right}
          {chrome && <MobileChromeActions chrome={chrome} />}
        </div>
      </header>

      {/*
        La franja de filtros, de 48 px, abajo de 860 px (F13).
        El corte es `topbar:` y no `md:`: entre 768 y 860 px los filtros del
        dashboard (canal, respondido por y periodo, con sus menus) no entran al
        lado del titulo y lo empujaban fuera de la barra. Vale para todas las
        pantallas que pasan filtros, asi el lugar donde aparecen es el mismo
        siempre.
      */}
      {filters && (
        <div
          className={
            wide
              ? // `topbar:overflow-visible`: entre 860 y 1080 los menus de los filtros son `absolute`
                // y un `overflow-x-auto` los cortaria; abajo de 860 son `fixed` y no les afecta.
                "flex h-12 flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 topbar:overflow-visible topbar-wide:hidden"
              : "flex h-12 flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 topbar:hidden"
          }
        >
          {filters}
        </div>
      )}
    </>
  );
}
