/**
 * El `changes { campo: { old, new } }` de una regla o una comisión, con valores JSON de verdad. `diffFields`
 * (lib/audit.ts) lo pasa todo a texto, y las condiciones de una regla son un objeto: acá se comparan por su
 * JSON canónico y se guardan tal cual. Puro.
 */
import type { AuditChanges } from "@/lib/audit";
import type { Json } from "@/lib/types/database";

/** El JSON canónico (claves ordenadas, `undefined` y vacío = null): sirve para comparar dos valores. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === "") return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const asJson = (value: unknown): Json => (value === undefined || value === "" ? null : (value as Json));

/** Lo que cambió entre `before` y `after`, solo en las claves pedidas; null si no cambió nada. */
export function jsonDiff(before: Record<string, unknown>, after: Record<string, unknown>, keys: readonly string[]): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const key of keys) {
    if (canonicalJson(before[key]) === canonicalJson(after[key])) continue;
    changes[key] = { old: asJson(before[key]), new: asJson(after[key]) };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Una alta: todo lo que se cargó (sin lo vacío). */
export function jsonCreated(after: Record<string, unknown>, keys: readonly string[]): AuditChanges | null {
  return jsonDiff({}, after, keys);
}
