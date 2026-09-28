import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPublicEvent } from "@/lib/scheduling/slots-service";

/**
 * GET /api/public/scheduling/event?user=&event= (F24).
 *
 * Solo los datos publicos. El 404 no distingue "no existe" de "inactivo".
 */
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("user");
  const slug = request.nextUrl.searchParams.get("event");
  if (!username || !slug) return NextResponse.json({ reason: "bad_request" }, { status: 400 });

  const service = await createServiceClient();
  const event = await getPublicEvent(service, username, slug);
  if (!event) return NextResponse.json({ reason: "not_found" }, { status: 404 });
  return NextResponse.json({ event });
}
