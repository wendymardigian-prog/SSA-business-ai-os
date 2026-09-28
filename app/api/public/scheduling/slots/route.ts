import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPublicSlots } from "@/lib/scheduling/slots-service";
import { checkRateLimit, clientIp } from "@/lib/scheduling/antispam";
import { isValidTimeZone } from "@/lib/timezone";

/**
 * GET /api/public/scheduling/slots?user=&event=&from=&to=&tz= (F24).
 *
 * Sin sesion. Service role con campos filtrados: la respuesta no lleva ids de
 * calendarios, emails del anfitrion ni la configuracion de limites.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const username = params.get("user");
  const slug = params.get("event");
  const from = params.get("from");
  const to = params.get("to");
  const tz = params.get("tz") ?? "UTC";

  if (!username || !slug || !from || !to) {
    return NextResponse.json({ reason: "bad_request" }, { status: 400 });
  }
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ reason: "bad_request" }, { status: 400 });
  }
  if (!isValidTimeZone(tz)) {
    return NextResponse.json({ reason: "bad_request" }, { status: 400 });
  }

  const service = await createServiceClient();

  const limit = await checkRateLimit(service, "slots", clientIp(request.headers));
  if (!limit.allowed) return NextResponse.json({ reason: "rate_limited" }, { status: 429 });

  const result = await getPublicSlots(service, { username, slug, from, to, timezone: tz });

  if (!result.ok) {
    if (result.reason === "not_found") return NextResponse.json({ reason: "not_found" }, { status: 404 });
    if (result.reason === "range_too_wide") return NextResponse.json({ reason: "range_too_wide" }, { status: 400 });
    // Google caido o perfil no disponible: 200 con el motivo, sin detalles.
    return NextResponse.json({ slots: {}, unavailableReason: "temporarily_unavailable" });
  }

  return NextResponse.json({ slots: result.slots });
}
