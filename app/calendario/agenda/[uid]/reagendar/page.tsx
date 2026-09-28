/**
 * Reagendar por el invitado (F28): `/calendario/agenda/<uid>/reagendar`.
 *
 * Es el mismo booker de siempre, con dos diferencias: el formulario no se
 * vuelve a pedir (los datos ya estan) y el horario propio no cuenta como
 * ocupado. Lo segundo lo resuelve el servidor con `excludeBookingId`.
 *
 * Una agenda cancelada o que ya empezo no se reagenda: se vuelve a la pagina
 * de la agenda, que explica por que.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/server";
import { findBookingByUid, toPublicBooking } from "@/lib/scheduling/data/public-booking";
import { getPublicEvent, getPublicSlots } from "@/lib/scheduling/slots-service";
import { parseEmbedParams } from "@/lib/scheduling/booker/embed-params";
import { monthOf } from "@/lib/scheduling/booker/month-view";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { Booker } from "@/components/scheduling/booker/booker";
import type { BookingField, SlotsByDate, UnavailableMessages } from "@/lib/scheduling/types";

export const metadata: Metadata = { title: "Cambiar la fecha", robots: { index: false, follow: false } };

export default async function ReagendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { uid } = await params;
  const embed = parseEmbedParams(await searchParams);

  const service = await createServiceClient();
  const found = await findBookingByUid(service, uid);
  if (!found) notFound();

  const booking = toPublicBooking(found);
  if (!booking.actions.canReschedule) redirect(`/calendario/agenda/${encodeURIComponent(uid)}`);
  if (!booking.username) notFound();

  const event = await getPublicEvent(service, booking.username, booking.eventSlug);
  if (!event) notFound();

  const timezone = booking.inviteeTimezone;
  const today = dateInTz(new Date(), timezone);
  const from = new Date(`${today}T00:00:00.000Z`).toISOString();
  const to = new Date(new Date(from).getTime() + 35 * 24 * 60 * 60 * 1000).toISOString();
  const slots = await getPublicSlots(service, {
    username: booking.username,
    slug: booking.eventSlug,
    from,
    to,
    timezone,
    excludeBookingId: found.booking.id,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6">
      <p className="mb-3 rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        Estás cambiando la fecha de <strong className="text-foreground">{booking.title}</strong>. Elegí el horario nuevo y listo: no hace falta llenar el
        formulario otra vez.
      </p>
      <Booker
        username={booking.username}
        slug={booking.eventSlug}
        event={{
          title: event.title,
          description: event.description,
          durationMinutes: event.durationMinutes,
          locationType: event.locationType,
          locationText: event.locationText,
          color: event.color,
          hostName: event.hostName,
          hostAvatarUrl: event.hostAvatarUrl,
          hostWelcome: null,
          timeFormat: event.timeFormat,
          fields: (event.fields as BookingField[]) ?? [],
          unavailableMessages: (event.unavailableMessages as UnavailableMessages | null) ?? null,
        }}
        initialTimezone={timezone}
        initialMonth={monthOf(today)}
        initialSlots={slots.ok ? slots.slots : ({} as SlotsByDate)}
        initialUnavailable={slots.ok ? null : slots.reason === "temporarily_unavailable" ? "unavailable" : "load_error"}
        embed={embed}
        rescheduleUid={uid}
      />
    </div>
  );
}
