"use client";

import { PageHeader } from "@/components/page-header";
import { FinanceTabs } from "@/components/finance/finance-tabs";

/** El Resumen de Finanzas (provisorio hasta el bloque G3: el panel de ingresos, gastos y resultado). */
export function SummaryShell() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/finanzas" tabs={<FinanceTabs />} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Acá vas a ver cuánto entra, cuánto sale y cuánto queda. Mientras tanto, cargá y revisá tus gastos en la pestaña Gastos.
        </p>
      </div>
    </div>
  );
}
