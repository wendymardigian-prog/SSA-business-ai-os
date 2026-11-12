"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter, MoreHorizontal, Plus, Rows3 } from "lucide-react";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { PortalMenu, PortalMenuItem } from "@/components/ui/portal-menu";
import { cn } from "@/lib/utils";

/**
 * Los controles de los lugares fijos de la barra superior (`PageHeader`: `quickFilter`, `group`, `more`, `primary`).
 * Una pantalla los compone; el orden lo pone la barra. Servicios A2, F130.0.
 */

export interface QuickFilterOption<K extends string> {
  key: K;
  label: string;
  /** Cuantos hay con esa opcion. `undefined` = no se sabe (no se dibuja; nunca un cero inventado). */
  count?: number;
}

/** El filtro rapido: una lista con el conteo de cada opcion ("Todos 11", "Rojo 2"…). */
export function QuickFilterMenu<K extends string>({
  label = "Mostrar",
  value,
  options,
  onSelect,
  allKey,
}: {
  label?: string;
  value: K;
  options: readonly QuickFilterOption<K>[];
  onSelect: (key: K) => void;
  /** La opcion que equivale a "sin filtro" (el boton no se resalta con ella). */
  allKey: K;
}) {
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <FilterMenu
      label={label}
      value={current ? (current.count === undefined ? current.label : `${current.label} · ${current.count}`) : ""}
      active={value !== allKey}
      icon={<ListFilter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      menuClassName="topbar:w-[260px]"
    >
      {options.map((o) => (
        <MenuOption key={o.key} checked={o.key === value} onSelect={() => onSelect(o.key)} title={o.label} trailing={o.count} />
      ))}
    </FilterMenu>
  );
}

/**
 * El filtro rapido de una pantalla del servidor: elegir cambia un parametro de la URL (y conserva los demas). Con la
 * opcion "sin filtro" el parametro se saca, asi el link de siempre sigue siendo el mismo.
 */
export function UrlQuickFilterMenu<K extends string>({
  param,
  value,
  options,
  allKey,
  label,
}: {
  param: string;
  value: K;
  options: readonly QuickFilterOption<K>[];
  allKey: K;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <QuickFilterMenu
      label={label}
      value={value}
      options={options}
      allKey={allKey}
      onSelect={(k) => {
        const next = new URLSearchParams(params?.toString() ?? "");
        if (k === allKey) next.delete(param);
        else next.set(param, k);
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}

/** El filtro rapido cuyas opciones son links (cada una ya sabe a donde va). */
export function LinkQuickFilterMenu<K extends string>({
  value,
  options,
  allKey,
  label,
}: {
  value: K;
  options: readonly (QuickFilterOption<K> & { href: string })[];
  allKey: K;
  label?: string;
}) {
  const router = useRouter();
  return <QuickFilterMenu label={label} value={value} options={options} allKey={allKey} onSelect={(k) => router.push(options.find((o) => o.key === k)?.href ?? "")} />;
}

/** El cambio de vista cuando cada vista es un link (Lista | Mes): mismo dibujo que `ViewToggle`. */
export function LinkViewToggle({ label, value, options }: { label: string; value: string; options: readonly { value: string; label: string; href: string }[] }) {
  return (
    <nav aria-label={label} className="flex shrink-0 rounded-lg bg-muted/60 p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          aria-current={o.value === value ? "page" : undefined}
          className={cn("inline-flex h-8 items-center rounded-md px-2.5 text-sm max-topbar:h-10", o.value === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** "Agrupar: …". */
export function GroupMenu<K extends string>({
  value,
  options,
  onSelect,
  noneKey,
}: {
  value: K;
  options: readonly { key: K; label: string }[];
  onSelect: (key: K) => void;
  noneKey: K;
}) {
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <FilterMenu label="Agrupar" value={current?.label ?? ""} active={value !== noneKey} icon={<Rows3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />} menuClassName="topbar:w-[220px]">
      <MenuGroupLabel>Agrupar por</MenuGroupLabel>
      {options.map((o) => (
        <MenuOption key={o.key} checked={o.key === value} onSelect={() => onSelect(o.key)} title={o.label} />
      ))}
    </FilterMenu>
  );
}

export interface MoreAction {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Un link (se navega) o una accion. */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

/**
 * El menu ⋯ de la barra, con las acciones secundarias (Guardar vista, Importar…). Se dibuja en un portal pegado al
 * boton y se acomoda para no cortarse contra el borde de la pantalla. Sin acciones, no se dibuja.
 */
export function TopbarMoreMenu({ actions, label = "Más acciones" }: { actions: readonly MoreAction[]; label?: string }) {
  const router = useRouter();
  if (actions.length === 0) return null;
  return (
    <PortalMenu
      label={label}
      align="end"
      width={240}
      triggerClassName="h-8 w-8 shrink-0 justify-center rounded-lg border border-input bg-background hover:border-muted-foreground/60 topbar:h-8 max-topbar:h-10 max-topbar:w-10"
      trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
    >
      {actions.map((a) => (
        <PortalMenuItem key={a.key} disabled={a.disabled} onSelect={() => (a.href ? router.push(a.href) : a.onSelect?.())}>
          <span className="flex items-center gap-2">
            {a.icon}
            {a.label}
          </span>
        </PortalMenuItem>
      ))}
    </PortalMenu>
  );
}

/** El boton principal de la barra (+ Servicio, + Módulo…). En el celular queda solo el "+" (el nombre, para el lector). */
export function PrimaryButton({
  label,
  text,
  onClick,
  href,
  icon,
  className,
}: {
  /** El nombre para el lector de pantalla ("Nuevo servicio"). */
  label: string;
  /** Lo que se ve al lado del "+" ("Servicio"). Sin esto, `label`. */
  text?: string;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (href ? router.push(href) : onClick?.())}
      aria-label={label}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 max-topbar:h-10 max-topbar:min-w-10 max-topbar:justify-center",
        className,
      )}
    >
      {icon ?? <Plus className="h-4 w-4" aria-hidden />}
      <span className="hidden sm:inline">{text ?? label}</span>
    </button>
  );
}
