"use client";

import { Wallet } from "lucide-react";
import { FinanceAutoCard } from "@/components/settings/finance-auto-card";
import { FinanceCategoriesCard } from "@/components/settings/finance-categories-card";
import type { FinanceAutoData } from "@/lib/finance/auto-card";
import type { ExpenseCategory } from "@/lib/finance/categories";
import type { CategoryUsage } from "@/lib/finance/category-totals";

/**
 * Ajustes > General > Finanzas (`expenses.manage`): las categorías de gasto y los gastos automáticos. La sección se arma
 * con tarjetas, una por tema.
 */
export function FinanceSettings({
  categories,
  usage,
  usageFailed,
  usageTruncated,
  auto,
}: {
  categories: ExpenseCategory[];
  usage: Record<string, CategoryUsage>;
  usageFailed: boolean;
  usageTruncated: boolean;
  /** La configuración de los gastos automáticos (comisiones, Meta, cierre del mes). */
  auto: FinanceAutoData;
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Finanzas</h2>
      </div>
      <FinanceCategoriesCard categories={categories} usage={usage} usageFailed={usageFailed} usageTruncated={usageTruncated} />
      <FinanceAutoCard data={auto} categories={categories} />
    </section>
  );
}
