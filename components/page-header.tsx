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
}) {
  const chrome = useDashboardChrome();
  const meta = route ? PAGE_META[route] : undefined;
  const shownTitle = title ?? meta?.title ?? "";
  const shownTooltip = tooltip ?? meta?.tooltip;

  return (
    <>
      <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
        {chrome && <MobileMenuButton chrome={chrome} />}
        {backHref}
        <h1 className="truncate text-base font-semibold">{shownTitle}</h1>
        {shownTooltip && <InfoTooltip text={shownTooltip} />}
        {left}
        <div className="flex-1" />
        <div className="hidden items-center gap-2 md:flex">
          {filters}
          {right}
        </div>
        {/* En el celular a la derecha solo entran la campana y los borradores. */}
        <div className="flex items-center gap-1 md:hidden">
          {right}
          {chrome && <MobileChromeActions chrome={chrome} />}
        </div>
      </header>

      {filters && (
        <div className="flex flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 py-2 md:hidden">
          {filters}
        </div>
      )}
    </>
  );
}
