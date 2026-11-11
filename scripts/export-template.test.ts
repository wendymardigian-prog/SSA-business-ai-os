/**
 * Caracterización de `scripts/export-template.mjs`: qué copia y qué no (el sitio
 * propio de cada clon no viaja).
 *
 * Lo corre como proceso en una carpeta temporal (el script ejecuta `main()` al
 * importarse). NO mira el código de salida: el control final de nombres puede
 * fallar por restos en el repo de origen, y eso es un problema aparte del que
 * este test fija (qué se copia y qué no).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Corre el export sin bloquear al worker de vitest (un `spawnSync` de un minuto lo deja
 * sin responder y vitest avisa "Timeout calling onTaskUpdate"). Devuelve el código de salida.
 */
function runExport(cwd: string, out: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((done) => {
    execFile("node", ["scripts/export-template.mjs", `--out=${out}`], { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (error) => {
      done(error ? (typeof error.code === "number" ? error.code : 1) : 0);
    });
  });
}

let out = "";
let dest = "";

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "export-template-"));
  dest = join(out, "copia");
  await runExport(process.cwd(), dest);
}, 180_000);

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
    for (const p of ["docs", "claude", "BITACORA.md", ".claude/hooks/baios-reminder.mjs", "scripts/sync-template.mjs", "scripts/plantilla", "plantilla-estudiantes", "scripts/verify-student-schema.mjs", "scripts/template-files/estudiantes", ".env", ".env.local", ".claude/worktrees", "node_modules", ".next"]) {
      expect(existsSync(join(dest, p)), p).toBe(false);
    }
  });

  it("todo lo copiado es un archivo que git sigue en el repo (nada sin seguimiento ni ignorado)", () => {
    const tracked = new Set(gitLsFiles(process.cwd()));
    const extra = walk(dest).filter((rel) => !tracked.has(rel));
    expect(extra).toEqual([]);
  });

  it("sí copia .env.example", () => {
    expect(existsSync(join(dest, ".env.example"))).toBe(true);
  });

  it("la home de la copia es una página que existe", () => {
    const home = ["app/(sitio)/page.tsx", "app/page.tsx"].some((p) => existsSync(join(dest, p)));
    expect(home).toBe(true);
  });
});

describe("export-template: el protocolo de trabajo viaja a cada clon", () => {
  it("copia el protocolo, el comando /planificar y el recordatorio", () => {
    for (const p of [
      ".claude/rules/00-protocolo-de-trabajo.md",
      ".claude/skills/planificar/SKILL.md",
      ".claude/hooks/plan-reminder.mjs",
    ]) {
      expect(existsSync(join(dest, p)), p).toBe(true);
    }
  });

  it("el .claude/settings.json del clon es el de clientes: modo plan y recordatorio, sin el aviso de la plantilla", () => {
    const copied = readFileSync(join(dest, ".claude/settings.json"), "utf8");
    const template = readFileSync(join(process.cwd(), "scripts/template-files/clientes/settings.json"), "utf8");
    expect(copied).toBe(template);
    const settings = JSON.parse(copied);
    expect(settings.permissions.defaultMode).toBe("plan");
    expect(copied).toContain("plan-reminder.mjs");
    expect(copied).not.toContain("baios-reminder");
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

// --- Un repo de prueba: lo que git no sigue no viaja -------------------------
//
// Arma un repo chico en una carpeta temporal con una copia del script, y le deja al
// lado lo que tiene cualquier carpeta de trabajo: una carpeta "Claude outputs/" sin
// seguimiento (lo que viajo a la plantilla el 8/11/2026), un archivo ignorado y uno
// seguido pero borrado del disco. Asi no se toca el repo de verdad.

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "zz-test",
  GIT_AUTHOR_EMAIL: "zz-test@example.com",
  GIT_COMMITTER_NAME: "zz-test",
  GIT_COMMITTER_EMAIL: "zz-test@example.com",
};

function gitLsFiles(cwd: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached"], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function walk(root: string, rel = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (path === ".git") continue;
    if (entry.isDirectory()) files.push(...walk(root, path));
    else files.push(path);
  }
  return files;
}

describe("export-template: solo copia lo que git sigue", () => {
  let tmp = "";
  let repo = "";
  let copia = "";
  let status: number | null = null;

  const write = (rel: string, content: string) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
  };

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "export-template-git-"));
    repo = join(tmp, "repo");
    copia = join(tmp, "copia");
    mkdirSync(repo);
    for (const rel of ["scripts/export-template.mjs", "scripts/template-files/sitio/layout.tsx", "scripts/template-files/sitio/page.tsx", "scripts/template-files/clientes/settings.json"]) {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      copyFileSync(join(process.cwd(), rel), join(repo, rel));
    }
    write("lib/seguido.ts", "export const a = 1;\n");
    write("lib/borrado.ts", "export const b = 2;\n");
    write("docs/interno.md", "interno\n");
    write(".gitignore", "ignorado.log\n");
    execFileSync("git", ["init", "-q"], { cwd: repo, env: GIT_ENV });
    execFileSync("git", ["add", "-A"], { cwd: repo, env: GIT_ENV });
    execFileSync("git", ["commit", "-q", "-m", "zz-test"], { cwd: repo, env: GIT_ENV });

    // Lo que NO es del repo: sin seguimiento, ignorado y seguido-pero-borrado.
    write("Claude outputs/respaldo.json", '{"zz-test": true}\n');
    write("notas-sueltas/borrador.md", "sin seguimiento\n");
    write("ignorado.log", "ignorado\n");
    rmSync(join(repo, "lib/borrado.ts"));

    status = await runExport(repo, copia, GIT_ENV);
  }, 120_000);

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("el export termina bien", () => {
    expect(status).toBe(0);
  });

  it("copia lo seguido", () => {
    expect(readFileSync(join(copia, "lib/seguido.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(existsSync(join(copia, ".gitignore"))).toBe(true);
  });

  it("NO copia la carpeta Claude outputs ni nada sin seguimiento", () => {
    expect(existsSync(join(copia, "Claude outputs"))).toBe(false);
    expect(existsSync(join(copia, "notas-sueltas"))).toBe(false);
  });

  it("NO copia lo ignorado ni lo borrado del disco", () => {
    expect(existsSync(join(copia, "ignorado.log"))).toBe(false);
    expect(existsSync(join(copia, "lib/borrado.ts"))).toBe(false);
  });

  it("sigue aplicando las exclusiones a lo que SÍ está en git", () => {
    expect(existsSync(join(copia, "docs"))).toBe(false);
  });

  it("la copia entera es lo seguido + el sitio por defecto, nada más", () => {
    expect(walk(copia).sort()).toEqual(
      [".gitignore", "app/(sitio)/layout.tsx", "app/(sitio)/page.tsx", "lib/seguido.ts", "public/sitio/.gitkeep", "scripts/export-template.mjs", "scripts/template-files/sitio/layout.tsx", "scripts/template-files/sitio/page.tsx"].sort(),
    );
  });
});
