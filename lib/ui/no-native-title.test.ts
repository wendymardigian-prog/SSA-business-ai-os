/**
 * Los tooltips del sistema son de UN solo tipo: `Tip` (components/ui/tooltip.tsx), instantaneo y con el estilo del menu
 * lateral. El `title=` del navegador tarda 1-2 segundos, se ve distinto en cada sistema y no anda con el teclado ni en
 * el telefono (24/11/2026: se migraron los ~530 que habia).
 *
 * Reemplazar un `title="…"` es envolver el elemento con `<Tip asChild content="…">`; si el elemento no tiene texto
 * visible (un boton de icono), ademas lleva `aria-label`. Un boton que puede estar `disabled` va con el `Tip` con
 * envoltorio (sin `asChild`): deshabilitado no recibe eventos del puntero. `iframe` y `<title>` de un SVG se quedan (no
 * son tooltips). El escaner es `lib/ui/native-title-scan.ts`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNativeTitles } from "./native-title-scan";

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? tsxFiles(rel) : name.endsWith(".tsx") ? [rel] : [];
  });
}

describe("tooltips del sistema", () => {
  it("ninguna pantalla usa el tooltip del navegador (title=): se usa <Tip asChild content=…>", () => {
    const found = [...tsxFiles("components"), ...tsxFiles("app")].flatMap((file) =>
      findNativeTitles(readFileSync(join(ROOT, file), "utf8")).map((hit) => `${file}:${hit.line} <${hit.tag}>`),
    );
    expect(found).toEqual([]);
  });
});
