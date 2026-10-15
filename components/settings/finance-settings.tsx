"use client";

import { Wallet } from "lucide-react";
import { FinanceCategoriesCard } from "@/components/settings/finance-categories-card";
import type { ExpenseCategory } from "@/lib/finance/categories";
import type { CategoryUsage } from "@/lib/finance/category-totals";

/**
 * Ajustes > General > Finanzas (`expenses.manage`): las categorías de gasto. La sección se arma con tarjetas, una
 * por tema, para que los gastos automáticos sumen la suya sin tocar esta.
 */
export function FinanceSettings({
  categories,
  usage,
  usageFailed,
  usageTruncated,
}: {
  categories: ExpenseCategory[];
  usage: Record<string, CategoryUsage>;
  usageFailed: boolean;
  usageTruncated: boolean;
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Finanzas</h2>
      </div>
      <FinanceCategoriesCard categories={categories} usage={usage} usageFailed={usageFailed} usageTruncated={usageTruncated} />
    </section>
  );
}
