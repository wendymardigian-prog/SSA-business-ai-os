/**
 * Variables en el lienzo (F24, solo plantillas): un texto puede llevar variables, que se ven como CHIPS con su nombre en
 * español («Nombre completo») y se guardan como `{{contact.display_name}}`.
 *
 * - `parseText` / `serializeText`: del texto guardado a los nodos que se dibujan (texto, chip, salto de línea) y de
 *   vuelta. Ida y vuelta exacta.
 * - `insertVariable`: «{ } Insertar variable» en la posición del cursor; si el cursor está DENTRO de un chip, va
 *   después de él. `replaceVariable`: «Cambiar por… / Quitar la variable» al tocar un chip.
 * - `domToNodes`: lo que escribió la persona en el campo editable, a nodos (sin tocar el DOM real: recibe nodos mínimos,
 *   así se prueba sin navegador).
 * - Variables propias: la clave sale del nombre en español (`customVarKey`), no puede repetirse ni chocar con una del
 *   sistema, y borrar una avisa si está en uso. La forma de cada clave la valida el servidor con `validateCustomVars`.
 *
 * Módulo puro.
 */

import type { DesignDoc } from "../doc/schema";
import { docVariables } from "../doc/schema";
import { CUSTOM_VAR_KEY_RE, customVarKey, variableGroups, variableInfo, type CustomVar } from "../variables/catalog";

export type TextNode = { kind: "text"; text: string } | { kind: "var"; key: string } | { kind: "br" };

const VAR_RE = /\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}\}/g;

/** Junta los textos pegados y saca los vacíos. */
export function normalizeNodes(nodes: readonly TextNode[]): TextNode[] {
  const out: TextNode[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      if (node.text === "") continue;
      const last = out[out.length - 1];
      if (last?.kind === "text") out[out.length - 1] = { kind: "text", text: last.text + node.text };
      else out.push(node);
    } else out.push(node);
  }
  return out;
}

/** El texto guardado (`Hola {{contact.first_name}}\nChau`) a nodos: texto, chip y salto de línea. */
export function parseText(text: string): TextNode[] {
  const nodes: TextNode[] = [];
  const pushPlain = (plain: string) => {
    const lines = plain.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) nodes.push({ kind: "br" });
      if (line) nodes.push({ kind: "text", text: line });
    });
  };
  let last = 0;
  for (const match of text.matchAll(VAR_RE)) {
    pushPlain(text.slice(last, match.index));
    nodes.push({ kind: "var", key: match[1] });
    last = (match.index ?? 0) + match[0].length;
  }
  pushPlain(text.slice(last));
  return nodes;
}

/**
 * De los nodos al texto guardado. Las llaves que la persona escribió a mano (`{{` o `}}`) no se guardan tal cual: un
 * `{{algo}}` tipeado se volvería una variable sin querer (o una variable rota que el documento rechaza).
 */
export function serializeText(nodes: readonly TextNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "var") return `{{${node.key}}}`;
      if (node.kind === "br") return "\n";
      return node.text.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
    })
    .join("");
}

/** Dónde está el cursor: el índice del nodo y, en un texto, cuántos caracteres hay antes. */
export interface Cursor {
  index: number;
  offset: number;
}

/**
 * Inserta una variable en el cursor. Dentro de un chip, la deja DESPUÉS de él. Sin cursor, al final. Devuelve los nodos
 * (ya normalizados) y el cursor justo después de la variable.
 */
