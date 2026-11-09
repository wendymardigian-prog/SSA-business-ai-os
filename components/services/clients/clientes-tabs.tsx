// @plantilla-quitar(servicios)
import { TopbarTabs } from "@/components/ui/topbar-tabs";

/** Las dos vistas de Clientes (Servicios · Clientes), en la barra superior. */
export function ClientesTabs({ active }: { active: "servicios" | "clientes" }) {
  return (
    <TopbarTabs
      label="Vistas de Clientes"
      active={active}
      tabs={[
        { key: "servicios", label: "Servicios", href: "/dashboard/clientes" },
        { key: "clientes", label: "Clientes", href: "/dashboard/clientes/lista" },
      ]}
    />
  );
}
