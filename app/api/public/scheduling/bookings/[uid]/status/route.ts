import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { findBookingByUid } from "@/lib/scheduling/data/public-booking";

/**
 * GET /api/public/scheduling/bookings/<uid>/status
 *
 * La pagina de confirmacion pregunta por acá mientras espera el link de Meet:
 * el evento de Google lo crea un job, asi que el link aparece un momento
 * despues. La pagina consulta hasta 8 segundos y despues muestra el aviso.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const service = await createServiceClient();
  const found = await findBookingByUid(service, uid);
  if (!found) return NextResponse.json({ reason: "not_found" }, { status: 404 });
  return NextResponse.json({
    meetUrl: found.booking.meet_url,
    syncStatus: found.booking.google_sync_status,
    status: found.booking.status,
  });
}
