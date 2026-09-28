/**
 * El script compilado que se sirve en `/embed/embed.js`.
 *
 * Está commiteado a propósito: en Railway el build corre sin dependencias de
 * desarrollo y esbuild llega solo a través de vitest, así que si el archivo
 * no estuviera en el repo el deploy quedaría sin script y todos los embeds de
 * los clientes dejarían de cargar sin que nadie se entere.
 *
 * Este test cuida dos cosas: que el archivo exista y que no se haya vuelto
 * enorme sin querer (un import mal puesto le metía medio mega de Zod y dayjs).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EMBED_SCRIPT_PATH } from "./snippet";

const FILE = join(process.cwd(), "public", "embed", "embed.js");

/** Si hace falta pasarse de acá, es que algo grande se coló en el bundle. */
const MAX_KB = 60;

describe("public/embed/embed.js", () => {
  it("existe y está commiteado", () => {
    expect(() => statSync(FILE)).not.toThrow();
  });

  it("no pasa de 60 KB: es un script para la página de cualquiera", () => {
    const kb = statSync(FILE).size / 1024;
    expect(kb, `el script pesa ${kb.toFixed(1)} KB`).toBeLessThan(MAX_KB);
  });

  it("es el bundle generado, no la fuente", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text.startsWith("/* SSA embed")).toBe(true);
    // Compilado: sin imports de módulos.
    expect(text).not.toMatch(/^import\s/m);
    // Y con la marca del protocolo adentro.
    expect(text).toContain("ssa-embed");
  });

  it("la ruta que arma el snippet es la que existe", () => {
    expect(EMBED_SCRIPT_PATH).toBe("/embed/embed.js");
  });
});
