/**
 * Validacion de Tareas en el SERVIDOR (Extra A, F8). La UI valida tambien, pero esto manda:
 * toda accion repite estas reglas aunque el cliente ya las haya chequeado.
 *
 * Los mensajes van en castellano y se muestran tal cual.
 */

import { z } from "zod";
import { isDateOnly } from "./dates";
import { DURATION_MAX, DURATION_MIN, isTimeOfDay } from "./time";
import { cleanProjectName } from "./project";
import { TASK_LIMITS, TASK_PRIORITIES, TASK_STATUSES } from "./types";

const uuid = z.string().uuid("Identificador inválido.");

const dateOnly = z
  .string()
  .refine((v) => isDateOnly(v), "La fecha no es válida (usá AAAA-MM-DD).");

const timeOfDay = z
  .string()
  .refine((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v) && isTimeOfDay(v), "La hora no es válida (usá HH:MM).");

const durationMinutes = z
  .number("La duración no es válida.")
  .int("La duración tiene que ser en minutos enteros.")
  .min(DURATION_MIN, `La duración mínima es de ${DURATION_MIN} minutos.`)
  .max(DURATION_MAX, `La duración máxima es de ${DURATION_MAX} minutos.`);

const title = z
  .string("Escribí un título.")
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, "El título no puede estar vacío.")
      .max(TASK_LIMITS.title, `El título no puede pasar de ${TASK_LIMITS.title} caracteres.`),
  );

const description = z
  .string()
  .max(TASK_LIMITS.description, `La descripción no puede pasar de ${TASK_LIMITS.description} caracteres.`)
  .nullable();

const status = z.enum(TASK_STATUSES, "El estado no es válido.");
const priority = z.enum(TASK_PRIORITIES, "La prioridad no es válida.");

const followers = z
  .array(uuid)
  .max(TASK_LIMITS.followers, `Una tarea puede tener como máximo ${TASK_LIMITS.followers} seguidores.`)
  .transform((ids) => [...new Set(ids)]);

const project = z
  .string()
  .nullable()
  .transform((value, ctx) => {
    const cleaned = cleanProjectName(value);
    if (!cleaned.ok) {
      ctx.addIssue({ code: "custom", message: cleaned.error });
      return z.NEVER;
    }
    return { project: cleaned.project, project_key: cleaned.key };
  });

export const createTaskSchema = z
  .object({
    title,
    description: description.optional(),
    status: status.optional(),
    priority: priority.optional(),
    start_date: dateOnly.nullable().optional(),
    due_date: dateOnly.nullable().optional(),
    due_time: timeOfDay.nullable().optional(),
    duration_minutes: durationMinutes.nullable().optional(),
    owner_id: uuid.nullable().optional(),
    follower_ids: followers.optional(),
    project: project.optional(),
    contact_id: uuid.nullable().optional(),
    conversation_id: uuid.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.start_date && v.due_date && v.start_date > v.due_date) {
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "La fecha de inicio no puede ser posterior al vencimiento." });
    }
    if (v.due_time && !v.due_date) {
      ctx.addIssue({ code: "custom", path: ["due_time"], message: "La hora necesita una fecha de vencimiento." });
    }
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Campos que se pueden cambiar en una tarea existente. Todos opcionales; al menos uno. */
export const updateTaskSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    status: status.optional(),
    priority: priority.optional(),
    start_date: dateOnly.nullable().optional(),
    due_date: dateOnly.nullable().optional(),
    due_time: timeOfDay.nullable().optional(),
    duration_minutes: durationMinutes.nullable().optional(),
    owner_id: uuid.nullable().optional(),
    follower_ids: followers.optional(),
    project: project.optional(),
    contact_id: uuid.nullable().optional(),
    conversation_id: uuid.nullable().optional(),
    position: z.number().finite("La posición no es válida.").optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.keys(v).length === 0) {
      ctx.addIssue({ code: "custom", message: "No hay nada para cambiar." });
    }
    if (v.start_date && v.due_date && v.start_date > v.due_date) {
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "La fecha de inicio no puede ser posterior al vencimiento." });
    }
    // En un mismo cambio: una hora con la fecha borrada no tiene sentido. (Si la fecha no viene, la compara el nucleo con la tarea.)
    if (v.due_time && v.due_date === null) {
      ctx.addIssue({ code: "custom", path: ["due_time"], message: "La hora necesita una fecha de vencimiento." });
    }
  });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskIdSchema = uuid;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Parsea y devuelve el PRIMER mensaje de error, listo para mostrar. */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Los datos no son válidos." };
}
