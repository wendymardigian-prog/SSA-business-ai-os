import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WEB_IFRAME_SANDBOX } from "./sandbox";

const ROOT = resolve(__dirname, "../../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
const files = [...walk(join(ROOT, "app/d")), ...walk(join(ROOT, "components/designer/public")), ...walk(join(ROOT, "lib/designer/public"))];
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1");

describe("el link público del Diseñador IA", () => {
  it("encontró los archivos a revisar", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no tiene pie de otra marca (white label): ningún «Hecho con…»", () => {
    for (const file of files) expect(stripComments(readFileSync(file, "utf8")), file).not.toMatch(/Hecho con/i);
  });

  it("la página web va en un iframe con sandbox y SIN allow-scripts, ni mismo origen, ni formularios", () => {
    expect(WEB_IFRAME_SANDBOX).not.toMatch(/allow-scripts|allow-same-origin|allow-forms|allow-top-navigation|allow-modals/);
    const parts = readFileSync(join(ROOT, "components/designer/public/public-parts.tsx"), "utf8");
    expect(parts).toMatch(/<iframe[\s\S]*sandbox=\{WEB_IFRAME_SANDBOX\}/);
    expect(parts).toMatch(/srcDoc=/);
    for (const file of files) expect(stripComments(readFileSync(file, "utf8")), file).not.toMatch(/allow-scripts/);
  });

  it("nadie usa dangerouslySetInnerHTML: el HTML de la web va en srcDoc", () => {
    for (const file of files) expect(stripComments(readFileSync(file, "utf8")), file).not.toContain("dangerouslySetInnerHTML");
  });

  it("no lee la sesión del navegador: el link es público", () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/getAuthUser|getWorkspace|getPermissionContext|createClient\(/);
    }
  });

  it("los links de afuera salen del dominio del negocio, nunca del navegador ni de la variable", () => {
    for (const file of files) expect(stripComments(readFileSync(file, "utf8")), file).not.toMatch(/window\.location|NEXT_PUBLIC_APP_URL|\bappUrl\(/);
  });

  it("las rutas de descarga e imagen no exponen el bucket: no firman links", () => {
    const serve = stripComments(readFileSync(join(ROOT, "lib/designer/public/serve.ts"), "utf8"));
    expect(serve).not.toMatch(/createSignedUrl|getPublicUrl/);
  });
});
