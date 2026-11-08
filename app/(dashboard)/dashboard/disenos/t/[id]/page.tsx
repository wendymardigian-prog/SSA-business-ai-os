import { EditorPage } from "@/components/designer/editor/editor-page";

export const dynamic = "force-dynamic";

/** Editor de una plantilla, con las pestañas Diseño y Generaciones (F17, F53). Sin `designer.view`, 404 (F4). */
export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorPage kind="template" id={id} />;
}
