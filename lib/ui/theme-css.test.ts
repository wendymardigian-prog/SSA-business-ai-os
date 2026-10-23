import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lo que mantiene legibles los desplegables nativos en los dos temas
 * (22/10/2026). Sin `color-scheme: dark` en `.dark`, el navegador dibujaba la
 * lista de un <select> con fondo claro y el texto heredaba el blanco del tema.
 */
const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `no se encontró el bloque ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("tema y desplegables", () => {
  it("cada tema declara su color-scheme", () => {
    expect(block(":root")).toMatch(/color-scheme:\s*light;/);
    expect(block(".dark")).toMatch(/color-scheme:\s*dark;/);
  });

  it("las opciones usan los colores del popover", () => {
    expect(css).toMatch(/option,\s*optgroup\s*\{\s*background-color:\s*var\(--popover\);\s*color:\s*var\(--popover-foreground\);/);
  });

  it("la flecha global vive fuera de @layer y tiene su salida .select-bare", () => {
    const rule = "select:not([multiple]):not([size]):not(.select-bare) {";
    const at = css.indexOf(`\n${rule}`);
    expect(at).toBeGreaterThan(0);
    // Fuera de una capa: la linea empieza sin sangria (las de @layer van indentadas).
    expect(css.slice(at + 1, at + 1 + rule.length)).toBe(rule);
    expect(css).toContain(".dark select:not([multiple]):not([size]):not(.select-bare)");
  });

  it("en pantallas tactiles los campos van a 16 px, fuera de @layer (si no, el iPhone hace zoom al tocarlos)", () => {
    const at = css.indexOf("\n@media (pointer: coarse) {");
    expect(at).toBeGreaterThan(0);
    const rule = css.slice(at, css.indexOf("\n}", at + 1));
    expect(rule).toMatch(/textarea, select\)/);
    expect(rule).toMatch(/font-size:\s*16px;/);
  });
});
