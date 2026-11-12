"use client";

import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
  titleSlot,
  tabs,
  tabsExtra,
  view,
  quickFilter,
  search,
  group,
  more,
  primary,
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
  /**
   * Reemplaza al titulo y a su ⓘ (plano formularios-ui, F7): el editor de un formulario pone ahi el icono del
   * tipo y el nombre editable. Sin esto, el titulo de siempre.
   */
  titleSlot?: ReactNode;
  /**
   * Pestañas de la pantalla. En la computadora van en la barra, despues del titulo; abajo de 860 px bajan a la
   * segunda fila, que se desplaza de costado (no hay scroll horizontal de la pagina).
   */
  tabs?: ReactNode;
  /** Lo que acompaña a las pestañas SOLO en la segunda fila del celular (estado, Metricas…): en la computadora ya va a la derecha. */
  tabsExtra?: ReactNode;
  /**
   * Los lugares fijos de la barra (Servicios A2, F130.0). Se dibujan SIEMPRE en este orden a la derecha:
   * vista (Tabla | Tablero), filtro rapido, buscador, "Agrupar: …", el menu ⋯ y el boton principal. Asi cada pantalla
   * que los usa queda igual que las demas sin tener que acordarse del orden. En el celular el boton principal sigue
   * arriba (siempre visible) y el resto baja a la franja que se desplaza de costado, junto a `filters`.
   * `filters` (los demas filtros de la pantalla) va despues del filtro rapido y antes del buscador; `right` (acciones
   * de siempre) va antes del boton principal. Las pantallas que no usan los lugares fijos quedan como estaban.
   */
  view?: ReactNode;
  quickFilter?: ReactNode;
  search?: ReactNode;
  group?: ReactNode;
  more?: ReactNode;
  primary?: ReactNode;
}) {
  const chrome = useDashboardChrome();
  const meta = route ? PAGE_META[route] : undefined;
  const shownTitle = title ?? meta?.title ?? "";
  const shownTooltip = tooltip ?? meta?.tooltip;
  // Las clases van completas y no interpoladas: Tailwind genera lo que lee en el codigo.
  const wide = filtersBreakpoint === "wide";
  const slots = toolbarSlots({ filters, view, quickFilter, search, group, more });
  const actions = right || primary ? (
    <>
      {right}
      {primary}
    </>
  ) : null;

  return (
    <>
      {/* gap-1.5 en el celular: con el menu, las vistas, los botones, los borradores y la campana, 2 px por hueco eran los que dejaban la campana cortada contra el borde en un telefono de 375 px. */}
      <header data-topbar="" className="flex h-14 flex-shrink-0 items-center gap-1.5 border-b border-border px-3 md:gap-2 md:px-6">
        {chrome && <MobileMenuButton chrome={chrome} />}
        {backHref}
        {titleSlot ?? (
          <>
            {/* El titulo de una pantalla (el de `route`, siempre corto) no se achica: antes se desplazan las pestañas.
                Sin esto, con pestañas y filtros quedaba en cero a 900 px. Un titulo propio (una ficha de detalle, que
                puede ser largo) se achica ultimo y se corta con "…". */}
            <h1 className={cn("truncate text-base font-semibold", title === undefined && meta ? "shrink-0" : "[flex-shrink:0.01]")}>{shownTitle}</h1>
            {shownTooltip && <InfoTooltip text={shownTooltip} />}
          </>
        )}
        {left}
        {/* Las pestañas se encogen y se desplazan de costado antes de pisar lo que tienen a la derecha. */}
        {tabs && <div className="hidden min-w-0 [flex-shrink:0.1] items-center overflow-x-auto [scrollbar-width:none] topbar:flex [&::-webkit-scrollbar]:hidden">{tabs}</div>}
        <div className="min-w-0 flex-1" />
        {/* shrink-0: lo que se aprieta primero es el titulo (que se trunca), nunca
            los botones. Sin esto un boton con "+" y texto se partia en dos
            renglones y el ultimo quedaba cortado contra el borde. */}
        <div className={wide ? "hidden shrink-0 items-center gap-2 topbar-wide:flex" : "hidden shrink-0 items-center gap-2 topbar:flex"}>
          {slots}
          {actions}
        </div>
        {/* En el celular a la derecha solo entran el boton principal, la campana y los borradores. */}
        <div className={wide ? "flex shrink-0 items-center gap-1 topbar-wide:hidden" : "flex shrink-0 items-center gap-1 topbar:hidden"}>
          {actions}
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
      {tabs && (
        <div data-topbar-strip="" className="flex h-12 flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 topbar:hidden">
          {tabs}
          {tabsExtra}
        </div>
      )}
      {slots && (
        <div
          data-topbar-strip=""
          className={
            wide
              ? // `topbar:overflow-visible`: entre 860 y 1080 los menus de los filtros son `absolute`
                // y un `overflow-x-auto` los cortaria; abajo de 860 son `fixed` y no les afecta.
                "flex h-12 flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 topbar:overflow-visible topbar-wide:hidden"
              : "flex h-12 flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 topbar:hidden"
          }
        >
          {slots}
        </div>
      )}
    </>
  );
}

/**
 * Lo que va a la derecha de la barra (y a la franja del celular), en el orden fijo. `null` si no hay nada, asi la
 * franja no se dibuja vacia.
 */
function toolbarSlots(s: { filters?: ReactNode; view?: ReactNode; quickFilter?: ReactNode; search?: ReactNode; group?: ReactNode; more?: ReactNode }): ReactNode {
  const parts = [s.view, s.quickFilter, s.filters, s.search, s.group, s.more];
  if (!parts.some(Boolean)) return null;
  return (
    <>
      {s.view}
      {s.quickFilter}
      {s.filters}
      {s.search}
      {s.group}
      {s.more}
    </>
  );
}
