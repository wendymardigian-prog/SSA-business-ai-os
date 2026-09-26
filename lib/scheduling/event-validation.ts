/**
 * Validaciones puras del evento (F17, F18, F21): la sección Detalles, la
 * redirección segura, el chequeo "Listo para activar" y las confirmaciones
 * que pide la acción antes de cambiar un slug o borrar un evento.
 *
 * La lógica de redirección segura sigue la idea de `getSafeRedirectUrl.ts`
 * de Cal.diy (solo URLs absolutas y https), sin la lista de dominios propios:
 * acá la redirección es a la web del cliente, así que vale cualquier https.
 */
import { z } from "zod";
import type { ContactAssignment, EventType, EventTypeStatus, LocationType } from "./types";
import { isValidSlug, slugify } from "./slug";
import { validateLimits, type LimitsValidation } from "./limits/validation";

/** Paleta de 8 colores del editor (F18). */
export const EVENT_COLORS = [
  "#2563eb", // azul
  "#7c3aed", // violeta
  "#db2777", // rosa
  "#dc2626", // rojo
  "#ea580c", // naranja
  "#ca8a04", // amarillo
  "#16a34a", // verde
  "#0d9488", // turquesa
] as const;

export const DURATION_PRESETS = [15, 30, 45, 60] as const;
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
export const LOCATION_TEXT_MAX = 500;
export const DESCRIPTION_MAX = 5000;

export const EVENT_STATUSES: EventTypeStatus[] = ["active", "hidden", "inactive"];
export const EVENT_STATUS_LABELS: Record<EventTypeStatus, string> = {
  active: "Activo",
  hidden: "Oculto",
  inactive: "Inactivo",
};

export const LOCATION_TYPES: LocationType[] = ["google_meet", "manual"];
export const CONTACT_ASSIGNMENTS: ContactAssignment[] = ["none", "setter_if_empty", "vendedor_if_empty"];

