/**
 * La pagina de la agenda del invitado (F27): `/calendario/agenda/<uid>`.
 *
 * Es la misma para los cuatro casos: recien agendada, por venir, ya pasada y
 * cancelada. El codigo de 22 caracteres es la credencial, asi que no hay
 * sesion; por eso la pagina no se indexa y no muestra nada del negocio mas
 * alla de lo que el invitado ya sabe.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/server";
import { findBookingByUid, toPublicBooking } from "@/lib/scheduling/data/public-booking";
import { BookingView } from "@/components/scheduling/booker/booking-view";
import { googleCalendarLink, outlookLink } from "@/lib/scheduling/ics";

export const metadata: Metadata = { title: "Tu reunión", robots: { index: false, follow: false } };

export default async function AgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { uid } = await params;
  const query = await searchParams;
  const service = await createServiceClient();
  const found = await findBookingByUid(service, uid);
  if (!found) notFound();

  const booking = toPublicBooking(found);
  const theme = typeof query.theme === "string" && (query.theme === "light" || query.theme === "dark") ? query.theme : undefined;

  return (
    <BookingView
      booking={booking}
      // Recién agendada: se espera el link de Meet unos segundos.
      justBooked={found.booking.google_sync_status === "pending" && booking.actions.state === "upcoming"}
      // Si no hay calendario conectado no sale ninguna invitación de Google:
      // decirlo igual sería prometerle al invitado algo que no va a llegar.
      sendsGoogleInvite={found.booking.google_sync_status !== "not_applicable" && found.booking.google_sync_status !== "failed"}
      calendarLinks={{
        google: googleCalendarLink(found.booking),
        outlook: outlookLink(found.booking),
        ics: `/api/public/scheduling/bookings/${encodeURIComponent(booking.uid)}/ics`,
      }}
      theme={theme}
    />
  );
}
