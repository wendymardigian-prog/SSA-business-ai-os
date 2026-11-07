import { PageHeader } from "@/components/page-header";
import { requireDesigner } from "@/lib/designer/guards";

export const dynamic = "force-dynamic";

/**
 * Ajustes del Diseñador IA: estilos propios y fuentes (F11, F37). Pide `designer.manage`; sin él, 404.
 * Contenido mínimo de la Ola 1: la pantalla real la construye DS3.
 */
export default async function DisenosAjustesPage() {
  await requireDesigner("designer.manage");
  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/disenos/ajustes" />
      <div className="p-6 text-sm text-muted-foreground">Estilos propios y fuentes del negocio.</div>
    </div>
  );
}