/** Solo `https://`, absoluta, sin usuario ni contraseña embebidos. */
export function isSafeRedirectUrl(url: unknown): url is string {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export const eventDetailsSchema = z
  .object({
    title: z.string().trim().min(1, "El título es obligatorio").max(120),
    slug: z.string().refine((s) => isValidSlug(s, 1, 60), "Link inválido: minúsculas, números y guiones"),
    description_md: z.string().max(DESCRIPTION_MAX).nullable().optional(),
    duration_minutes: z.number().int().min(DURATION_MIN, `Mínimo ${DURATION_MIN} minutos`).max(DURATION_MAX, `Máximo ${DURATION_MAX} minutos`),
    color: z
      .string()
      .refine((c) => (EVENT_COLORS as readonly string[]).includes(c), "Elegí un color de la paleta")
      .nullable()
      .optional(),
    location_type: z.enum(LOCATION_TYPES as [LocationType, ...LocationType[]]),
    location_text: z.string().trim().max(LOCATION_TEXT_MAX).nullable().optional(),
    hide_location_until_booked: z.boolean().optional(),
    status: z.enum(EVENT_STATUSES as [EventTypeStatus, ...EventTypeStatus[]]),
    success_redirect_url: z
      .string()
      .trim()
      .refine(isSafeRedirectUrl, "La URL de redirección tiene que empezar con https://")
      .nullable()
      .optional(),
    redirect_with_params: z.boolean().optional(),
    contact_assignment: z.enum(CONTACT_ASSIGNMENTS as [ContactAssignment, ...ContactAssignment[]]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.location_type === "manual" && !v.location_text?.trim()) {
      ctx.addIssue({ code: "custom", path: ["location_text"], message: "Escribí la ubicación" });
    }
  });

export type EventDetailsInput = z.input<typeof eventDetailsSchema>;

export type DetailsValidation =
  | { ok: true; data: z.output<typeof eventDetailsSchema> }
  | { ok: false; errors: { path: string; message: string }[] };

export function validateEventDetails(input: unknown): DetailsValidation {
  const parsed = eventDetailsSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** Un slug sugerido desde el título, recortado a 60 (F17: "Link" autogenerado y editable). */
export function suggestSlug(title: string): string {
  return slugify(title).slice(0, 60).replace(/-+$/, "");
}

/** Lo que el chequeo necesita saber de fuera del evento. */
export interface ActivationContext {
  /** Hay un horario efectivo (el del evento o el por defecto de la persona). */
  scheduleName: string | null;
  /** Calendario destino efectivo (del evento o del perfil). */
  destinationCalendar: { name: string; provider: "google"; writable: boolean } | null;
  /** El formulario guardado valida (F20). */
  formValid: boolean;
  /** Cantidad de flujos encendidos para este evento. */
  enabledFlows: number;
}

export type ChecklistKey = "details" | "schedule" | "calendar" | "form" | "flows";
export type EditorSection =
  | "details"
  | "availability"
  | "form"
  | "limits"
  | "unavailable"
  | "flows"
  | "share";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  section: EditorSection;
  /** Los obligatorios bloquean la activación; los demás son recomendaciones. */
  required: boolean;
  ok: boolean;
  /** Motivo cuando no está ok. */
  reason: string | null;
}

export const MEET_NEEDS_GOOGLE_CALENDAR = "No se puede crear Meet sin un calendario destino de Google con permiso de escritura";

/** null si está bien; el texto de la advertencia si el evento usa Meet sin calendario de Google con escritura. */
export function meetRequiresWritableGoogleCalendar(
  eventType: Pick<EventType, "location_type">,
  ctx: Pick<ActivationContext, "destinationCalendar">,
): string | null {
  if (eventType.location_type !== "google_meet") return null;
  const cal = ctx.destinationCalendar;
  if (!cal || cal.provider !== "google" || !cal.writable) return MEET_NEEDS_GOOGLE_CALENDAR;
  return null;
}

/** La tarjeta "Listo para activar" (F18): tres obligatorios y dos recomendaciones. */
export function activationChecklist(eventType: EventType, ctx: ActivationContext): ChecklistItem[] {
  const details = validateEventDetails(eventType);
  const meetWarning = meetRequiresWritableGoogleCalendar(eventType, ctx);

  return [
    {
      key: "details",
      label: "Detalles",
      section: "details",
      required: true,
      ok: details.ok,
      reason: details.ok ? null : details.errors[0]?.message ?? "Revisá los detalles",
    },
    {
      key: "schedule",
      label: ctx.scheduleName ? `Horario: ${ctx.scheduleName}` : "Horario",
      section: "availability",
      required: true,
      ok: !!ctx.scheduleName,
      reason: ctx.scheduleName ? null : "Elegí un horario o creá el horario por defecto",
    },
    {
      key: "calendar",
      label: ctx.destinationCalendar ? `Calendario: ${ctx.destinationCalendar.name}` : "Calendario",
      section: "availability",
      required: true,
      ok: !!ctx.destinationCalendar && !meetWarning,
      reason: !ctx.destinationCalendar ? "Elegí un calendario destino" : meetWarning,
    },
    {
      key: "form",
      label: "Revisá el formulario",
      section: "form",
      required: false,
      ok: ctx.formValid,
      reason: ctx.formValid ? null : "El formulario tiene errores",
    },
    {
      key: "flows",
      label: "Encendé los flujos que quieras",
      section: "flows",
      required: false,
      ok: ctx.enabledFlows > 0,
      reason: ctx.enabledFlows > 0 ? null : "Todos los flujos están apagados",
    },
  ];
}

/** "Activar evento" habilitado solo si los obligatorios están ok; devuelve los motivos si no. */
export function canActivate(checklist: ChecklistItem[]): { ok: boolean; blockers: string[] } {
  const blockers = checklist.filter((i) => i.required && !i.ok).map((i) => i.reason ?? i.label);
  return { ok: blockers.length === 0, blockers };
}

export interface ConfirmationResult {
  ok: boolean;
  needsConfirmation: boolean;
  message: string | null;
}

/** Cambiar el slug de un evento con agendas futuras pide confirmación (F18). */
export function slugChangeNeedsConfirmation(input: {
  currentSlug: string;
  nextSlug: string;
  futureBookings: number;
  confirm?: boolean;
}): ConfirmationResult {
  if (input.currentSlug === input.nextSlug || input.futureBookings === 0 || input.confirm) {
    return { ok: true, needsConfirmation: false, message: null };
  }
  return {
    ok: false,
    needsConfirmation: true,
    message: `Hay ${input.futureBookings} agenda${input.futureBookings === 1 ? "" : "s"} futura${input.futureBookings === 1 ? "" : "s"} con el link actual. Los links de reagendar y cancelar que ya se enviaron siguen funcionando, pero el link público cambia.`,
  };
}

/** Borrar un evento con agendas futuras exige `confirm: true` (F17). */
export function deleteEventNeedsConfirmation(futureBookings: number, confirm?: boolean): ConfirmationResult {
  if (futureBookings === 0 || confirm) return { ok: true, needsConfirmation: false, message: null };
  return {
    ok: false,
    needsConfirmation: true,
    message: `Este evento tiene ${futureBookings} agenda${futureBookings === 1 ? "" : "s"} futura${futureBookings === 1 ? "" : "s"}. Se borra el evento y las agendas se conservan.`,
  };
}

/** Vuelve a exportar la validación de límites para que la acción del editor valide las dos secciones desde un solo módulo. */
export function validateEventLimits(input: unknown, now?: Date, tz?: string): LimitsValidation {
  return validateLimits(input, now, tz);
}
