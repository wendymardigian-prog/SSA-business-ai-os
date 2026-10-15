/**
 * Roles de comisión configurables (F50, F57). Viven en `workspaces.commission_settings.roles`. Puro.
 *
 *   - `key`: `^[a-z0-9_]{2,40}$`, única y NO cambia nunca (las reglas y las comisiones la guardan).
 *   - Los cuatro precargados (`system = true`) se renombran y se desactivan; no cambian de `payee`.
 *   - El negocio crea los suyos con cualquier `payee`; se desactivan, no se borran.
 */
import { COMMISSION_PAYEES, type CommissionPayee, type CommissionRole } from "./types";

export const ROLE_KEY_PATTERN = /^[a-z0-9_]{2,40}$/;
export const ROLE_NAME_MAX = 60;

/** La fecha de alta de los precargados en esta constante; el backfill de la migración usa `now()`. */
export const PRELOADED_CREATED_AT = "2026-10-15T00:00:00.000Z";

export const PRELOADED_ROLES: readonly CommissionRole[] = [
  { key: "vendedor", name: "Vendedor", payee: "sale_vendedor", active: true, system: true, created_at: PRELOADED_CREATED_AT },
  { key: "setter", name: "Setter", payee: "sale_setter", active: true, system: true, created_at: PRELOADED_CREATED_AT },
  { key: "contenido", name: "Contenido", payee: "content_assignee", active: true, system: true, created_at: PRELOADED_CREATED_AT },
  { key: "pauta", name: "Pauta", payee: "fixed", active: true, system: true, created_at: PRELOADED_CREATED_AT },
];

const PAYEE_LABELS: Record<CommissionPayee, string> = {
  sale_vendedor: "El vendedor de la venta",
  sale_setter: "El setter de la venta",
  content_assignee: "El responsable de la pieza",
  fixed: "Una persona fija",
};

/** «A quién se le paga» en palabras. */
export function payeeLabel(payee: CommissionPayee | string): string {
  return (PAYEE_LABELS as Record<string, string>)[payee] ?? String(payee);
}

export function isCommissionPayee(value: unknown): value is CommissionPayee {
  return typeof value === "string" && (COMMISSION_PAYEES as readonly string[]).includes(value);
}

/** Una copia nueva de los precargados (para el default de un workspace y para los tests). */
export function defaultCommissionRoles(): CommissionRole[] {
  return PRELOADED_ROLES.map((r) => ({ ...r }));
}

/**
 * Lee `commission_settings` (`{ roles: [...] }`, o directamente la lista) sin lanzar nunca. Lo que no se
 * entiende se descarta; las claves repetidas se quedan con la primera; un precargado que falta se agrega y
 * uno alterado vuelve a su `payee` y a `system = true`. Los precargados van primero, en su orden. Sin nada válido, los cuatro precargados.
 */
export function parseCommissionRoles(json: unknown): CommissionRole[] {
  const raw = Array.isArray(json) ? json : json && typeof json === "object" ? (json as { roles?: unknown }).roles : null;
  const seen = new Set<string>();
  const out: CommissionRole[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const key = typeof r.key === "string" ? r.key : "";
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!ROLE_KEY_PATTERN.test(key) || seen.has(key) || !name || !isCommissionPayee(r.payee)) continue;
      seen.add(key);
      out.push({
        key,
        name,
        payee: r.payee,
        active: r.active !== false,
        system: r.system === true,
        created_at: typeof r.created_at === "string" ? r.created_at : "",
      });
    }
  }
  // Los precargados siempre están y van primero, en su orden; después, los del negocio como vinieron.
  const preloaded = PRELOADED_ROLES.map((pre) => {
    const found = out.find((r) => r.key === pre.key);
    return found ? { ...found, payee: pre.payee, system: true } : { ...pre };
  });
  const own = out.filter((r) => !PRELOADED_ROLES.some((p) => p.key === r.key)).map((r) => ({ ...r, system: false }));
  return [...preloaded, ...own];
}

const SLUG_FILL = /[^a-z0-9]+/g;

/**
 * La `key` de un rol nuevo, armada con el nombre: sin tildes, en minúsculas, con guiones bajos. Si ya existe,
 * agrega `_2`, `_3`… Siempre cumple `^[a-z0-9_]{2,40}$`. «Marketing orgánico» → `marketing_organico`.
 */
export function newRoleKey(name: string, existing: ReadonlyArray<string | { key: string }>): string {
  const taken = new Set(existing.map((e) => (typeof e === "string" ? e : e.key)));
  let slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(SLUG_FILL, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (slug.length < 2) slug = "rol";
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${slug.slice(0, 40 - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type RoleIssueCode =
  | "key_removed"
  | "key_invalid"
  | "key_duplicate"
  | "name_empty"
  | "name_too_long"
  | "name_duplicate"
  | "payee_invalid"
  | "payee_changed"
  | "system_changed";

export interface RoleIssue {
  code: RoleIssueCode;
  key: string;
  message: string;
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Valida un cambio de la lista de roles (`updateCommissionRoles`). No se borra ni cambia la `key` de uno
 * existente; las claves son válidas y únicas; los nombres no se repiten (sin importar mayúsculas); un rol
 * existente no cambia de «a quién se le paga» ni de `system` (los precargados, por el plano; los del negocio
 * también, porque sus reglas y comisiones ya lo asumen); un rol nuevo nunca es de sistema.
 */
export function validateRolesUpdate(before: readonly CommissionRole[], after: readonly CommissionRole[]): { ok: boolean; issues: RoleIssue[] } {
  const issues: RoleIssue[] = [];
  const add = (code: RoleIssueCode, key: string, message: string) => issues.push({ code, key, message });

  const afterByKey = new Map<string, CommissionRole>();
  for (const role of after) {
    if (!ROLE_KEY_PATTERN.test(role.key ?? "")) add("key_invalid", String(role.key), "La clave del rol no es válida");
    else if (afterByKey.has(role.key)) add("key_duplicate", role.key, "Hay dos roles con la misma clave");
    else afterByKey.set(role.key, role);
  }

  for (const old of before) {
    const now = afterByKey.get(old.key);
    if (!now) {
      add("key_removed", old.key, `El rol «${old.name}» no se puede borrar ni cambiar de clave: desactivalo`);
      continue;
    }
    if (now.payee !== old.payee) add("payee_changed", old.key, `El rol «${old.name}» no puede cambiar de a quién se le paga`);
    if (!!now.system !== !!old.system) add("system_changed", old.key, `El rol «${old.name}» no puede cambiar su condición de rol del sistema`);
  }

  const beforeKeys = new Set(before.map((r) => r.key));
  const names = new Map<string, string>();
  for (const role of after) {
    const name = typeof role.name === "string" ? role.name.trim() : "";
    if (!name) add("name_empty", role.key, "Poné un nombre al rol");
    else if (name.length > ROLE_NAME_MAX) add("name_too_long", role.key, `El nombre puede tener hasta ${ROLE_NAME_MAX} caracteres`);
    else {
      const k = nameKey(name);
      if (names.has(k)) add("name_duplicate", role.key, `Ya hay un rol que se llama «${name}»`);
      names.set(k, role.key);
    }
    if (!isCommissionPayee(role.payee)) add("payee_invalid", role.key, "Elegí a quién se le paga");
    if (!beforeKeys.has(role.key) && role.system) add("system_changed", role.key, "Un rol nuevo no puede ser del sistema");
  }

  return { ok: issues.length === 0, issues };
}
