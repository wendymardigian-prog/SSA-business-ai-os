import { EditorPage } from "@/components/designer/editor/editor-page";

export const dynamic = "force-dynamic";

/** Editor de un diseño (o de una pieza generada desde una plantilla). Sin `designer.view`, 404 (F4). */
export default async function DesignEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorPage kind="design" id={id} />;
}