export function insertVariable(nodes: readonly TextNode[], cursor: Cursor | null, key: string): { nodes: TextNode[]; cursor: Cursor } {
  const chip: TextNode = { kind: "var", key };
  const list = [...nodes];
  let at = list.length;
  let head: TextNode[] = list;
  let tail: TextNode[] = [];
  if (cursor && cursor.index >= 0 && cursor.index < list.length) {
    const node = list[cursor.index];
    if (node.kind === "var") {
      at = cursor.index + 1;
      head = list.slice(0, at);
      tail = list.slice(at);
    } else if (node.kind === "br") {
      at = cursor.offset > 0 ? cursor.index + 1 : cursor.index;
      head = list.slice(0, at);
      tail = list.slice(at);
    } else {
      const cut = Math.min(Math.max(cursor.offset, 0), node.text.length);
      head = [...list.slice(0, cursor.index), { kind: "text", text: node.text.slice(0, cut) }];
      tail = [{ kind: "text", text: node.text.slice(cut) }, ...list.slice(cursor.index + 1)];
    }
  }
  const normalized = normalizeNodes([...head, chip, ...tail]);
  // El chip nunca se junta con sus vecinos: su lugar es la cantidad de nodos que quedan antes de él.
  const chipIndex = normalizeNodes(head).length;
  return { nodes: normalized, cursor: { index: chipIndex + 1, offset: 0 } };
}

/** Tocar un chip: «Cambiar por…» (otra clave) o «Quitar la variable» (`null`). `index` es el índice del nodo. */
export function replaceVariable(nodes: readonly TextNode[], index: number, key: string | null): TextNode[] {
  const node = nodes[index];
  if (!node || node.kind !== "var") return [...nodes];
  const next = [...nodes];
  if (key === null) next.splice(index, 1);
  else next[index] = { kind: "var", key };
  return normalizeNodes(next);
}

// ─── Del campo editable a nodos ──────────────────────────────────────────────

/** Lo mínimo que se lee de un nodo del DOM (un `Node` real lo cumple; en los tests, un objeto cualquiera). */
export interface MinimalNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  dataset?: Record<string, string | undefined>;
  childNodes: ArrayLike<MinimalNode>;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Lo que hay escrito en el campo editable, como nodos. Un chip es un nodo con `data-var`; `<br>` es un salto de línea y
 * un `<div>` o `<p>` (lo que algunos navegadores crean al apretar Enter) también separa renglones.
 */
export function domToNodes(root: MinimalNode): TextNode[] {
  const out: TextNode[] = [];
  const walk = (node: MinimalNode, depth: number) => {
    if (node.nodeType === TEXT_NODE) {
      out.push({ kind: "text", text: node.textContent ?? "" });
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const key = node.dataset?.var;
    if (key) {
      if (VAR_KEY_OK.test(key)) out.push({ kind: "var", key });
      return;
    }
    const name = node.nodeName.toUpperCase();
    if (name === "BR") {
      out.push({ kind: "br" });
      return;
    }
    const block = depth > 0 && (name === "DIV" || name === "P");
    if (block && out.length > 0 && out[out.length - 1].kind !== "br") out.push({ kind: "br" });
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i], depth + 1);
  };
  for (let i = 0; i < root.childNodes.length; i++) walk(root.childNodes[i], 1);
  return out;
}

const VAR_KEY_OK = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

// ─── Variables propias ───────────────────────────────────────────────────────

export const MAX_CUSTOM_VARS = 30;
export const MAX_CUSTOM_LABEL = 60;
export const MAX_CUSTOM_SAMPLE = 200;

/** Las claves del sistema y los prefijos que no se pueden usar como variable propia (`contact`, `workspace`, `design`…). */
function reservedKeys(): Set<string> {
  const reserved = new Set<string>();
  for (const group of variableGroups({ verify: true })) {
    if (group.key === "propias") continue;
    for (const v of group.vars) {
      reserved.add(v.key);
      reserved.add(v.key.split(".")[0]);
    }
  }
  return reserved;
}

/** Un nombre en español → la clave de una variable propia («Nombre en el certificado» → `nombre_en_el_certificado`). */
export function normalizeCustomKey(label: string): string {
  return customVarKey(label);
}

export type CustomVarsResult = { ok: true; list: CustomVar[] } | { ok: false; error: string };

/**
 * Valida la lista de variables propias de una plantilla: la forma de cada clave (`customVarKey`), que no choque con una
 * del sistema, que no se repita y los largos. Es lo que exige el servidor antes de guardar (`updateTemplateSettings`,
 * `saveDesignDoc`): la base no la valida.
 */
