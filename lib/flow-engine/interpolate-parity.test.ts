/**
 * El interpolador del motor y el del simulador tienen que decir lo mismo.
 *
 * El simulador corre en el navegador y no puede importar código de servidor,
 * así que tiene su propia copia. El comentario de `interpolate.ts` afirmaba
 * desde hace meses que "lo cubre un test que compara las dos" y ese test no
 * existía: las dos copias se podían separar sin que nada avisara, y el panel
 * de Test mostraría un mensaje distinto del que sale de verdad.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { interpolateVariables } from "./interpolate";

const MOTOR = readFileSync(join(process.cwd(), "lib/flow-engine/interpolate.ts"), "utf8");
const SIMULADOR = readFileSync(join(process.cwd(), "lib/flow-engine/simulator.ts"), "utf8");

/** El literal de la expresión regular, tal como está escrito en el archivo. */
function regexOf(source: string): string {
  const match = source.match(/text\.replace\((\/[^\n]*?\/g),/);
  if (!match) throw new Error("no encontré el reemplazo de tokens");
  return match[1];
}

describe("interpolador del motor y del simulador", () => {
  it("usan la MISMA expresión regular", () => {
    expect(regexOf(SIMULADOR)).toBe(regexOf(MOTOR));
  });

  it("los dos siguen dot-paths y dejan el token cuando no resuelve", () => {
    // La copia del simulador se lee como texto; lo que se compara es la forma
    // del reemplazo, que es donde se separaron otras veces.
    expect(SIMULADOR).toContain("if (value === null || value === undefined) return token;");
    expect(MOTOR).toContain("if (value === null || value === undefined) return token;");
    expect(SIMULADOR).toContain('typeof value === "object" ? JSON.stringify(value) : String(value)');
    expect(MOTOR).toContain('typeof value === "object" ? JSON.stringify(value) : String(value)');
  });
});

describe("interpolateVariables", () => {
  it("reemplaza un token simple", () => {
    expect(interpolateVariables("Hola {{nombre}}", { nombre: "Ana" })).toBe("Hola Ana");
  });

  it("sigue un dot-path", () => {
    expect(interpolateVariables("El {{booking.event_title}}", { booking: { event_title: "Diagnóstico" } })).toBe("El Diagnóstico");
  });

  it("un token que no resuelve queda tal cual", () => {
    expect(interpolateVariables("Hola {{nombre}}", {})).toBe("Hola {{nombre}}");
    expect(interpolateVariables("Hola {{a.b.c}}", { a: { b: {} } })).toBe("Hola {{a.b.c}}");
  });

  it("admite guiones: el link de un evento los lleva", () => {
    const vars = { scheduling: { link: { ana: { "llamada-de-diagnostico": "https://x/calendario/ana/llamada-de-diagnostico" } } } };
    expect(interpolateVariables("Agendá en {{scheduling.link.ana.llamada-de-diagnostico}}", vars)).toBe(
      "Agendá en https://x/calendario/ana/llamada-de-diagnostico",
    );
  });

  it("un objeto se muestra como JSON, no como [object Object]", () => {
    expect(interpolateVariables("{{x}}", { x: { a: 1 } })).toBe('{"a":1}');
  });

  it("una variable vacía sí reemplaza: vacío es un valor", () => {
    expect(interpolateVariables("Hola {{nombre}}!", { nombre: "" })).toBe("Hola !");
  });
});
