/**
 * La pagina publica del evento (F25): `/calendario/<usuario>/<slug>`.
 *
 * Server Component: el HTML inicial ya trae el evento y el primer mes de
 * horarios, asi el invitado no ve una pantalla vacia esperando una consulta.
 * Los meses siguientes los pide el componente.
 *
 * Un evento inactivo o inexistente es 404, sin distinguir cual de los dos.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/server";
import { getPublicEvent, getPublicSlots } from "@/lib/scheduling/slots-service";
import { parseEmbedParams } from "@/lib/scheduling/booker/embed-params";
import { monthOf } from "@/lib/scheduling/booker/month-view";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { Booker } from "@/components/scheduling/booker/booker";
import type { BookingField, SlotsByDate, UnavailableMessages } from "@/lib/scheduling/types";

type Params = Promise<{ usuario: string; evento: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { usuario, evento } = await params;
  const service = await createServiceClient();
  const found = await getPublicEvent(service, usuario, evento);
  if (!found) return { title: { absolute: "No encontrado" } };
  return {
    title: { absolute: `${found.title} · ${found.hostName}` },
    description: found.description ?? undefined,
    robots: { index: false, follow: false },
  };
}

/** El rango del primer pedido: desde hoy, 35 dias (cubre el mes visible). */
function initialRange(timezone: string, now = new Date()) {
  const today = dateInTz(now, timezone);
  const from = new Date(`${today}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 35 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString(), today };
}

export default async function EventoPublicoPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { usuario, evento } = await params;
  const query = await searchParams;
  const embed = parseEmbedParams(query);

  const service = await createServiceClient();
  const event = await getPublicEvent(service, usuario, evento);
  if (!event) notFound();

  // La zona de arranque: la que pida el embed, si no la del anfitrión. El
  // componente la cambia a la del navegador en cuanto carga.
  const timezone = embed.timezone ?? event.hostTimezone;
  const { from, to, today } = initialRange(timezone);
  const slots = await getPublicSlots(service, { username: usuario, slug: evento, from, to, timezone });

  const initialSlots: SlotsByDate = slots.ok ? slots.slots : {};
  const unavailable = slots.ok ? null : slots.reason === "temporarily_unavailable" ? "unavailable" : "load_error";

  return (
    <Booker
      username={usuario}
      slug={evento}
      event={{
        title: event.title,
        description: event.description,
        durationMinutes: event.durationMinutes,
        locationType: event.locationType,
        locationText: event.locationText,
        color: event.color,
        hostName: event.hostName,
        hostAvatarUrl: event.hostAvatarUrl,
        hostWelcome: event.hostWelcome,
        timeFormat: event.timeFormat,
        fields: (event.fields as BookingField[]) ?? [],
        unavailableMessages: (event.unavailableMessages as UnavailableMessages | null) ?? null,
      }}
      initialTimezone={timezone}
      initialMonth={monthOf(today)}
      initialSlots={initialSlots}
      initialUnavailable={unavailable}
      embed={embed}
    />
  );
}
