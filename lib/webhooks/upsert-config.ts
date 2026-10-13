/**
 * La configuración del paso «Crear o actualizar contacto» (F12, F13), validada con zod al guardar
 * el flujo. PURO: lo importan el panel del editor, la validación de publicar y el nodo.
 */
import { z } from "zod";
import { CUSTOM_PREFIX, FIXED_TARGETS, isCustomTarget } from "@/lib/forms/contact-config";

export type MapSource = { path: string; fallbacks?: string[] } | { const: string };
export type Transform = "clean_phone" | "lowercase" | "trim" | "split_name";
export type TouchMedium = "external_form" | "other";

export interface MapRow {
  target: string;
  source: MapSource;
  transform?: Transform;
}

export interface UpsertContactConfig {
  /** `create_or_update` crea si no existe; `update_only` sale por «No se pudo» (`not_found`). */
  mode: "create_or_update" | "update_only";
  /** `fill_empty`: solo campos vacíos. `overwrite`: todo lo mapeado. */
  update: "fill_empty" | "overwrite";
  map: MapRow[];
  /** Los tags SIEMPRE se suman: `fixed` son ids de tags del workspace; `fromSource` es una ruta con nombres separados por coma. */
  tags: { fixed: string[]; fromSource?: MapSource };
  attribution: { map: Array<{ key: string; source: MapSource }>; autoDetect: boolean };
  touchMedium: TouchMedium;
}

export const DEFAULT_UPSERT_CONFIG: UpsertContactConfig = {
  mode: "create_or_update",
  update: "fill_empty",
  map: [],
  tags: { fixed: [] },
  attribution: { map: [], autoDetect: true },
  touchMedium: "external_form",
};

const path = z.string().trim().min(1).max(300);
const sourceSchema = z.union([
  z.object({ path, fallbacks: z.array(path).max(10).optional() }),
  z.object({ const: z.string().max(500) }),
]);

const TARGETS = new Set<string>(FIXED_TARGETS);

const rowSchema = z.object({
  target: z.string().min(1).max(120).refine((t) => TARGETS.has(t) || isCustomTarget(t), "El destino no es un campo del contacto."),
  source: sourceSchema,
  transform: z.enum(["clean_phone", "lowercase", "trim", "split_name"]).optional(),
});

export const upsertContactConfigSchema = z.object({
  mode: z.enum(["create_or_update", "update_only"]).default("create_or_update"),
  update: z.enum(["fill_empty", "overwrite"]).default("fill_empty"),
  map: z.array(rowSchema).max(60).default([]),
  tags: z
    .object({ fixed: z.array(z.string().min(1).max(60)).max(50).default([]), fromSource: sourceSchema.optional() })
    .default({ fixed: [] }),
  attribution: z
    .object({
      map: z.array(z.object({ key: z.string().min(1).max(60), source: sourceSchema })).max(60).default([]),
      autoDetect: z.boolean().default(true),
    })
    .default({ map: [], autoDetect: true }),
  touchMedium: z.enum(["external_form", "other"]).default("external_form"),
});

/** Para guardar/publicar: el primer error en palabras, o la configuración normalizada. */
export function validateUpsertContactConfig(raw: unknown): { ok: true; value: UpsertContactConfig } | { ok: false; error: string } {
  const parsed = upsertContactConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, value: parsed.data as UpsertContactConfig };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  return { ok: false, error: `${issue?.message ?? "La configuración no es válida"}${where}` };
}

/** Para ejecutar: nunca falla; lo que no se entiende vuelve a su valor por defecto. */
export function parseUpsertContactConfig(raw: unknown): UpsertContactConfig {
  const parsed = upsertContactConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data as UpsertContactConfig;
  // Un campo roto no tira todo el paso: se conserva lo que sí se entiende.
  const base = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(base.map) ? base.map.filter((r) => rowSchema.safeParse(r).success) : [];
  const retry = upsertContactConfigSchema.safeParse({ ...base, map: rows, tags: undefined, attribution: undefined });
  return retry.success ? (retry.data as UpsertContactConfig) : DEFAULT_UPSERT_CONFIG;
}

/** El destino de un campo personalizado a partir de su slug. */
export const customTarget = (slug: string): string => `${CUSTOM_PREFIX}${slug}`;
