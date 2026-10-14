/**
 * Plano formularios-ui (F9-F16): el editor de formularios no esconde nada en secciones plegables. Ni un `<details>`
 * en `components/forms/editor` ni en `components/forms/builder`: lo que se configura se ve.
 * Y el formulario publico no muestra el logo de la marca (D9), tenga o no `showLogo` guardado.
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

  it("la pagina publica no dibuja el logo ni lee brandLogoUrl", () => {
    const page = readFileSync(join(process.cwd(), "app/f/[slug]/page.tsx"), "utf8");
    expect(page).not.toMatch(/brandLogoUrl/);
    expect(page).not.toMatch(/<img/);
    expect(page).not.toMatch(/showLogo/);
  });

  it("ya no queda la opcion de mostrar el logo en el editor", () => {
    const hits = files(join(process.cwd(), "components/forms")).filter((f) => /Mostrar el logo/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
