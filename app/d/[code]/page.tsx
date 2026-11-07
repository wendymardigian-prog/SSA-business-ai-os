import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizeDesignCode } from "@/lib/designer/public-links";

export const dynamic = "force-dynamic";

/**
 * El link público de un diseño (F43). Responde sin sesión; lo que se muestra sale SOLO de
 * `design_public_get` (un código que no existe, un borrador o algo no publicado: 404).
 * Contenido mínimo de la Ola 1: la página real la construye DS5.
 */
export default async function DesignPublicPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeDesignCode(raw);
  if (!code) notFound();
  const service = await createServiceClient();
  const { data, error } = await service.rpc("design_public_get", { p_code: code });
  if (error || !data) notFound();
  const design = data as { name: string };
  return <main className="mx-auto max-w-3xl p-6 text-sm">{design.name}</main>;
}
