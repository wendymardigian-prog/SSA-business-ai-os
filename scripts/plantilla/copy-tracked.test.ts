/**
 * `copyTrackedPath` (export-profile.mjs): lo que el perfil trae del repo (el sitio por defecto,
 * la base de la plantilla, sus archivos propios) es SOLO lo que git sigue. Un archivo sin
 * seguimiento, ignorado o borrado del disco que quedo en esas carpetas no viaja.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyTrackedPath } from "./export-profile.mjs";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "zz-test",
  GIT_AUTHOR_EMAIL: "zz-test@example.com",
  GIT_COMMITTER_NAME: "zz-test",
  GIT_COMMITTER_EMAIL: "zz-test@example.com",
};

function walk(root: string, rel = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(root, path));
    else files.push(path);
  }
  return files.sort();
}

describe("copyTrackedPath: solo lo que git sigue", () => {
  let tmp = "";
  let repo = "";
  let out = "";

  const write = (rel: string, content: string) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
  };

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "copy-tracked-"));
    repo = join(tmp, "repo");
    out = join(tmp, "out");
    mkdirSync(repo);
    write("base/supabase/config.toml", "project_id = \"zz\"\n");
    write("base/supabase/migrations/00001_a.sql", "select 1;\n");
    write("base/supabase/migrations/00002_b.sql", "select 2;\n");
    write("base/archivos/.claude/commands/setup.md", "setup\n");
    write("base/archivos/README.md", "readme\n");
    write(".gitignore", "*.log\n");
    execFileSync("git", ["init", "-q"], { cwd: repo, env: GIT_ENV });
    execFileSync("git", ["add", "-A"], { cwd: repo, env: GIT_ENV });
    execFileSync("git", ["commit", "-q", "-m", "zz-test"], { cwd: repo, env: GIT_ENV });

    // Lo que NO es del repo, adentro de las carpetas que se copian.
    write("base/archivos/Claude outputs/respaldo.json", '{"zz-test": true}\n');
    write("base/archivos/notas.md", "sin seguimiento\n");
    write("base/supabase/migrations/debug.log", "ignorado\n");
    write("base/supabase/migrations/00003_suelta.sql", "select 3;\n");
    rmSync(join(repo, "base/supabase/migrations/00002_b.sql"));
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("una carpeta: copia lo seguido con su forma, y nada sin seguimiento, ignorado ni borrado", () => {
    const copied = copyTrackedPath(repo, "base/supabase/migrations", join(out, "migrations"));
    expect(copied).toEqual(["00001_a.sql"]);
    expect(walk(join(out, "migrations"))).toEqual(["00001_a.sql"]);
  });

  it("una carpeta con subcarpetas, encima de otra que ya existe", () => {
    mkdirSync(join(out, "copia"), { recursive: true });
    writeFileSync(join(out, "copia", "README.md"), "del proyecto\n");
    const copied = copyTrackedPath(repo, "base/archivos", join(out, "copia"));
    expect(copied).toEqual([".claude/commands/setup.md", "README.md"]);
    expect(readFileSync(join(out, "copia", "README.md"), "utf8")).toBe("readme\n");
    expect(existsSync(join(out, "copia", "Claude outputs"))).toBe(false);
    expect(existsSync(join(out, "copia", "notas.md"))).toBe(false);
  });

  it("un archivo suelto", () => {
    expect(copyTrackedPath(repo, "base/supabase/config.toml", join(out, "config.toml"))).toEqual([""]);
    expect(readFileSync(join(out, "config.toml"), "utf8")).toBe('project_id = "zz"\n');
  });

  it("algo que git no sigue no se copia (aunque exista en el disco)", () => {
    expect(copyTrackedPath(repo, "base/archivos/notas.md", join(out, "notas.md"))).toEqual([]);
    expect(existsSync(join(out, "notas.md"))).toBe(false);
  });

  it("sin git, lanza en vez de copiar el disco", () => {
    const sinGit = join(tmp, "sin-git");
    mkdirSync(join(sinGit, "x"), { recursive: true });
    writeFileSync(join(sinGit, "x", "a.txt"), "a\n");
    expect(() => copyTrackedPath(sinGit, "x", join(out, "x"))).toThrow(/git/);
  });
});
