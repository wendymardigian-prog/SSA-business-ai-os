import Link from "next/link";
import { Section, EmptyHint } from "./ui";
import { StatusChip } from "@/components/scheduling/bookings/status-chip";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import type { BookingStatus } from "@/lib/scheduling/types";

export interface ContactBooking {
  id: string;
  title: string;
  startAt: string;
  status: BookingStatus;
  hostName: string | null;
}

/**
 * Las reuniones de este contacto (F38).
 *
 * Se muestran todas, no solo las que vienen: saber que ya hubo una llamada
 * que terminó en no-show cambia lo que se le escribe hoy. Lo que se ve acá lo
 * decide RLS (`can_see_booking`), igual que en la pantalla de Agendas: un
 * Member no ve las reuniones de otra persona ni desde la ficha.
 */
export function ContactBookingsSection({
  bookings,
  timezone,
  timeFormat,
}: {
  bookings: ContactBooking[];
  timezone: string;
  timeFormat: "12h" | "24h";
}) {
  return (
    <Section title="Reuniones">
      {bookings.length === 0 ? (
        <EmptyHint>Este contacto todavía no agendó ninguna reunión.</EmptyHint>
      ) : (
        <ul className="divide-y divide-border">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link href={`/dashboard/agenda?agenda=${b.id}`} className="flex flex-wrap items-center gap-2 py-2.5 text-sm hover:bg-muted/60">
                <span className="tabular-nums">{capitalize(formatDateTimeWithZone(b.startAt, timezone, timeFormat))}</span>
                <span className="text-muted-foreground">·</span>
                <span className="min-w-0 truncate">{b.title}</span>
                {b.hostName && <span className="text-xs text-muted-foreground">con {b.hostName}</span>}
                <span className="ml-auto">
                  <StatusChip status={b.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
