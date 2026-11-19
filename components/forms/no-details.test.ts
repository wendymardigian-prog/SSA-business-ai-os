/**
 * Plano formularios-ui (F9-F16): el editor de formularios no esconde nada en secciones plegables. Ni un `<details>`
 * en `components/forms/editor` ni en `components/forms/builder`: lo que se configura se ve.
 * El logo (18/11/2026, revierte D9 a pedido): la página pública lo muestra solo con «Mostrar el logo» prendido, con
 * el logo de la marca del NEGOCIO (nunca el de la instalación leído directo) y nunca incrustada en otra web.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("el editor de formularios", () => {
  for (const dir of ["components/forms/editor", "components/forms/builder"]) {
    it(`no usa <details> en ${dir}`, () => {
      const offenders = files(join(process.cwd(), dir)).filter((f) => /<details[\s>]/.test(readFileSync(f, "utf8")));
      expect(offenders).toEqual([]);
    });
  }

  it("la pagina publica dibuja el logo del negocio solo fuera del iframe", () => {
    const page = readFileSync(join(process.cwd(), "app/f/[slug]/page.tsx"), "utf8");
    // El logo sale de `loadPublicFormData` (la marca del negocio del formulario, ya filtrada por `showLogo`).
    expect(page).not.toMatch(/brandLogoUrl/);
    expect(page).toMatch(/const logo = !embed \? form\.business_logo_url : null;/);
  });

  it("el editor tiene la opcion de mostrar el logo", () => {
    const hits = files(join(process.cwd(), "components/forms")).filter((f) => /Mostrar el logo/.test(readFileSync(f, "utf8")));
    expect(hits.length).toBeGreaterThan(0);
  });
});
