// @plantilla-quitar(servicios)
import { HeaderTabs } from "@/components/ui/header-tabs";

/** Servicios ⇄ Clientes, en la barra superior de las dos pantallas de Clientes. */
export function ClientsTabs({ active }: { active: "servicios" | "clientes" }) {
  return (
    <HeaderTabs
      label="Vistas de Clientes"
      active={active}
      items={[
        { key: "servicios", label: "Servicios", href: "/dashboard/clientes" },
        { key: "clientes", label: "Clientes", href: "/dashboard/clientes/lista" },
      ]}
    />
  );
}
