// @plantilla-quitar(proyectos)
/**
 * Subir un Word o un PDF a un paso de Mis proyectos (Corrida C, F235): el portal sube el original a la carpeta del
 * proyecto y pide acá, firmado, su texto. La base valida que el archivo sea de un proyecto propio
 * (`portal_project_file_grant`, project_doc); el tipo se reconoce por sus bytes y se convierte a Markdown con lo mismo
 * que usa Conocimiento (lib/knowledge/extract.ts). El portal guarda ese texto como versión, con el original al lado.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { detectMimeType, extractMarkdown } from "@/lib/knowledge/extract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 2000) return NextResponse.json({ ok: false }, { status: 413 });
  const okSig = verifyPortalRequest({
    secret: process.env.PORTAL_SHARED_SECRET,
    timestamp: request.headers.get("x-portal-timestamp"),
    signature: request.headers.get("x-portal-signature"),
    body,
    nowMs: Date.now(),
  });
  if (!okSig) return NextResponse.json({ ok: false }, { status: 401 });
  let input: { session?: unknown; project_id?: unknown; path?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof input.session !== "string" || typeof input.project_id !== "string" || !UUID.test(input.project_id) || typeof input.path !== "string" || input.path.length > 500) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const db = await createServiceClient();
  const grant = await svcRpc<{ bucket: string; path: string }>(db, "portal_project_file_grant", { p_session: input.session, p_kind: "project_doc", p_item_id: input.project_id, p_ref: input.path });
  if (!grant.ok) return NextResponse.json({ ok: false, code: grant.error.code, message: grant.error.message }, { status: 403 });
  const { data } = await db.storage.from(grant.data.bucket).download(grant.data.path);
  if (!data) return NextResponse.json({ ok: false, message: "No encontramos el archivo" }, { status: 404 });
  const bytes = new Uint8Array(await data.arrayBuffer());
  const kind = detectMimeType(bytes, grant.data.path);
  if (!kind.ok || (kind.mime !== "application/pdf" && kind.mime !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
    return NextResponse.json({ ok: false, message: "Ese archivo no es un Word ni un PDF" }, { status: 400 });
  }
  const out = await extractMarkdown(bytes, kind.mime);
  if (!out.ok || !out.markdown.trim()) return NextResponse.json({ ok: false, message: "No pudimos leer el texto del archivo. Copialo y pegalo" }, { status: 422 });
  return NextResponse.json({ ok: true, text: out.markdown.slice(0, 2_000_000) });
}
