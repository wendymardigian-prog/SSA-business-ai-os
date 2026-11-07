/**
 * El mismo paso se ve con el mismo icono en el panel de pasos y en el lienzo. «Responder por privado» salia con un
 * mensaje en el panel y con un engranaje en el lienzo (un relleno del andamio original): este test lo ata.
 *
 * Lee los dos archivos como texto (son componentes de React y los tests corren en Node).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

/** `actionType: "x"` de cada item del panel con su `icon: Y`. */
function paletteIcons(): Map<string, string> {
  const source = read("node-palette.tsx");
  const out = new Map<string, string>();
  for (const item of source.matchAll(/\{[^{}]*?\}/g)) {
    const body = item[0];
    const action = /actionType:\s*"(\w+)"/.exec(body)?.[1];
    const icon = /icon:\s*(\w+)/.exec(body)?.[1];
    if (action && icon) out.set(action, icon);
  }
  return out;
}

/** `x: { icon: Y, ...}` del mapa del nodo de accion. */
function canvasIcons(): Map<string, string> {
  const source = read("nodes/action-node.tsx");
  const out = new Map<string, string>();
  for (const m of source.matchAll(/^\s{2}(\w+):\s*\{\s*icon:\s*(\w+)/gm)) out.set(m[1], m[2]);
  return out;
}

describe("iconos de los pasos", () => {
  it("cada paso de accion del panel usa el mismo icono en el lienzo", () => {
    const palette = paletteIcons();
    const canvas = canvasIcons();
    expect(palette.size).toBeGreaterThan(5);
    const mismatches = [...palette].filter(([type, icon]) => canvas.has(type) && canvas.get(type) !== icon);
    expect(mismatches).toEqual([]);
  });

  it("ningun paso del panel cae en el engranaje del lienzo", () => {
    const canvas = canvasIcons();
    const cogs = [...paletteIcons().keys()].filter((type) => canvas.get(type) === "Cog");
    expect(cogs).toEqual([]);
  });
});
