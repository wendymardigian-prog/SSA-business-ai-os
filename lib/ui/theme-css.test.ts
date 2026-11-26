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

describe("textos en blanco o negro; el gris solo para lo desactivado", () => {
  const value = (body: string, token: string) => new RegExp(`\\n\\s*${token}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

  it("en cada tema el texto secundario es igual al principal y el gris vive en --disabled-foreground", () => {
    for (const selector of [":root", ".dark"]) {
      const body = block(selector);
      expect(value(body, "--muted-foreground"), selector).toBe(value(body, "--foreground"));
      expect(value(body, "--disabled-foreground"), selector).toBeTruthy();
      expect(value(body, "--disabled-foreground"), selector).not.toBe(value(body, "--foreground"));
    }
  });

  it("los cuatro bloques de tema declaran el gris de desactivado y @theme lo expone como clase", () => {
    expect(css.match(/\n\s*--disabled-foreground:/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(css).toContain("--color-disabled-foreground: var(--disabled-foreground);");
  });

  it("las opciones que no se pueden elegir siguen en gris", () => {
    expect(css).toMatch(/option:disabled\s*\{\s*color:\s*var\(--disabled-foreground\);/);
  });
});

describe("barra de carga del panel", () => {
  it("atenúa el contenido viejo pero no la barra de la pantalla, fuera de @layer", () => {
    const rule = "main[data-nav-pending] > * > :not([data-topbar]):not(:has([data-topbar])) {";
    const at = css.indexOf(`\n${rule}`);
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at, css.indexOf("\n}", at))).toMatch(/opacity:\s*0\.55;/);
  });
});
