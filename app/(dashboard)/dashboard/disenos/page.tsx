import { PageHeader } from "@/components/page-header";
import { requireDesigner } from "@/lib/designer/guards";

export const dynamic = "force-dynamic";

/**
 * Diseñador IA: lista de Diseños y Plantillas (F15). Sin `designer.view`, 404 (F4).
 * Contenido mínimo de la Ola 1: la lista real la construye DS2.
 */
export default async function DisenosPage() {
  await requireDesigner("designer.view");
  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/disenos" />
      <div className="p-6 text-sm text-muted-foreground">Todavía no hay diseños. Creá el primero con IA o subí una imagen.</div>
    </div>
  );
}
