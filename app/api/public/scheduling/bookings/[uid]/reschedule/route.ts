import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { rescheduleBooking } from "@/lib/scheduling/booking/reschedule";
import { checkRateLimit, clientIp } from "@/lib/scheduling/antispam";

/**
 * POST /api/public/scheduling/bookings/<uid>/reschedule (F28).
 *
 * El horario nuevo se vuelve a validar en el servidor, con Google fresco y
 * excluyendo la propia agenda.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ reason: "bad_request" }, { status: 400 });
  }

  const startUtc = String(body.startUtc ?? "");
  if (Number.isNaN(Date.parse(startUtc))) return NextResponse.json({ reason: "bad_request" }, { status: 400 });

  const service = await createServiceClient();
  const limit = await checkRateLimit(service, "create", clientIp(request.headers));
  if (!limit.allowed) return NextResponse.json({ reason: "rate_limited" }, { status: 429 });

  const result = await rescheduleBooking(service, {
    uid,
    startUtc,
    by: "invitee",
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
  });
  if (!result.ok) return NextResponse.json({ reason: result.reason, message: result.message }, { status: result.status });
  return NextResponse.json({ uid: result.uid, startUtc: result.startUtc, endUtc: result.endUtc });
}
