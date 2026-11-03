import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/scheduling/antispam";
import { handleBeacon } from "@/lib/forms/beacon";
import { createBeaconPorts } from "@/lib/forms/server-ports";
import { appUrl } from "@/lib/app-url";
import { corsHeaders, decideOrigin, selfOrigins, withCors, type OriginDecision } from "@/lib/http/cors";
import { originsForWorkspace } from "@/lib/http/workspace-origins";
import { workspaceOfPublishedForm } from "@/lib/forms/site-origins";
import { readBytesCapped } from "@/lib/http/read-capped";
import type { WebsiteSettings } from "@/lib/settings/website";

export const dynamic = "force-dynamic";

const METHODS = ["POST"];
const NO_ORIGINS: WebsiteSettings = { allowedOrigins: [] };
const BEACON_MAX_BYTES = 4 * 1024;

/** Qué hacer con el origen del pedido: los orígenes salen del workspace dueño del formulario. */
async function originFor(request: NextRequest, slug: string): Promise<{ decision: OriginDecision; headers: Record<string, string> }> {
  const origin = request.headers.get("origin");
  let settings = NO_ORIGINS;
  // Sin `Origin` (o de la propia app) no hace falta mirar la base.
  const self = selfOrigins(appUrl(), request.headers);
  const quick = decideOrigin(origin, self, NO_ORIGINS);
  if (quick === "none" || quick === "same") return { decision: quick, headers: {} };
  try {
    const service = await createServiceClient();
    const workspaceId = await workspaceOfPublishedForm(service, slug);
    if (workspaceId) settings = await originsForWorkspace(service, workspaceId);
  } catch {
    settings = NO_ORIGINS;
  }
  const decision = decideOrigin(origin, self, settings);
  return { decision, headers: corsHeaders(decision, origin, METHODS) };
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const { headers } = await originFor(request, slug);
  return new NextResponse(null, { status: 204, headers: withCors(headers) });
}

/**
 * POST /api/public/forms/[slug]/beacon (F14): una vista o un inicio.
 *
 * Responde SIEMPRE 204: no revela si el formulario existe ni si se escribió el
 * evento. Un error de la base tampoco se le muestra a quien mira la página.
 * Desde la web de un cliente: con CORS si el origen está permitido; desde un origen
 * que no está, no se cuenta nada.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  let headers: Record<string, string> = {};
  try {
    const { slug } = await context.params;
    const origin = await originFor(request, slug);
    headers = origin.headers;
    if (origin.decision !== "denied") {
      // Un beacon son tres campos: más de 4 KB no es un beacon (no se lee entero).
      let body: unknown = null;
      const read = await readBytesCapped(request, BEACON_MAX_BYTES);
      if (read.ok) {
        try {
          body = JSON.parse(new TextDecoder().decode(read.bytes));
        } catch {
          body = null;
        }
      }
      const service = await createServiceClient();
      await handleBeacon(createBeaconPorts(service), { slug, ip: clientIp(request.headers), body });
    }
  } catch (err) {
    console.error("[forms] beacon fallo:", err instanceof Error ? err.message : String(err));
  }
  return new NextResponse(null, { status: 204, headers: withCors(headers) });
}
