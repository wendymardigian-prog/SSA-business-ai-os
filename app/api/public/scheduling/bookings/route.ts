import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createBooking } from "@/lib/scheduling/booking/create";
import { clientIp, originFrom, pickUtm, safeReferrer } from "@/lib/scheduling/antispam";
import { isValidTimeZone } from "@/lib/timezone";
import { notifyBooking } from "@/lib/scheduling/notifications";

/**
 * POST /api/public/scheduling/bookings (F26): crea la agenda.
 *
 * El servidor vuelve a validar el horario con datos frescos. El cliente nunca
 * decide si un horario es valido.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ reason: "bad_request" }, { status: 400 });
  }

  const username = String(body.user ?? "");
  const slug = String(body.event ?? "");
  const startUtc = String(body.startUtc ?? "");
  const tz = String(body.timezone ?? "UTC");
  if (!username || !slug || Number.isNaN(Date.parse(startUtc)) || !isValidTimeZone(tz)) {
    return NextResponse.json({ reason: "bad_request" }, { status: 400 });
  }

  const service = await createServiceClient();
  const result = await createBooking(service, {
    username,
    slug,
    startUtc,
    inviteeTz: tz,
    responses: (body.responses as Record<string, unknown>) ?? {},
    origin: originFrom({ embed: typeof body.embed === "string" ? body.embed : body.embed ? "1" : null }),
    utm: pickUtm((body.utm as Record<string, string>) ?? {}),
    referrerUrl: safeReferrer(body.referrer),
    landingPage: safeReferrer(body.landingPage),
    honeypot: body.website,
    ip: clientIp(request.headers),
  });

  if (!result.ok) {
    return NextResponse.json({ reason: result.reason, message: result.message, fields: result.fields }, { status: result.status });
  }
  if (!result.uid) {
    // El campo trampa: respuesta que parece exitosa, sin nada creado.
    return NextResponse.json({ uid: "ok", startUtc: result.startUtc, endUtc: result.endUtc });
  }

  // El aviso al anfitrion no puede frenar la respuesta al invitado.
  const bookingId = result.bookingId;
  after(async () => {
    await notifyBooking(service, bookingId, "booking_created");
  });

  return NextResponse.json({
    uid: result.uid,
    startUtc: result.startUtc,
    endUtc: result.endUtc,
    redirectUrl: result.redirectUrl,
  });
}
