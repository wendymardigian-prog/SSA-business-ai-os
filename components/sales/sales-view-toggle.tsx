import { CreditCard, DollarSign } from "lucide-react";
import { HeaderTabs } from "@/components/ui/header-tabs";

/**
 * El selector Ventas ⇄ Pagos de la barra superior (referencia: `SalesViewToggle` de prevxcrm). Son dos
 * pantallas con su propia URL; esto solo las une. Usa `HeaderTabs`, las pestañas de todas las pantallas.
 */
export function SalesViewToggle({ active }: { active: "ventas" | "pagos" }) {
  return (
    <HeaderTabs
      label="Vista"
      active={active}
      items={[
        { key: "ventas", label: "Ventas", href: "/dashboard/ventas", icon: DollarSign },
        { key: "pagos", label: "Pagos", href: "/dashboard/ventas/pagos", icon: CreditCard },
      ]}
    />
  );
}
