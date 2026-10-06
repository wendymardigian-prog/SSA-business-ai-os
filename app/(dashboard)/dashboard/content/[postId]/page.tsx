import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { legacyPieceHref } from "@/lib/content/legacy-routes";

/**
 * El detalle de una pieza (F36) pasó a ser el drawer de la pieza (F96).
 *
 * Esta ruta se conserva porque hay links guardados, avisos y entradas de
 * auditoría que apuntan acá: redirige al tablero con el drawer abierto en esa
 * pieza. Una pieza que no existe sigue dando el mismo 404 de siempre (F99).
 */
export default async function PostDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const { workspace, supabase } = await getPermissionContext();

  const href = await legacyPieceHref(supabase, workspace.id, postId);
  if (!href) notFound();

  redirect(href);
}
