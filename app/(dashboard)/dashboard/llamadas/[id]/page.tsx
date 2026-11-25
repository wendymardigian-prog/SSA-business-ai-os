import { notFound, redirect } from "next/navigation";
import { CallDetail } from "@/components/calls/call-detail";
import { getPermissionContext } from "@/lib/auth/guards";
import { loadCallDetail } from "@/lib/calls/load-detail";

export const dynamic = "force-dynamic";

/**
 * La ficha de una llamada (F13), como página. Se lee con el cliente del usuario: si la RLS
 * no deja ver la llamada, es un 404 (no se confirma que exista). El armado vive en
 * `loadCallDetail`, el mismo que usa el panel de la lista.
 */
export default async function LlamadaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string }> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("calls.view")) redirect("/dashboard");
  const { id } = await params;
  const loaded = await loadCallDetail(ctx, id);
  if (!loaded) notFound();
  const sp = searchParams ? await searchParams : {};
  loaded.data.initialTab = sp.tab === "actividad" ? "actividad" : null;
  return <CallDetail data={loaded.data} view={loaded.view} canEdit={loaded.canEdit} />;
}
