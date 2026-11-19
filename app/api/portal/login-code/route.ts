// @plantilla-quitar(servicios)
/**
 * El portal de estudiantes pide el código para entrar (B2, F202). Solo el servidor del portal: el pedido viene firmado
 * con `PORTAL_SHARED_SECRET` (lib/portal-admin/portal-signature.ts). SSA emite el código en la base
 * (`app_servicio.portal_login_code_issue`, solo service_role) y lo manda con el Resend del negocio, como la invitación.
 *
 * La respuesta es SIEMPRE la misma exista o no el email (no se revela quién es estudiante), salvo el tope (6.º pedido
 * en una hora): `{ ok: false, reason: "rate_limited" }`. Los logs no llevan ni el email ni el código.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { loadPortalHost, portalUrl } from "@/lib/portal-admin/load";
import { portalLoginCodeEmail } from "@/lib/email/templates";
import { resolveBrand } from "@/lib/brand";
import { sendTransactionalEmail } from "@/lib/email/send";
import { readTextCapped } from "@/lib/http/read-capped";

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

  // El email sale DESPUÉS de responder: así la respuesta tarda lo mismo exista o no la cuenta, y nadie averigua
  // quién es estudiante midiendo el tiempo.
  const { code, email, workspace_id: workspaceId, contact_id: contactId, display_name: studentName } = d;
  after(async () => {
    try {
      const [{ data: ws }, host] = await Promise.all([
        service.from("workspaces").select("name, brand_name, brand_logo_path, brand_color" as never).eq("id", workspaceId).maybeSingle(),
        loadPortalHost(service as never, workspaceId),
      ]);
      const w = (ws ?? null) as { name?: string } | null;
      const magicUrl = host.host ? portalUrl(host.host, `/entrar/codigo?${new URLSearchParams({ e: email, c: code })}`) : null;
      const content = portalLoginCodeEmail({ brand: resolveBrand(w as never), workspaceName: w?.name ?? "", code, magicUrl, studentName: studentName ?? null });
      const sent = await sendTransactionalEmail({
        workspaceId,
        to: email,
        subject: content.subject,
        html: content.html,
        kind: "portal_login_code",
        category: "transactional",
        contactId,
        relatedEntityType: "contact",
        relatedEntityId: contactId,
        fromOverride: host.fromEmail,
        deps: { supabase: service },
      });
      if (!sent.ok) console.error("[portal-login] no salió el email:", sent.reason);
    } catch (err) {
      console.error("[portal-login] no salió el email:", err instanceof Error ? err.message : String(err));
    }
  });
  return NextResponse.json({ ok: true });
}
