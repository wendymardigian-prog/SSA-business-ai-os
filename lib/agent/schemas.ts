import { z } from "zod";

/**
 * Esquemas de la configuracion heterogenea del agente (los jsonb de `agents`).
 *
 * Una sola fuente para tres usos: validar lo que llega de la pantalla (server
 * side, porque el cliente se puede saltear), normalizar lo que se lee de la
 * base (una fila vieja o editada a mano recibe los defaults en vez de romper
 * el loop), y describir los campos para la UI.
 *
 * Los defaults viven aca y no en la base: la columna arranca en '{}' y el
 * esquema completa. Cambiar un default es un deploy, no una migracion.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Formato de salida, validado en codigo antes de enviar (F22). */
export const outputFormatSchema = z.object({
  /** Largo maximo de CADA mensaje enviado. */
  maxLength: z.number().int().min(80).max(2000).default(600),
  /** Si una respuesta larga se puede partir en varios mensajes cortos. */
  allowSplit: z.boolean().default(true),
  /** Tope de partes cuando se parte. */
  maxParts: z.number().int().min(1).max(5).default(3),
  /** Emojis permitidos. Apagado, se quitan en codigo. */
  emojis: z.boolean().default(true),
  /** Idioma en que tiene que responder (codigo corto). Se pide en el prompt. */
  language: z.string().min(2).max(10).default("es"),
});
export type OutputFormat = z.infer<typeof outputFormatSchema>;

export const DEFAULT_BLOCKED_TOPICS = [
  // Precios finales y descuentos
  "precio final",
  "descuento",
  "descuentos",
  "rebaja",
  "mejor precio",
  // Reclamos
  "reclamo",
  "queja",
  "reembolso",
  "devolucion",
  "devuelvan",
  // Legales o de facturacion
  "abogado",
  "demanda",
  "denuncia",
  "factura",
  "facturacion",
  "cobro indebido",
  // Pedido explicito de hablar con una persona
  "hablar con una persona",
  "hablar con alguien",
  "hablar con un humano",
  "persona real",
  "atencion humana",
  "un asesor",
];

export const DEFAULT_FRUSTRATION_PHRASES = [
  "estafa",
  "pesimo",
  "horrible",
  "no sirve",
  "me canse",
  "harto",
  "harta",
  "una verguenza",
  "nadie responde",
];

export const DEFAULT_URGENCY_PHRASES = ["urgente", "emergencia", "ya mismo", "inmediatamente"];

const businessHoursSlotSchema = z
  .object({
    /** 0 = domingo ... 6 = sabado. */
    day: z.number().int().min(0).max(6),
    start: z.string().regex(HHMM),
    end: z.string().regex(HHMM),
  })
  .refine((slot) => slot.start < slot.end, { message: "La hora de inicio tiene que ser anterior a la de fin." });

/** Guardarrailes (F25). Todo se evalua server-side. */
export const guardrailsSchema = z.object({
  businessHours: z
    .object({
      /** Apagado = 24/7, que es el default. */
      enabled: z.boolean().default(false),
      /**
       * Los tramos se guardan como hora de pared de la zona del negocio y se
       * cortan en esa zona. Costa Rica no tiene horario de verano, asi que es
       * equivalente a guardarlo corrido a UTC, y se lee sin hacer cuentas.
       */
      slots: z.array(businessHoursSlotSchema).max(28).default([]),
      /** Fuera de horario: no responde, o responde con un aviso fijo (sin modelo). */
      outsideMode: z.enum(["silent", "notice"]).default("silent"),
      outsideMessage: z
        .string()
        .max(500)
        .default("Gracias por escribirnos. Te responde una persona del equipo en el proximo horario de atencion."),
    })
    .default({ enabled: false, slots: [], outsideMode: "silent", outsideMessage: "Gracias por escribirnos. Te responde una persona del equipo en el proximo horario de atencion." }),
  blockedTopics: z
    .object({
      enabled: z.boolean().default(true),
      phrases: z.array(z.string().min(2).max(80)).max(200).default(DEFAULT_BLOCKED_TOPICS),
    })
    .default({ enabled: true, phrases: DEFAULT_BLOCKED_TOPICS }),
  escalation: z
    .object({
      /**
       * Turnos seguidos del agente dentro de un mismo intercambio (sin un
       * silencio de mas de `exchangeGapMinutes`) sin intervencion humana. Es
       * distinto del tope por conversacion: mide un ida y vuelta que no se
       * resuelve, no el total.
       */
      maxUnresolvedTurns: z.number().int().min(1).max(50).default(6),
      exchangeGapMinutes: z.number().int().min(10).max(1440).default(120),
      frustration: z.boolean().default(true),
      frustrationPhrases: z.array(z.string().min(2).max(80)).max(100).default(DEFAULT_FRUSTRATION_PHRASES),
      urgency: z.boolean().default(true),
      urgencyPhrases: z.array(z.string().min(2).max(80)).max(100).default(DEFAULT_URGENCY_PHRASES),
    })
    .default({
      maxUnresolvedTurns: 6,
      exchangeGapMinutes: 120,
      frustration: true,
      frustrationPhrases: DEFAULT_FRUSTRATION_PHRASES,
      urgency: true,
      urgencyPhrases: DEFAULT_URGENCY_PHRASES,
    }),
});
export type Guardrails = z.infer<typeof guardrailsSchema>;

/** Lee un jsonb con defaults; si esta roto, devuelve los defaults enteros. */
export function parseWithDefaults<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  return schema.parse({});
}

/** Primer mensaje de error legible de una validacion de zod. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Configuracion invalida.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
