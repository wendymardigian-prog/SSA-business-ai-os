import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/scheduling/antispam";
import { appUrl } from "@/lib/app-url";
import { corsHeaders, decideOrigin, selfOrigins, withCors } from "@/lib/http/cors";
import { readBytesCapped } from "@/lib/http/read-capped";
import { workspaceBySlug } from "@/lib/http/workspace-origins";
import { requestUnsubscribeLink, UNSUBSCRIBE_LINK_METHODS } from "@/lib/email/unsubscribe-link";
import { createUnsubscribeLinkPorts } from "@/lib/email/unsubscribe-link-ports";

export const dynamic = "force-dynamic";

/** Un pedido son tres campos cortos: más de 4 KB no se lee. */
const MAX_BYTES = 4 * 1024;

/**
 * OPTIONS: el "¿puedo?" del navegador. 204 siempre; con CORS solo si el origen está en la
 * lista del workspace. El slug del workspace viaja en el cuerpo (que un preflight no trae),
 * así que también se acepta en la query: `?workspace=<slug>`. Sin él, sin CORS.
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const slug = request.nextUrl.searchParams.get("workspace") ?? "";
  let headers: Record<string, string> = {};
  try {
    const service = await createServiceClient();
    const workspace = slug ? await workspaceBySlug(service as never, slug) : null;
    if (workspace) {
      const decision = decideOrigin(origin, selfOrigins(appUrl(), request.headers), workspace.settings);
      headers = corsHeaders(decision, origin, UNSUBSCRIBE_LINK_METHODS);
    }
  } catch {
    headers = {};
  }
  return new NextResponse(null, { status: 204, headers: withCors(headers) });
}

/**
 * POST /api/public/email/unsubscribe-link: "mandame un link de baja nuevo".
 * URL `?workspace=<slug>` (lo necesita el preflight) y body JSON `{ email, honeypot }` (el
 * `workspace` también se acepta en el body). Responde siempre `{ ok: true }` (salvo un
 * cuerpo ilegible, 400); el envío va después de responder. Reglas en
 * `lib/email/unsubscribe-link.ts`.
 */
export async function POST(request: NextRequest) {
  const read = await readBytesCapped(request, MAX_BYTES);
  let body: unknown = undefined;
  if (read.ok) {
    try {
      body = JSON.parse(new TextDecoder().decode(read.bytes));
    } catch {
      body = undefined;
    }
  }

  const service = await createServiceClient();
  const outcome = await requestUnsubscribeLink(createUnsubscribeLinkPorts(service), {
    body,
    ip: clientIp(request.headers),
    origin: request.headers.get("origin"),
    self: selfOrigins(appUrl(), request.headers),
    queryWorkspace: request.nextUrl.searchParams.get("workspace"),
  });
  if (outcome.later) after(outcome.later);
  return NextResponse.json(outcome.body, { status: outcome.status, headers: withCors(outcome.headers) });
}
