/**
 * La configuración de un reporte de fin de día (`forms.eod_config`), validada con
 * Zod. La variante se elige al crear y NO cambia después (como el tipo).
 */
import { z } from "zod";
import type { EodVariant } from "./types";

export const EOD_VARIANTS = ["setter", "general"] as const;
export const EOD_REPORT_MODES = ["single", "editable"] as const;
export type EodReportMode = (typeof EOD_REPORT_MODES)[number];
export const AUDIENCE_MODES = ["all", "users", "roles"] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

export const MAX_PAST_DAYS = 31;
export const DEFAULT_PAST_DAYS = 7;
export const MAX_ROLE_LABEL = 40;

const uuid = z.string().uuid();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const eodConfigSchema = z.object({
  variant: z.enum(EOD_VARIANTS),
  roleLabel: z.string().trim().min(1, "Falta el nombre del rol").max(MAX_ROLE_LABEL),
  audience: z.object({
    mode: z.enum(AUDIENCE_MODES),
    userIds: z.array(uuid).max(500).default([]),
    roleIds: z.array(uuid).max(100).default([]),
  }),
  reportMode: z.enum(EOD_REPORT_MODES),
  pastDays: z.number().int().min(0).max(MAX_PAST_DAYS),
  notify: z.object({ userIds: z.array(uuid).max(100).default([]) }),
  reminder: z.object({
    enabled: z.boolean(),
    time: z.string().regex(TIME_RE, "La hora va como HH:MM"),
  }),
});

export type EodConfig = z.infer<typeof eodConfigSchema>;

export function defaultEodConfig(variant: EodVariant, roleLabel?: string): EodConfig {
  return {
    variant,
    roleLabel: roleLabel?.trim() || (variant === "setter" ? "Setter" : "Equipo"),
    audience: { mode: "all", userIds: [], roleIds: [] },
    reportMode: "single",
    pastDays: DEFAULT_PAST_DAYS,
    notify: { userIds: [] },
    reminder: { enabled: false, time: "18:00" },
  };
}

export type EodConfigResult = { ok: true; config: EodConfig } | { ok: false; errors: string[] };

export function validateEodConfig(input: unknown): EodConfigResult {
  const parsed = eodConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`),
    };
  }
  const config = parsed.data;
  const errors: string[] = [];
  if (config.audience.mode === "users" && config.audience.userIds.length === 0) {
    errors.push("Elegí al menos una persona que complete el reporte");
  }
  if (config.audience.mode === "roles" && config.audience.roleIds.length === 0) {
    errors.push("Elegí al menos un rol que complete el reporte");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}

/**
 * Una configuración nueva sobre la guardada: la variante sale SIEMPRE de la guardada.
 * Pedir otra variante es un error (no se ignora en silencio).
 */
export function mergeEodConfig(stored: EodConfig, incoming: unknown): EodConfigResult {
  const variant = (incoming as { variant?: unknown } | null)?.variant;
  if (variant !== undefined && variant !== stored.variant) {
    return { ok: false, errors: ["La variante de un reporte de fin de día no se puede cambiar después de crearlo"] };
  }
  return validateEodConfig({ ...(incoming as object), variant: stored.variant });
}

/** Lee la configuración guardada; si no es válida, null (nunca lanza). */
export function parseStoredEodConfig(input: unknown): EodConfig | null {
  const parsed = eodConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
