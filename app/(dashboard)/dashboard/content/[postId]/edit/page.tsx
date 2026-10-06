import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { legacyPieceHref } from "@/lib/content/legacy-routes";

/**
 * El editor de una pieza (F24) pasó a ser el drawer de la pieza (F96).
 *
 * Igual que el detalle: se conserva y redirige al tablero con el drawer
 * abierto en esa pieza. Una pieza que no existe sigue dando 404 (F99).
 */
export default async function EditPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const { workspace, supabase } = await getPermissionContext();

  const href = await legacyPieceHref(supabase, workspace.id, postId);
  if (!href) notFound();

  redirect(href);
}
