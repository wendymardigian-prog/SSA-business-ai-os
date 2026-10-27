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
    for (const p of ["docs", "claude", "BITACORA.md", ".claude/settings.json", ".claude/hooks", "scripts/sync-template.mjs", ".env", ".env.local", ".claude/worktrees", "node_modules", ".next"]) {
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

  // @plantilla-desde(sitio)
  it("copia la lista de páginas, el sitemap y el robots", () => {
    for (const p of ["lib/site/pages.ts", "app/sitemap.ts", "app/robots.ts"]) expect(existsSync(join(dest, p)), p).toBe(true);
    expect(readFileSync(join(dest, "lib/site/pages.ts"), "utf8")).toMatch(/SITE_PAGES: SitePage\[\] = \[\]/);
  });
  // @plantilla-hasta(sitio)
});

describe("la versión por defecto del sitio de este repo", () => {
  it("app/(sitio)/page.tsx y layout.tsx de este repo coinciden con la plantilla (salvo que el clon los haya cambiado a propósito)", () => {
    for (const file of ["page.tsx", "layout.tsx"]) {
      expect(readFileSync(join(process.cwd(), "app/(sitio)", file), "utf8"), file).toBe(readFileSync(join(process.cwd(), "scripts/template-files/sitio", file), "utf8"));
    }
  });
});

// @plantilla-desde(proyecto)
/**
 * El export con perfil (`--perfil=estudiantes`), sin los controles (tsc, eslint, vitest y next build
 * corren en el export de verdad y tardan minutos): fija que se borra, que se reemplaza y que se queda.
 */
describe("export-template --perfil=estudiantes", () => {
  let outP = "";
  let destP = "";
  let profile: typeof import("./plantilla/perfiles/estudiantes.mjs");
  let run: ReturnType<typeof spawnSync>;

  beforeAll(async () => {
    profile = await import("./plantilla/perfiles/estudiantes.mjs");
    outP = mkdtempSync(join(tmpdir(), "export-perfil-"));
    destP = join(outP, "copia");
    run = spawnSync("node", ["scripts/export-template.mjs", "--perfil=estudiantes", `--out=${destP}`, "--skip-gates"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }, 300_000);

  afterAll(() => {
    if (outP) rmSync(outP, { recursive: true, force: true });
  });

  it("termina bien y sin git (--skip-gates no lo arma)", () => {
    expect(run.status, String(run.stderr)).toBe(0);
    expect(existsSync(join(destP, ".git"))).toBe(false);
    expect(existsSync(join(destP, "node_modules"))).toBe(false);
  });

  it("no lleva las rutas de los modulos excluidos ni los tests de excludeTests", () => {
    const modules = profile.MODULES as Record<string, { paths: string[]; replacements?: Record<string, string> }>;
    for (const id of profile.EXCLUDED) {
      for (const p of modules[id].paths) {
        if (modules[id].replacements?.[p]) continue;
        expect(existsSync(join(destP, p)), `${id}: ${p}`).toBe(false);
      }
    }
    for (const t of profile.excludeTests) expect(existsSync(join(destP, t.path)), t.path).toBe(false);
  });

  it("no lleva las herramientas de la plantilla ni sus archivos propios sueltos", () => {
    for (const p of [...profile.TOOLING, profile.TEMPLATE_FILES, "docs"]) expect(existsSync(join(destP, p)), p).toBe(false);
  });

  it("las migraciones, los seeds y el config.toml son los de la plantilla, mas ALL_MIGRATIONS.sql", () => {
    const from = join(process.cwd(), profile.SUPABASE_DIR);
    const own = readdirSync(join(from, "migrations")).sort();
    expect(readdirSync(join(destP, "supabase/migrations")).sort()).toEqual([...own, "ALL_MIGRATIONS.sql"].sort());
    for (const f of own) expect(readFileSync(join(destP, "supabase/migrations", f), "utf8"), f).toBe(readFileSync(join(from, "migrations", f), "utf8"));
    expect(readdirSync(join(destP, "supabase/seeds")).sort()).toEqual(readdirSync(join(from, "seeds")).sort());
    expect(readFileSync(join(destP, "supabase/config.toml"), "utf8")).toBe(readFileSync(join(from, "config.toml"), "utf8"));
  });

  it("los archivos propios de la plantilla pisan a los del proyecto", () => {
    const base = join(process.cwd(), profile.TEMPLATE_FILES);
    if (!existsSync(base)) return;
    const walk = (dir: string): string[] =>
      readdirSync(join(base, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of walk("")) expect(readFileSync(join(destP, f), "utf8"), f).toBe(readFileSync(join(base, f), "utf8"));
  });

  it("no queda ninguna marca de plantilla en el codigo", () => {
    const marker = "@plantilla" + "-";
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(destP, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs|js|sql)$/.test(e.name) && readFileSync(join(destP, rel), "utf8").includes(marker)) found.push(rel);
      }
    };
    for (const d of ["app", "lib", "components", "scripts"]) walk(d);
    expect(found).toEqual([]);
  });

  it("el package.json no tiene los paquetes que son solo de un modulo excluido", () => {
    const pkg = JSON.parse(readFileSync(join(destP, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, mods] of Object.entries(profile.PACKAGES)) {
      if (mods.some((m) => profile.EXCLUDED.includes(m))) expect(deps, name).not.toHaveProperty(name);
    }
  });

  it("su export-template.mjs es el de siempre, sin la parte del perfil", () => {
    const text = readFileSync(join(destP, "scripts/export-template.mjs"), "utf8");
    expect(text).not.toContain("--perfil");
    expect(text).toContain('const outArg = arg("out") || "../template-export";');
  });
});
// @plantilla-hasta(proyecto)
