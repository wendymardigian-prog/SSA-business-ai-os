import { notFound } from "next/navigation";
import { requireDesigner } from "@/lib/designer/guards";

export const dynamic = "force-dynamic";

/**
 * Editor de un diseño (F17–F30). Sin `designer.view`, 404 (F4).
 * Contenido mínimo de la Ola 1: el editor real lo construye DS2.
 */
export default async function DesignEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, workspace } = await requireDesigner("designer.view");
  const { id } = await params;
  const { data } = await supabase.from("designs").select("id, name").eq("id", id).eq("workspace_id", workspace.id).is("template_id", null).maybeSingle();
  if (!data) notFound();
  return <div className="p-6 text-sm">{data.name}</div>;
}
