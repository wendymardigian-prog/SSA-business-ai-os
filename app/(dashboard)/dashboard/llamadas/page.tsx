import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/** Lista de llamadas (F12). Se completa en el bloque de pantallas de L1. */
export default async function LlamadasPage() {
  await requirePermission("calls.view");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/llamadas" />
      <div className="p-6 text-sm text-muted-foreground">Todavía no entró ninguna llamada.</div>
    </div>
  );
}
