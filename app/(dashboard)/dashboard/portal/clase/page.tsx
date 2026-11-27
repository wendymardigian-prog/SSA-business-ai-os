// @plantilla-quitar(servicios)
import { notFound, redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { PROGRAM_PAGE_PERMISSIONS } from "@/lib/portal-admin/load-program";
import { svcSchema } from "@/lib/services/db";
import { parseClassRef, programClassHref } from "@/lib/program/class-drawer";

export const dynamic = "force-dynamic";

/**
 * `/dashboard/portal/clase?sesion=&fecha=`: el link «Clase» de una tarea. Busca el programa de la sesión (con la sesión
 * de la persona: la RLS de `live_sessions` decide si la ve) y lleva a su calendario con esa clase abierta.
 */
export default async function ClassRedirectPage({ searchParams }: { searchParams: Promise<{ sesion?: string; fecha?: string }> }) {
  const sp = await searchParams;
  const ref = parseClassRef(sp.sesion, sp.fecha);
  if (!ref) notFound();
  const ctx = await requireAnyPermission(PROGRAM_PAGE_PERMISSIONS);
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(ctx.workspace as { services_enabled?: boolean | null }) })) notFound();
  const { data } = await svcSchema(ctx.supabase).from("live_sessions").select("product_id").eq("id", ref.sessionId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const productId = (data as { product_id?: string } | null)?.product_id;
  if (!productId) notFound();
  const today = new Date().toISOString().slice(0, 10);
  redirect(programClassHref(productId, ref, ref.occursOn < today));
}
