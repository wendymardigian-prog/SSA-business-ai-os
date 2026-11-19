// @plantilla-quitar(servicios)
/**
 * Los archivos del portal (B2, §4.8): el portal nunca ve una ruta de Storage. Pide, firmado con PORTAL_SHARED_SECRET,
 * el archivo de una clase, la foto propia o dónde subir una; la base decide si es de la persona
 * (`app_servicio.portal_file_grant`, con la sesión del estudiante) y SSA devuelve un link que vence en 5 minutos.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { readTextCapped } from "@/lib/http/read-capped";
import { portalDenied } from "@/lib/portal-admin/denied";

export const dynamic = "force-dynamic";
const TTL_SECONDS = 300;

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
  let input: { session?: unknown; kind?: unknown; item_id?: unknown; ref?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof input.session !== "string" || typeof input.kind !== "string") return NextResponse.json({ ok: false }, { status: 400 });

  const service = await createServiceClient();
  // Corrida C: los documentos de Mis proyectos y los comprobantes de Facturación tienen su propia función (00397).
  const projectKind = ["project_doc_upload", "project_doc", "revenue_receipt_upload", "revenue_receipt"].includes(input.kind); // @plantilla-quitar(proyectos)
  // @plantilla-sin(proyectos): const projectKind = false;
  const grant = await svcRpc<{ bucket: string; path: string; upload: boolean }>(service, projectKind ? "portal_project_file_grant" : "portal_file_grant", {
    p_session: input.session,
    p_kind: input.kind,
    p_item_id: typeof input.item_id === "string" ? input.item_id : null,
    p_ref: typeof input.ref === "string" ? input.ref : null,
  });
  if (!grant.ok) return NextResponse.json(portalDenied(grant.error), { status: 403 });
  const { bucket, path, upload } = grant.data;
  if (upload) {
    const { data, error } = await service.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false }, { status: 500 });
    return NextResponse.json({ ok: true, url: data.signedUrl, path, token: data.token });
  }
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, TTL_SECONDS);
  if (error || !data) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, url: data.signedUrl });
}
