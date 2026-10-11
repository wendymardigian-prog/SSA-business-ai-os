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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

describe("export-template: el sitio propio de cada clon (F30)", () => {
  it("deja app/(sitio)/page.tsx y layout.tsx IGUALES a la versión por defecto de scripts/template-files/sitio", () => {
    for (const file of ["page.tsx", "layout.tsx"]) {
      const copied = readFileSync(join(dest, "app/(sitio)", file), "utf8");
      const template = readFileSync(join(process.cwd(), "scripts/template-files/sitio", file), "utf8");
      expect(copied, file).toBe(template);
    }
  });

  it("la home por defecto lleva al login", () => {
    expect(readFileSync(join(dest, "app/(sitio)/page.tsx"), "utf8")).toMatch(/redirect\(\s*["']\/login["']\s*\)/);
  });

  it("NO copia ningún otro archivo de app/(sitio) ni de public/sitio", () => {
    expect(readdirSync(join(dest, "app/(sitio)")).sort()).toEqual(["layout.tsx", "page.tsx"]);
    expect(readdirSync(join(dest, "public/sitio")).filter((f) => f !== ".gitkeep")).toEqual([]);
  });

  it("no copia app/page.tsx (la home vive en el grupo del sitio)", () => {
    expect(existsSync(join(dest, "app/page.tsx"))).toBe(false);
  });

  it("copia la lista de páginas, el sitemap y el robots", () => {
    for (const p of ["lib/site/pages.ts", "app/sitemap.ts", "app/robots.ts"]) expect(existsSync(join(dest, p)), p).toBe(true);
    expect(readFileSync(join(dest, "lib/site/pages.ts"), "utf8")).toMatch(/SITE_PAGES: SitePage\[\] = \[\]/);
  });
});

describe("la versión por defecto del sitio de este repo", () => {
  it("app/(sitio)/page.tsx y layout.tsx de este repo coinciden con la plantilla (salvo que el clon los haya cambiado a propósito)", () => {
    for (const file of ["page.tsx", "layout.tsx"]) {
      expect(readFileSync(join(process.cwd(), "app/(sitio)", file), "utf8"), file).toBe(readFileSync(join(process.cwd(), "scripts/template-files/sitio", file), "utf8"));
    }
  });
});
