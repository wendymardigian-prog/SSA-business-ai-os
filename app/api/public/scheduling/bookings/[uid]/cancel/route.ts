import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelBooking } from "@/lib/scheduling/booking/cancel";
import { checkRateLimit, clientIp } from "@/lib/scheduling/antispam";

/**
 * POST /api/public/scheduling/bookings/<uid>/cancel (F28).
 *
 * El codigo de 22 caracteres es la credencial: no hay sesion. El tope por IP
 * evita que alguien pruebe codigos al azar.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Cancelar sin motivo es válido.
  }

  const service = await createServiceClient();
  const limit = await checkRateLimit(service, "create", clientIp(request.headers));
  if (!limit.allowed) return NextResponse.json({ reason: "rate_limited" }, { status: 429 });

  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
  const result = await cancelBooking(service, { uid, by: "invitee", reason });
  if (!result.ok) return NextResponse.json({ reason: result.reason, message: result.message }, { status: result.status });
  return NextResponse.json({ uid: result.uid, cancelled: true });
}
