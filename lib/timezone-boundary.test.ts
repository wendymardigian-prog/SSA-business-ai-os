/**
 * Ninguna fecha se muestra sin decir en que zona.
 *
 * Un `toLocaleString` sin `timeZone` no falla: en un Server Component muestra la
 * hora del servidor (UTC) y en un Client Component la del navegador, que puede no
 * ser la que la persona eligio. Por eso hay que atajarlo aca: a simple vista se ve
 * bien, y el error aparece recien cuando alguien mira desde otro pais.
 *
 * La regla del sistema: lo que ve una persona va en SU zona (`useViewerTimezone` /
 * `resolveViewerTimezone`). Si hace falta otra (una fecha civil, una regla del
 * negocio), se pasa explicita: lo unico que este test exige es que se diga cual.
 * Mismo patron que `lib/vault-boundary.test.ts`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const DIRS = ["app", "components", "lib"];

/** Lo que puede formatear sin zona, con el motivo. Tiene que quedar corta. */
const ALLOWED: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules" && entry !== "testing") walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Saca los comentarios sin tocar los saltos de linea (asi los numeros de linea siguen sirviendo). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1");
}

/** Los argumentos de la llamada que abre en `open`, con los parentesis balanceados. */
function argumentsOf(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Lo que cuenta como opciones de fecha: separa un `toLocaleString` de fecha de uno de numero ("1.234"). */
const DATE_OPTION = /\b(day|month|year|hour|minute|weekday|dateStyle|timeStyle)\b\s*:/;

function datesWithoutZone(source: string): Array<{ line: number; call: string }> {
  const clean = stripComments(source);
  const found: Array<{ line: number; call: string }> = [];
  const pattern = /(\.toLocaleDateString|\.toLocaleTimeString|\.toLocaleString|new Intl\.DateTimeFormat|Intl\.DateTimeFormat|\.toDateString)\(/g;

  for (let match = pattern.exec(clean); match; match = pattern.exec(clean)) {
    const name = match[1];
    const open = match.index + match[0].length - 1;
    const args = argumentsOf(clean, open);
    const after = clean.slice(open + args.length + 2, open + args.length + 20);

    // Pedirle al navegador cual es su zona es justo lo que hace la deteccion.
    if (name.includes("DateTimeFormat") && after.startsWith(".resolvedOptions")) continue;

    if (name === ".toLocaleString") {
      // Un numero: `total.toLocaleString("es-AR")`. Solo cuenta si se ve que es una fecha.
      const before = clean.slice(Math.max(0, match.index - 60), match.index);
      if (!DATE_OPTION.test(args) && !/(new Date\([^)]*\)|[dD]ate|[aA]t\b)$/.test(before)) continue;
    }

    if (!/\btimeZone\b/.test(args)) {
      found.push({ line: clean.slice(0, match.index).split("\n").length, call: name.replace(/^\./, "") });
    }
  }
  return found;
}

describe("la regla", () => {
  it("ataja una fecha sin zona, en cualquiera de sus formas", () => {
    expect(datesWithoutZone(`new Date(x).toLocaleString("es-AR", { day: "2-digit" })`)).toHaveLength(1);
    expect(datesWithoutZone(`d.toLocaleDateString("es-AR")`)).toHaveLength(1);
    expect(datesWithoutZone(`d.toLocaleTimeString([], { hour: "2-digit" })`)).toHaveLength(1);
    expect(datesWithoutZone(`new Intl.DateTimeFormat("es-AR", { month: "long" }).format(d)`)).toHaveLength(1);
    expect(datesWithoutZone(`a.toDateString() === b.toDateString()`)).toHaveLength(2);
  });

  it("deja pasar una fecha con zona, un numero, la deteccion y los comentarios", () => {
    expect(datesWithoutZone(`d.toLocaleDateString("es-AR", { timeZone, day: "2-digit" })`)).toEqual([]);
    expect(datesWithoutZone(`new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(d)`)).toEqual([]);
    expect(datesWithoutZone(`total.toLocaleString("es-AR")`)).toEqual([]);
    expect(datesWithoutZone(`Intl.DateTimeFormat().resolvedOptions().timeZone`)).toEqual([]);
    expect(datesWithoutZone(`// d.toLocaleDateString("es-AR")\n/* d.toDateString() */`)).toEqual([]);
  });
});

describe("el codigo real", () => {
  it("toda fecha que se formatea dice en que zona", () => {
    const problems: string[] = [];
    for (const dir of DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (rel in ALLOWED) continue;
        for (const { line, call } of datesWithoutZone(readFileSync(file, "utf8"))) {
          problems.push(`${rel}:${line} ${call}`);
        }
      }
    }
    expect(problems, "Pasale `timeZone` (useViewerTimezone o resolveViewerTimezone). Si de verdad no corresponde, sumala a ALLOWED con el motivo.").toEqual([]);
  });

  it("las excepciones siguen existiendo: una que quedo vieja no da permiso de mas", () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(statSync(join(ROOT, rel)).isFile(), rel).toBe(true);
    }
  });
});
