import { SummaryShell } from "@/components/finance/summary-shell";
import { requirePermission } from "@/lib/auth/guards";

export default async function FinanzasPage() {
  await requirePermission("expenses.view");
  return <SummaryShell />;
}
