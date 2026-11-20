// @plantilla-quitar(servicios)
/**
 * El link firmado del formulario de un paso del camino (00503): lo pide el portal, firmado con PORTAL_SHARED_SECRET,
 * cuando el estudiante toca «Firmar el contrato» o «Completar el formulario». La base decide si el paso es suyo
 * (`app_servicio.portal_item_form_link`) y acá se firma el link con el paso adentro. Ver lib/portal-admin/form-link.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { readTextCapped } from "@/lib/http/read-capped";
import { resolveFormLink, type FormLinkGrant } from "@/lib/portal-admin/form-link";
import { signFormLink } from "@/lib/forms/signed-link";
import { loadPublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

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
  let input: { session?: unknown; item_id?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const service = await createServiceClient();
  const result = await resolveFormLink(input, {
    grant: (session, itemId) => svcRpc<FormLinkGrant>(service, "portal_item_form_link", { p_session: session, p_item_id: itemId }),
    baseUrl: (workspaceId) => loadPublicBaseUrl(service, workspaceId),
    sign: (s) => signFormLink(service, s),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
