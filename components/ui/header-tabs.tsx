import { TopbarTabs, type TopbarTab } from "@/components/ui/topbar-tabs";

export { headerTabClass } from "@/lib/ui/topbar-tabs";

/**
 * Las pestañas de la barra superior con props de lista (`items`). Es `TopbarTabs` (el único control de pestañas de
 * la barra) con otro nombre: lo usan Finanzas, Ventas ⇄ Pagos, Ajustes y Equipo/Roles.
 */
export type HeaderTabItem = TopbarTab;

export function HeaderTabs({ items, active, label }: { items: readonly HeaderTabItem[]; active: string; label: string }) {
  return <TopbarTabs tabs={items} active={active} label={label} />;
}
