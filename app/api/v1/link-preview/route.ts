import { NextRequest, NextResponse } from "next/server";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { getMemberAction } from "@/lib/auth/guards";
import { canUseInbox } from "@/lib/inbox/channel-access";
import { getLinkPreview, MAX_LINK_PREVIEW_URL_LENGTH, peekLinkPreview } from "@/lib/link-preview/fetch";
import { createServiceClient } from "@/lib/supabase/server";

const LIMIT_PER_MINUTE = 60;

/**
 * POST /api/v1/link-preview — la tarjeta de un link, para quien usa la bandeja.
 *
 * Va por POST y no por GET con `?url=`: la direccion puede llevar un token y una query string termina en los logs.
 * Lo que ya esta en memoria no cuenta para el tope. Un 429 lo maneja el navegador sin guardarlo como "no tiene tarjeta".
 */
export async function POST(request: NextRequest) {
  const ctx = await getMemberAction();
  if (!ctx) return NextResponse.json({ error: "Tu sesión venció. Volvé a entrar." }, { status: 401 });
  if (!canUseInbox(ctx.permissions)) return NextResponse.json({ error: "Sin permiso." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = body?.url;
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_LINK_PREVIEW_URL_LENGTH) {
    return NextResponse.json({ error: "Link inválido." }, { status: 400 });
  }

  const known = peekLinkPreview(url);
  if (known !== undefined) return NextResponse.json({ preview: known });

  const service = await createServiceClient();
  const limit = await checkLimit(service, { key: `link-preview:${ctx.user.id}`, max: LIMIT_PER_MINUTE, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "Demasiados pedidos." }, { status: 429 });

  return NextResponse.json({ preview: await getLinkPreview(url) });
}
