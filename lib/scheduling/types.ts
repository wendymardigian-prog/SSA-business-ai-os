/**
 * Tipos del módulo de agendamiento (Etapa 4), según §9 del plano.
 *
 * Son tipos propios del módulo, no los generados desde la base: la tanda A se
 * construye antes de que existan las tablas. Cuando la Tanda B genere
 * `lib/types/database.ts`, estos tipos se mantienen como la "forma" que
 * esperan las funciones puras, y la capa de datos adapta las filas a ellos.
 *
 * Convenciones:
 * - Todo instante va en UTC como string ISO (`2026-10-06T18:30:00.000Z`).
 * - Las reglas de disponibilidad van en hora de pared (`"09:00"`) más la zona
 *   IANA del horario.
 * - Una fecha suelta es `"YYYY-MM-DD"` en la zona que corresponda.
 */

/** Hora de pared `HH:mm`. `"24:00"` es válido solo como fin de rango. */
export type WallTime = string;

/** Fecha sin hora, `YYYY-MM-DD`. */
export type DateString = string;

/** Un rango de hora de pared dentro de un día. */
export interface TimeRange {
  start: WallTime;
  end: WallTime;
}

/** Día de la semana como clave del jsonb: 0 = domingo … 6 = sábado. */
export type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

/**
 * `availability_schedules.weekly_hours`: rangos por día. Día ausente o con
 * lista vacía = no trabaja.
 */
export type WeeklyHours = Partial<Record<WeekdayKey, TimeRange[]>>;

/**
 * `availability_schedules.date_overrides`: excepción de un día. `ranges`
 * vacío = no disponible todo el día. Reemplaza la regla semanal de ese día.
 */
export interface DateOverride {
  date: DateString;
  ranges: TimeRange[];
}

export interface AvailabilitySchedule {
  id: string;
  user_id: string;
  name: string;
  /** Zona IANA en la que están escritas las reglas. */
  timezone: string;
  is_default: boolean;
  weekly_hours: WeeklyHours;
  date_overrides: DateOverride[];
}

export type OutOfOfficeReason = "vacation" | "travel" | "sick" | "other";

/** `out_of_office`: un período bloqueado de la persona, en UTC. */
export interface OutOfOffice {
  id?: string;
  user_id?: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  reason: OutOfOfficeReason;
  note?: string | null;
}

export type LocationType = "google_meet" | "manual";
export type EventTypeStatus = "active" | "hidden" | "inactive";
export type PeriodType = "rolling_calendar" | "rolling_business" | "range" | "unlimited";
export type ContactAssignment = "none" | "setter_if_empty" | "vendedor_if_empty";
export type TimeFormat = "12h" | "24h";

/** Tipos de campo del formulario de reserva (F20). */
export type BookingFieldType =
  | "name"
  | "email"
  | "phone"
  | "short_text"
  | "long_text"
  | "select"
  | "multiselect";

export type BookingFieldVisibility = "required" | "optional" | "hidden";

/** Un campo de `event_types.booking_fields` (jsonb). */
export interface BookingField {
  id: string;
  type: BookingFieldType;
  /** Los tres campos del sistema (name, email, phone). */
  system: boolean;
  label: string;
  help?: string;
  placeholder?: string;
  visibility: BookingFieldVisibility;
  /** Solo para select y multiselect: 2 a 50 opciones. */
  options?: string[];
  /** Clave de la respuesta y de la variable `answers.<identifier>`. Única. */
  identifier: string;
  /** Mapeo opcional a un custom field del contacto (nice-to-have). */
  contactFieldId?: string | null;
}

export type UnavailableKey = "no_slots" | "unavailable" | "load_error";
export type CtaKind = "whatsapp" | "email" | "link";

export interface UnavailableCta {
  label: string;
  kind: CtaKind;
  /** Número internacional, dirección de email o URL https. */
  value: string;
  /** Mensaje precargado (WhatsApp) o asunto (email). Admite {{event_title}} y {{host_name}}. */
  prefill?: string;
}

export interface UnavailableMessage {
  title: string;
  body: string;
  cta?: UnavailableCta;
}

/** `event_types.unavailable_messages` (F58). null = textos por defecto. */
export interface UnavailableMessages {
  same_for_all: boolean;
  no_slots?: UnavailableMessage;
  unavailable?: UnavailableMessage;
  load_error?: UnavailableMessage;
}

/**
 * `event_types` (§9.3). Solo los campos que usan las funciones puras; la
 * Tanda B suma los ids de relaciones que necesite.
 */
export interface EventType {
  id: string;
  owner_user_id: string;
  category_id?: string;
  title: string;
  slug: string;
  description_md?: string | null;
  duration_minutes: number;
  color?: string | null;
  location_type: LocationType;
  location_text?: string | null;
  hide_location_until_booked?: boolean;
  status: EventTypeStatus;
  schedule_id?: string | null;
  destination_calendar_id?: string | null;
  conflict_calendar_ids?: string[];
  before_buffer_minutes: number;
  after_buffer_minutes: number;
  minimum_notice_minutes: number;
  /** null = igual a la duración. */
  slot_interval_minutes?: number | null;
  max_per_day?: number | null;
  max_per_week?: number | null;
  period_type: PeriodType;
  period_days?: number | null;
  period_start_date?: DateString | null;
  period_end_date?: DateString | null;
  contact_assignment?: ContactAssignment;
  success_redirect_url?: string | null;
  redirect_with_params?: boolean;
  booking_fields: BookingField[];
  unavailable_messages?: UnavailableMessages | null;
}

/** Los 11 estados de F32. La lista canónica vive en `booking-status.ts`. */
export type BookingStatus =
  | "scheduled"
  | "confirmed"
  | "rescheduled"
  | "no_show"
  | "followup_warm"
  | "followup_cold"
  | "sale"
  | "not_qualified"
  | "cancelled_not_qualified"
  | "cancelled_no_response"
  | "cancelled_other";

export type StatusGroup = "active" | "no_show" | "outcome" | "cancelled";

export type BookingOrigin = "public_page" | "embed" | "manual" | "agent" | "api";
export type CancelledByType = "invitee" | "host" | "system";

/** `bookings` (§9.4). Campos que leen las funciones puras. */
export interface Booking {
  id: string;
  uid: string;
  event_type_id: string;
  host_user_id: string;
  contact_id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  booker_name?: string | null;
  booker_email?: string | null;
  booker_phone?: string | null;
  /** Zona IANA del invitado al agendar. */
  booker_timezone?: string | null;
  /** Zona IANA del anfitrión al agendar. */
  host_timezone?: string | null;
  location_type?: LocationType | null;
  location_text?: string | null;
  meet_url?: string | null;
  responses?: Record<string, unknown> | null;
  origin?: BookingOrigin;
  reschedule_count?: number;
  cancelled_at?: string | null;
  cancelled_by_type?: CancelledByType | null;
  cancellation_reason?: string | null;
  ical_uid?: string | null;
  category_snapshot?: {
    area_id?: string | null;
    area_name?: string | null;
    type_id?: string | null;
    type_name?: string | null;
  } | null;
  event_color?: string | null;
}

/** Un intervalo cerrado-abierto en UTC, como lo devuelve Google o la base. */
export interface UtcInterval {
  startUtc: string;
  endUtc: string;
}

/** Un horario ofrecido al invitado. */
export type Slot = UtcInterval;

/** Salida del motor: horarios agrupados por fecha en la zona del invitado. */
export type SlotsByDate = Record<DateString, Slot[]>;
