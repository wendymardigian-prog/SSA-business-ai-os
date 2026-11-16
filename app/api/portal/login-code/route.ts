// @plantilla-quitar(servicios)
/**
 * El portal de estudiantes pide el código para entrar (B2, F202). Solo el servidor del portal: el pedido viene firmado
 * con `PORTAL_SHARED_SECRET` (lib/portal-admin/portal-signature.ts). SSA emite el código en la base
 * (`app_servicio.portal_login_code_issue`, solo service_role) y lo manda con el Resend del negocio, como la invitación.
 *
 * La respuesta es SIEMPRE la misma exista o no el email (no se revela quién es estudiante), salvo el tope (6.º pedido
 * en una hora): `{ ok: false, reason: "rate_limited" }`. Los logs no llevan ni el email ni el código.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { loadPortalHost, portalUrl } from "@/lib/portal-admin/load";
import { portalLoginCodeEmail } from "@/lib/email/templates";
import { resolveBrand } from "@/lib/brand";
import { sendTransactionalEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

interface Issued {
  send: boolean;
  reason?: string;
  workspace_id?: string;
  contact_id?: string;
  email?: string;
  display_name?: string | null;
  code?: string;
}

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

  let input: { host?: unknown; email?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof input.host !== "string" || typeof input.email !== "string" || input.host.length > 253 || input.email.length > 254) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const service = await createServiceClient();
  const res = await svcRpc<Issued>(service, "portal_login_code_issue", { p_host: input.host, p_email: input.email });
  if (!res.ok) {
    console.error("[portal-login] no pude emitir el código:", res.error.code ?? "?");
    return NextResponse.json({ ok: true });
  }
  const d = res.data;
  if (d.reason === "rate_limited") return NextResponse.json({ ok: false, reason: "rate_limited" });
  if (!d.send || !d.code || !d.email || !d.workspace_id) return NextResponse.json({ ok: true });

  const [{ data: ws }, host] = await Promise.all([
    service.from("workspaces").select("name, brand_name, brand_logo_path, brand_color" as never).eq("id", d.workspace_id).maybeSingle(),
    loadPortalHost(service as never, d.workspace_id),
  ]);
  const w = (ws ?? null) as { name?: string } | null;
  const magicUrl = host.host ? portalUrl(host.host, `/entrar/codigo?${new URLSearchParams({ e: d.email, c: d.code })}`) : null;
  const content = portalLoginCodeEmail({ brand: resolveBrand(w as never), workspaceName: w?.name ?? "", code: d.code, magicUrl, studentName: d.display_name ?? null });
  const sent = await sendTransactionalEmail({
    workspaceId: d.workspace_id,
    to: d.email,
    subject: content.subject,
    html: content.html,
    kind: "portal_login_code",
    category: "transactional",
    contactId: d.contact_id,
    relatedEntityType: "contact",
    relatedEntityId: d.contact_id,
    fromOverride: host.fromEmail,
    deps: { supabase: service },
  });
  if (!sent.ok) console.error("[portal-login] no salió el email:", sent.reason);
  return NextResponse.json({ ok: true });
}
