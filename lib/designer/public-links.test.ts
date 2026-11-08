import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { designDownloadUrl, designLinksFor, designPublicUrl, loadDesignLinks, normalizeDesignCode } from "./public-links";

const MAIN = "https://app.principal.test";
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", MAIN));

describe("links públicos del Diseñador IA (V4)", () => {
  it("sin dominio propio, el principal", () => {
    expect(designLinksFor({ scheduling_public_base_url: null }, "K8F2-WQ4M-7TQA")).toEqual({
      link: `${MAIN}/d/K8F2-WQ4M-7TQA`,
      pdfUrl: `${MAIN}/d/K8F2-WQ4M-7TQA/descargar?formato=pdf`,
      zipUrl: `${MAIN}/d/K8F2-WQ4M-7TQA/descargar?formato=zip`,
    });
  });

  it("con dominio propio, el del negocio", () => {
    const links = designLinksFor({ scheduling_public_base_url: "https://links.negocio.test" }, "K8F2-WQ4M-7TQA");
    expect(links.link.startsWith("https://links.negocio.test/d/")).toBe(true);
    expect(links.pdfUrl.startsWith("https://links.negocio.test/d/")).toBe(true);
  });

  it("leyendo de la base: con y sin dominio propio, y si la base falla el principal", async () => {
    const db = (value: string | null, fail = false) => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => (fail ? { data: null, error: { message: "x" } } : { data: { scheduling_public_base_url: value }, error: null }) }),
        }),
      }),
    });
    expect((await loadDesignLinks(db("https://links.negocio.test"), "ws", "K8F2-WQ4M-7TQA")).link).toBe("https://links.negocio.test/d/K8F2-WQ4M-7TQA");
    expect((await loadDesignLinks(db(null), "ws", "K8F2-WQ4M-7TQA")).link).toBe(`${MAIN}/d/K8F2-WQ4M-7TQA`);
    expect((await loadDesignLinks(db(null, true), "ws", "K8F2-WQ4M-7TQA")).link).toBe(`${MAIN}/d/K8F2-WQ4M-7TQA`);
  });

  it("la descarga de una página lleva el número", () => {
    expect(designDownloadUrl("https://x.test", "AAAA-BBBB-CCCC", { formato: "png", pagina: 3 })).toBe("https://x.test/d/AAAA-BBBB-CCCC/descargar?formato=png&pagina=3");
    expect(designPublicUrl("https://x.test/", "AAAA-BBBB-CCCC")).toBe("https://x.test/d/AAAA-BBBB-CCCC");
  });

  it("normaliza el código de la URL (mayúsculas, alfabeto Crockford)", () => {
    expect(normalizeDesignCode("k8f2-wq4m-7tqa")).toBe("K8F2-WQ4M-7TQA");
    expect(normalizeDesignCode("K8F2-WQ4M-7TQU")).toBeNull();
    // Crockford: lo que se confunde al tipear desde un impreso se lee como lo que es.
    expect(normalizeDesignCode("4DYJ-P727-SKOY")).toBe("4DYJ-P727-SK0Y");
    expect(normalizeDesignCode("K2RY-AQAH-ILWR")).toBe("K2RY-AQAH-11WR");
    expect(normalizeDesignCode("../../etc")).toBeNull();
  });
});

describe("frontera: ningún archivo del Diseñador IA arma un link de afuera con el dominio del navegador ni con la variable", () => {
  const roots = ["lib/designer", "components/designer", "app/d", "app/(dashboard)/dashboard/disenos", "lib/actions/designer"];
  const walk = (dir: string): string[] => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  };
  const files = roots.flatMap((dir) => walk(dir));

  it("sin window.location.origin, NEXT_PUBLIC_APP_URL ni appUrl()", () => {
    const offenders = files.filter((p) => /location\.origin|NEXT_PUBLIC_APP_URL|\bappUrl\(/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
