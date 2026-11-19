// @plantilla-quitar(proyectos)
/**
 * Copiar prompt (Corrida C, F234). El portal no ve rutas de Storage: pide, firmado con PORTAL_SHARED_SECRET, el prompt
 * de un paso. La base valida la sesión, el proyecto propio y el acceso (vencido: PO410) y da las partes
 * (`portal_builder_prompt_parts`); acá se leen los textos del bucket privado y se arma (lib/projects/prompt.ts).
 * No gasta créditos ni escribe nada.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { buildPrompt, type PromptParts } from "@/lib/projects/prompt";
import { readTextCapped } from "@/lib/http/read-capped";
import { portalDenied } from "@/lib/portal-admin/denied";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{1,40}$/;

export async function POST(request: NextRequest) {
  const body = await readTextCapped(request, 2000);
  if (body === null) return NextResponse.json({ ok: false }, { status: 413 });
  const okSig = verifyPortalRequest({
    secret: process.env.PORTAL_SHARED_SECRET,
    timestamp: request.headers.get("x-portal-timestamp"),
    signature: request.headers.get("x-portal-signature"),
    body,
    nowMs: Date.now(),
  });
  if (!okSig) return NextResponse.json({ ok: false }, { status: 401 });
  let input: { session?: unknown; project_id?: unknown; step?: unknown; unit?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const unit = input.unit ?? null;
  if (typeof input.session !== "string" || typeof input.project_id !== "string" || !UUID.test(input.project_id) || typeof input.step !== "string" || !KEY.test(input.step) || (unit !== null && (typeof unit !== "string" || !KEY.test(unit)))) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const service = await createServiceClient();
  const parts = await svcRpc<PromptParts>(service, "portal_builder_prompt_parts", { p_session: input.session, p_project_id: input.project_id, p_step: input.step, p_unit: unit });
  if (!parts.ok) return NextResponse.json(portalDenied(parts.error), { status: 403 });

  // Los textos: cada ruta es de la carpeta de ESTE proyecto (lo garantiza la base al guardar la versión).
  const paths = [...parts.data.documents.map((d) => d.version?.path), parts.data.requirements?.path].filter((p): p is string => typeof p === "string");
  const texts: Record<string, string> = {};
  await Promise.all(
    [...new Set(paths)].map(async (p) => {
      const { data } = await service.storage.from("student-projects").download(p);
      if (data) texts[p] = await data.text();
    }),
  );
  const built = buildPrompt(parts.data, texts);
  return NextResponse.json({ ok: true, ...built });
}
