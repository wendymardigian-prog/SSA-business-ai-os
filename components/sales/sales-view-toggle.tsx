import Link from "next/link";
import { CreditCard, DollarSign } from "lucide-react";

/**
 * El selector Ventas ⇄ Pagos de la barra superior (referencia: `SalesViewToggle` de prevxcrm). Son dos
 * pantallas con su propia URL; esto solo las une.
 */
export function SalesViewToggle({ active }: { active: "ventas" | "pagos" }) {
  const item = (on: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm ${on ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <nav aria-label="Vista" className="flex rounded-lg bg-muted/60 p-0.5">
      <Link href="/dashboard/ventas" aria-current={active === "ventas" ? "page" : undefined} className={item(active === "ventas")}>
        <DollarSign className="h-4 w-4" aria-hidden /> Ventas
      </Link>
      <Link href="/dashboard/ventas/pagos" aria-current={active === "pagos" ? "page" : undefined} className={item(active === "pagos")}>
        <CreditCard className="h-4 w-4" aria-hidden /> Pagos
      </Link>
    </nav>
  );
}
