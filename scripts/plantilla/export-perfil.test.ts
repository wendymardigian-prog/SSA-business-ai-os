/**
 * El export con perfil de `scripts/export-template.mjs` (la plantilla de estudiantes).
 *
 * Vive aca, con las herramientas de la plantilla, y no en `scripts/export-template.test.ts`:
 * la plantilla de clientes no lleva `scripts/plantilla` (`isExcluded` en export-template.mjs),
 * y este test importa el perfil. En `scripts/export-template.test.ts` rompia el typecheck y
 * vitest de la copia de los clientes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * El export con perfil (`--perfil=estudiantes`), sin los controles (tsc, eslint, vitest y next build
 * corren en el export de verdad y tardan minutos): fija que se borra, que se reemplaza y que se queda.
 */
describe("export-template --perfil=estudiantes", () => {
  let outP = "";
  let destP = "";
  let profile: typeof import("./perfiles/estudiantes.mjs");
  let run: ReturnType<typeof spawnSync>;

  beforeAll(async () => {
    profile = await import("./perfiles/estudiantes.mjs");
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

  it("las migraciones, los seeds y el config.toml son los de la plantilla, mas ALL_MIGRATIONS.sql fuera de migrations", () => {
    const from = join(process.cwd(), profile.SUPABASE_DIR);
    const own = readdirSync(join(from, "migrations")).sort();
    expect(readdirSync(join(destP, "supabase/migrations")).sort()).toEqual(own);
    expect(existsSync(join(destP, "supabase/ALL_MIGRATIONS.sql"))).toBe(true);
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
