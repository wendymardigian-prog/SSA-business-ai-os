"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ListFilter } from "lucide-react";
import { FilterMenu, MenuOption } from "@/components/ui/filter-menu";

/**
 * Un desplegable de la barra superior cuyas opciones son URLs (una pantalla que se dibuja en el servidor y filtra por
 * `?param=`). Reemplaza las filas de chips cuando la pantalla no tiene un botón «Filtros»: «Período: Últimos 7 días ▾».
 */
export function LinkFilterMenu({
  label,
  current,
  options,
  defaultKey,
  icon,
  menuClassName = "topbar:w-[240px]",
}: {
  label: string;
  current: string;
  options: ReadonlyArray<{ key: string; label: string; href: string; trailing?: ReactNode }>;
  /** La opción que no cuenta como filtro puesto (el botón no se resalta). */
  defaultKey?: string;
  icon?: ReactNode;
  menuClassName?: string;
}) {
  const router = useRouter();
  const selected = options.find((o) => o.key === current) ?? options[0];
  return (
    <FilterMenu
      label={label}
      value={selected?.label}
      active={defaultKey !== undefined && current !== defaultKey}
      icon={icon ?? <ListFilter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      menuClassName={menuClassName}
    >
      {options.map((o) => (
        <MenuOption key={o.key} checked={o.key === selected?.key} onSelect={() => router.push(o.href)} title={o.label} trailing={o.trailing} />
      ))}
    </FilterMenu>
  );
}
