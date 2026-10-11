/**
 * Caracterización de `scripts/export-template.mjs` ANTES de que Formularios
 * (F30) le enseñe a no copiar el sitio propio de cada clon.
 *
 * Lo corre como proceso en una carpeta temporal (el script ejecuta `main()` al
 * importarse). NO mira el código de salida: el control final de nombres puede
 * fallar por restos en el repo de origen, y eso es un problema aparte del que
 * este test fija (qué se copia y qué no).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let out = "";
let dest = "";

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "export-template-"));
  dest = join(out, "copia");
  spawnSync("node", ["scripts/export-template.mjs", `--out=${dest}`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("export-template: qué se copia y qué no", () => {
  it("copia la app, el middleware y las migraciones", () => {
    for (const p of ["app/layout.tsx", "app/(dashboard)", "app/api", "middleware.ts", "supabase/migrations", "package.json", "CLAUDE.md"]) {
      expect(existsSync(join(dest, p)), p).toBe(true);
    }
  });

  it("no copia docs internos, material del proyecto, .env ni .git original", () => {
    for (const p of ["docs", "claude", "BITACORA.md", ".env", ".env.local", ".claude/worktrees", "node_modules", ".next"]) {
      expect(existsSync(join(dest, p)), p).toBe(false);
    }
  });

  it("sí copia .env.example", () => {
    expect(existsSync(join(dest, ".env.example"))).toBe(true);
  });

  it("la home de la copia es una página que existe", () => {
    const home = ["app/(sitio)/page.tsx", "app/page.tsx"].some((p) => existsSync(join(dest, p)));
    expect(home).toBe(true);
  });
});
