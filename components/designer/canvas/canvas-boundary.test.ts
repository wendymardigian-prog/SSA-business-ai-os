/**
 * Frontera del lienzo (F19, plano §6): el movimiento, los imanes, el tamaño y la rotación usan SOLO `canvas-math`. El
 * componente no calcula posiciones por su cuenta: mide el DOM, le pasa números a `lib/designer/screens/canvas-session.ts`
 * (la única puerta, que usa `canvas-math`) y pinta lo que vuelve.
 *
 * Y la seguridad de lo que dibuja: ningún componente del editor usa `dangerouslySetInnerHTML` ni `innerHTML` (el HTML
 * cargado va SIEMPRE en un `iframe` con `sandbox` sin `allow-scripts`).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const CANVAS = join(ROOT, "components/designer/canvas");
const EDITOR_DIRS = ["list", "new", "editor", "canvas", "layers", "element-toolbar", "pages", "config", "variables"].map((d) => join(ROOT, "components/designer", d));

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1");
}

const canvasFiles = files(CANVAS);

describe("el lienzo no calcula posiciones por su cuenta (F19)", () => {
  it("ningún archivo del lienzo usa Math.*: las cuentas están en canvas-session / canvas-math", () => {
    for (const file of canvasFiles) {
      expect(strip(readFileSync(file, "utf8")), relative(ROOT, file)).not.toMatch(/\bMath\./);
    }
  });

  it("ningún componente del lienzo importa funciones de canvas-math (solo tipos): todo pasa por canvas-session", () => {
    for (const file of canvasFiles) {
      const source = strip(readFileSync(file, "utf8"));
      const imports = [...source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"@\/lib\/designer\/canvas-math"/g)];
      for (const [, isType, names] of imports) {
        expect(isType || /^\s*(?:type\s+\w+\s*,?\s*)+$/.test(names), `${relative(ROOT, file)} importa ${names}`).toBeTruthy();
      }
    }
  });

  it("el lienzo usa los gestos de canvas-session, y canvas-session usa las funciones de canvas-math", () => {
    const stage = readFileSync(join(CANVAS, "canvas-stage.tsx"), "utf8");
    for (const fn of ["startMove", "updateMove", "updateSide", "updateCorner", "updateRotate"]) expect(stage).toContain(fn);
    const session = readFileSync(join(ROOT, "lib/designer/screens/canvas-session.ts"), "utf8");
    for (const fn of ["snap", "resizeWidth", "resizeHeight", "resizeFont", "scaleBox", "rotate", "pointerAngle", "screenToPct", "nudge"]) expect(session).toMatch(new RegExp(`\\b${fn}\\b`));
    expect(session).toContain('from "../canvas-math"');
  });

  it("el lienzo dibuja con las mismas funciones de estilo que el render", () => {
    const view = readFileSync(join(CANVAS, "element-view.tsx"), "utf8");
    expect(view).toContain("elementStyle");
    expect(view).toContain("textInnerStyle");
    expect(view).toContain("toReactStyle");
    expect(readFileSync(join(CANVAS, "canvas-stage.tsx"), "utf8")).toContain("backgroundLayers");
  });
});

describe("lo que dibuja el editor es seguro", () => {
  it("ningún componente del editor inyecta HTML (ni dangerouslySetInnerHTML ni innerHTML)", () => {
    for (const dir of EDITOR_DIRS) {
      for (const file of files(dir)) {
        expect(strip(readFileSync(file, "utf8")), relative(ROOT, file)).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML|outerHTML/);
      }
    }
  });

  it("todo iframe del editor lleva `sandbox` sin allow-scripts", () => {
    for (const dir of EDITOR_DIRS) {
      for (const file of files(dir)) {
        const source = strip(readFileSync(file, "utf8"));
        for (const tag of source.matchAll(/<iframe\b[\s\S]*?\/>|<iframe\b[\s\S]*?>/g)) {
          expect(tag[0], `${relative(ROOT, file)}: iframe sin sandbox`).toMatch(/sandbox/);
          expect(tag[0]).not.toMatch(/allow-scripts|allow-same-origin/);
        }
      }
    }
  });

  it("los componentes del editor no usan `dark:` (los tokens del tema ya cambian solos)", () => {
    for (const dir of EDITOR_DIRS) {
      for (const file of files(dir)) expect(strip(readFileSync(file, "utf8")), relative(ROOT, file)).not.toMatch(/["'`\s]dark:/);
    }
  });
});
