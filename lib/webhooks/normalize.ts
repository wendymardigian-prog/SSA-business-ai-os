/**
 * La copia NORMALIZADA de un payload (`{{webhook.data.…}}`): la misma información, con una forma que
 * cualquier `{{variable}}` puede leer, venga como venga el envío.
 *
 * Por qué: el motor lee `{{a.b.c}}` con claves de letras ASCII, números, `_` y `-` (interpolate.ts). Un
 * payload de afuera trae claves con espacios, tildes, corchetes (`cliente[email]`, un formulario) o un JSON
 * entero metido como texto dentro de un campo: esas claves no se podían usar en ningún paso. En vez de cambiar
 * la sintaxis del motor (la usan todas las automatizaciones), se arma esta copia:
 *
 *  - `a[b][0][c]` se expande en objetos anidados (`a.b.0.c`); `a[]` agrega a una lista;
 *  - un texto que es JSON (empieza con `{` o `[`) se lee y se expande; si no es JSON válido queda como texto;
 *  - cada clave pasa a una forma segura: minúsculas, sin tildes, y lo que no sea letra, número, `_` o `-`
 *    pasa a `_` (`"Nombre completo"` → `nombre_completo`, `"e.mail"` → `e_mail`);
 *  - si dos claves distintas quedan iguales, la segunda lleva `_2`, `_3`…
 *
 * El original sigue intacto en `webhook.payload` (lo que se ve en el historial y lo que usan las automatizaciones
 * de siempre). PURO, sin dependencias, y NUNCA lanza.
 */

export const NORMALIZE_MAX_DEPTH = 12;
export const NORMALIZE_MAX_NODES = 5000;

type Container = Record<string, unknown>;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Container =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Una clave a su forma segura para `{{…}}`. Vacía → `campo`. */
export function safeKey(key: string): string {
  const out = String(key)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!out) return "campo";
  return FORBIDDEN.has(out) ? `${out}_` : out;
}

/**
 * Las partes de una clave con corchetes: `a[b][0][c]` → `["a","b","0","c"]`, `a[]` → `["a",""]`.
 * Una clave sin corchetes, o con corchetes mal formados, es una sola parte.
 */
export function bracketParts(key: string): string[] {
  const match = /^([^[\]]+)((?:\[[^[\]]*\])+)$/.exec(key);
  if (!match) return [key];
  const parts = [match[1]];
  const re = /\[([^[\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[2])) !== null) parts.push(m[1]);
  return parts;
}

/** Un texto que parece JSON (objeto o lista) leído; si no, undefined. */
function parseJsonText(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length < 2) return undefined;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!((first === "{" && last === "}") || (first === "[" && last === "]"))) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

interface State {
  nodes: number;
}

function normalizeValue(value: unknown, depth: number, state: State): unknown {
  if (++state.nodes > NORMALIZE_MAX_NODES) return undefined;
  if (typeof value === "string") {
    if (depth >= NORMALIZE_MAX_DEPTH) return value;
    const parsed = parseJsonText(value);
    return parsed === undefined ? value : normalizeValue(parsed, depth + 1, state);
  }
  if (Array.isArray(value)) {
    if (depth >= NORMALIZE_MAX_DEPTH) return [];
    const out: unknown[] = [];
    for (const item of value) {
      if (state.nodes > NORMALIZE_MAX_NODES) break;
      const v = normalizeValue(item, depth + 1, state);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (isPlainObject(value)) {
    if (depth >= NORMALIZE_MAX_DEPTH) return {};
    const out: Container = {};
    for (const key of Object.keys(value)) {
      if (state.nodes > NORMALIZE_MAX_NODES) break;
      if (FORBIDDEN.has(key)) continue;
      const v = normalizeValue(value[key], depth + 1, state);
      if (v === undefined) continue;
      placeAt(out, bracketParts(key), v);
    }
    return out;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

/** Una clave libre en ese contenedor: la segura y, si ya está ocupada por otra cosa, con `_2`, `_3`… */
function freeKey(container: Container, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(container, key)) return key;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${key}_${n}`;
    if (!Object.prototype.hasOwnProperty.call(container, candidate)) return candidate;
  }
  return `${key}_${Date.now()}`;
}

/** El índice siguiente de un contenedor que se usa como lista (`a[]`). */
function nextIndex(container: Container): string {
  let n = 0;
  while (Object.prototype.hasOwnProperty.call(container, String(n))) n++;
  return String(n);
}

/**
 * Pone `value` en la ruta `parts` dentro de `target`. Las partes intermedias se comparten (así `a[b]` y `a[c]`
 * terminan en el mismo `a`); un choque entre un dato y otro dato (o un dato y un grupo) usa `_2`.
 */
function placeAt(target: Container, parts: string[], value: unknown): void {
  let current = target;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    const last = i === parts.length - 1;
    const key = raw === "" && i > 0 ? nextIndex(current) : /^\d+$/.test(raw) ? raw : safeKey(raw);
    if (last) {
      const existing = current[key];
      if (existing === undefined) current[key] = value;
      else if (isPlainObject(existing) && isPlainObject(value)) mergeInto(existing, value);
      else current[freeKey(current, key)] = value;
      return;
    }
    const existing = current[key];
    if (isPlainObject(existing)) {
      current = existing;
    } else if (Array.isArray(existing)) {
      // Una lista que ya venía y ahora se completa con corchetes: pasa a grupo por índice.
      const asObject: Container = {};
      existing.forEach((item, index) => {
        asObject[String(index)] = item;
      });
      current[key] = asObject;
      current = asObject;
    } else if (existing === undefined) {
      const next: Container = {};
      current[key] = next;
      current = next;
    } else {
      const next: Container = {};
      current[freeKey(current, key)] = next;
      current = next;
    }
  }
}

function mergeInto(target: Container, source: Container): void {
  for (const key of Object.keys(source)) placeAt(target, [key], source[key]);
}

/**
 * La copia normalizada de un payload (o de la query). Lo que no es un objeto queda en `{ valor: … }`;
 * un payload vacío o roto, `{}`. Nunca lanza.
 */
export function normalizePayload(payload: unknown): Record<string, unknown> {
  try {
    const out = normalizeValue(payload, 0, { nodes: 0 });
    if (isPlainObject(out)) return out;
    if (out === undefined || out === null) return {};
    if (Array.isArray(out)) return { items: out };
    return { valor: out };
  } catch {
    return {};
  }
}
