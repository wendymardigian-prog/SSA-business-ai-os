import { createServiceClient } from "@/lib/supabase/server";
import { findBookingByUid } from "@/lib/scheduling/data/public-booking";
import { buildIcs, icsFilename } from "@/lib/scheduling/ics";
import { bookingPublicUrl, publicBaseUrl } from "@/lib/scheduling/public-url";

/**
 * GET /api/public/scheduling/bookings/<uid>/ics (F27).
 *
 * El archivo para agregar la reunion a cualquier calendario. Una agenda
 * cancelada sale con METHOD:CANCEL, asi el calendario la borra sola.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const service = await createServiceClient();
  const found = await findBookingByUid(service, uid);
  if (!found) return new Response("No encontré esa reunión.", { status: 404 });

  const { booking, profile, workspace } = found;
  const base = publicBaseUrl(workspace);
  const ics = buildIcs(booking, {
    domain: new URL(base).host,
    description: [profile?.display_name ? `Con ${profile.display_name}.` : null, booking.meet_url].filter(Boolean).join(" ") || null,
    url: bookingPublicUrl(base, booking.uid),
  });

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${icsFilename(booking)}"`,
      "cache-control": "no-store",
    },
  });
}
