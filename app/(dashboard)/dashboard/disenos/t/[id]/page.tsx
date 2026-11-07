import { notFound } from "next/navigation";
import { requireDesigner } from "@/lib/designer/guards";

export const dynamic = "force-dynamic";

/**
 * Editor de una plantilla, con las pestañas Diseño y Generaciones (F17, F53). Sin `designer.view`, 404 (F4).
 * Contenido mínimo de la Ola 1: el editor real lo construye DS2 y la pestaña Generaciones, DS6.
 */
export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, workspace } = await requireDesigner("designer.view");
  const { id } = await params;
  const { data } = await supabase.from("design_templates").select("id, name").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!data) notFound();
  return <div className="p-6 text-sm">{data.name}</div>;
}
