import type { BookingField, UnavailableMessages } from "@/lib/scheduling/types";

/** Lo que la pagina publica sabe del evento. Nada interno (§15). */
export interface BookerEvent {
  title: string;
  description: string | null;
  durationMinutes: number;
  locationType: "google_meet" | "manual";
  locationText: string | null;
  color: string | null;
  hostName: string;
  hostAvatarUrl: string | null;
  hostWelcome: string | null;
  timeFormat: "12h" | "24h";
  fields: BookingField[];
  unavailableMessages: UnavailableMessages | null;
}
