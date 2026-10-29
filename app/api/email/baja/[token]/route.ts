import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { clientIp } from "@/lib/scheduling/antispam";
import { createServiceClient } from "@/lib/supabase/server";
import { applyUnsubscribeAction, isUnsubscribeToken } from "@/lib/email/unsubscribe-public";

/**
 * `POST /api/email/baja/<token>`: la baja en un clic (RFC 8058). La pide el cliente de correo de la persona (Gmail,
 * Yahoo) cuando toca "Desuscribirse", por la cabecera `List-Unsubscribe-Post` de cada email de marketing.
 *
 * Sin sesion e idempotente: responde 200 siempre que el token exista (aunque ya estuviera de baja, o rebote); un token
 * que no existe da 404 sin decir nada mas. No devuelve ningun dato del contacto y no loguea el token.
 *
 * `GET` (alguien que abrio el link a mano): lleva a la pagina de baja, que NO da de baja al abrirse.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
  try {
    const service = await createServiceClient();
    const outcome = await applyUnsubscribeAction(service, { token, ip: clientIp(request.headers), action: "unsubscribe", source: "one_click" });
    if (outcome.ok) return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
    if (outcome.reason === "not_found") return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    if (outcome.reason === "rate_limited") return NextResponse.json({ ok: false }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(`${appUrl()}/baja/${encodeURIComponent(token)}`, { status: 303, headers: NO_STORE });
}