export function validateCustomVars(raw: unknown): CustomVarsResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Las variables propias tienen que ser una lista." };
  if (raw.length > MAX_CUSTOM_VARS) return { ok: false, error: `Podés tener hasta ${MAX_CUSTOM_VARS} variables propias.` };
  const reserved = reservedKeys();
  const seen = new Set<string>();
  const list: CustomVar[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "Una variable propia no tiene la forma esperada." };
    const v = item as Record<string, unknown>;
    const key = typeof v.key === "string" ? v.key : "";
    const label = typeof v.label === "string" ? v.label.replace(/\s+/g, " ").trim() : "";
    const sample = typeof v.sample === "string" ? v.sample : "";
    const def = typeof v.default === "string" ? v.default : null;
    if (!CUSTOM_VAR_KEY_RE.test(key)) return { ok: false, error: `La clave «${key.slice(0, 50)}» no es válida: va en minúsculas, sin tildes ni espacios (por ejemplo, nombre_en_el_certificado).` };
    if (reserved.has(key)) return { ok: false, error: `«${key}» ya es una variable del sistema: elegí otro nombre.` };
    if (seen.has(key)) return { ok: false, error: `Hay dos variables propias con la clave «${key}».` };
    if (label.length < 1 || label.length > MAX_CUSTOM_LABEL) return { ok: false, error: `El nombre de la variable va de 1 a ${MAX_CUSTOM_LABEL} caracteres.` };
    if (sample.length > MAX_CUSTOM_SAMPLE || (def !== null && def.length > MAX_CUSTOM_SAMPLE)) return { ok: false, error: `El valor de ejemplo va hasta ${MAX_CUSTOM_SAMPLE} caracteres.` };
    seen.add(key);
    list.push({ key, label, sample, default: def });
  }
  return { ok: true, list };
}

export type AddVarResult = { ok: true; list: CustomVar[]; key: string } | { ok: false; error: string };

/** «Agregar» en la pestaña Variables: el nombre en español → la clave. Rechaza vacíos, repetidos y los del sistema. */
export function addCustomVar(list: readonly CustomVar[], label: string, sample = ""): AddVarResult {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "Escribí el nombre de la variable." };
  if (clean.length > MAX_CUSTOM_LABEL) return { ok: false, error: `El nombre va hasta ${MAX_CUSTOM_LABEL} caracteres.` };
  const key = normalizeCustomKey(clean);
  if (list.some((v) => v.key === key)) return { ok: false, error: "Ya hay una variable propia con ese nombre." };
  const next = [...list, { key, label: clean, sample: sample.trim().slice(0, MAX_CUSTOM_SAMPLE), default: null }];
  const checked = validateCustomVars(next);
  return checked.ok ? { ok: true, list: checked.list, key } : { ok: false, error: checked.error };
}

/** Cuántas veces se usa una variable en el documento (borrar avisa si está en uso). */
export function variableUsage(doc: DesignDoc, key: string): number {
  const token = `{{${key}}}`;
  const times = (text: string) => text.split(token).length - 1;
  let count = 0;
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type === "text") count += times(el.text);
      if (el.type === "html") count += times(el.html);
    }
  }
  return count;
}

export function removeCustomVar(list: readonly CustomVar[], key: string): CustomVar[] {
  return list.filter((v) => v.key !== key);
}

/** El aviso al borrar una variable propia que está en uso. */
export function removeVarWarning(label: string, uses: number): string | null {
  if (uses <= 0) return null;
  return `«${label}» se usa ${uses === 1 ? "1 vez" : `${uses} veces`} en el diseño: si la borrás, esos lugares quedan vacíos al generar.`;
}

export interface UsedVariableRow {
  key: string;
  label: string;
  group: string;
  sample: string;
  known: boolean;
}

/** Las variables usadas en la plantilla, para la pestaña Variables: con su grupo y su valor de ejemplo. */
export function usedVariableRows(doc: DesignDoc, customVars: readonly CustomVar[]): UsedVariableRow[] {
  return docVariables(doc).map((key) => {
    const info = variableInfo(key, { customVars });
    return { key, label: info.label, group: info.group, sample: info.sample, known: info.known };
  });
}
