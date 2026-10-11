import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/scheduling/antispam";
import { handleBeacon } from "@/lib/forms/beacon";
import { createBeaconPorts } from "@/lib/forms/server-ports";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/forms/[slug]/beacon (F14): una vista o un inicio.
 *
 * Responde SIEMPRE 204: no revela si el formulario existe ni si se escribió el
 * evento. Un error de la base tampoco se le muestra a quien mira la página.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const service = await createServiceClient();
    await handleBeacon(createBeaconPorts(service), { slug, ip: clientIp(request.headers), body });
  } catch (err) {
    console.error("[forms] beacon fallo:", err instanceof Error ? err.message : String(err));
  }
  return new NextResponse(null, { status: 204 });
}
