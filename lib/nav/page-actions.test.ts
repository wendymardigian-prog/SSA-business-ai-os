import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PAGE_META,
  PAGES_WITHOUT_HEADER,
  pageActions,
  pageMetaFor,
  routePattern,
} from "./page-actions";

describe("titulo y explicacion de cada pantalla (F7)", () => {
  it("una ruta simple encuentra su titulo", () => {
    expect(pageMetaFor("/dashboard/contacts")?.title).toBe("Contactos");
  });

  it("una ruta con id encuentra el titulo de su patron", () => {
    expect(pageMetaFor("/dashboard/contacts/9f0d1b6e-1111-2222-3333-444455556666")?.title).toBe(
      "Contacto",
    );
    expect(pageMetaFor("/dashboard/agents/abc/")?.title).toBe("Agente");
    expect(routePattern("/dashboard/agents/runs/xyz")).toBe("/dashboard/agents/runs/[runId]");
  });

  it("una ruta que no existe no inventa un titulo", () => {
    expect(pageMetaFor("/dashboard/inventada")).toBeNull();
  });

  it("toda pantalla tiene explicacion, y ninguna repite el titulo", () => {
    for (const [route, meta] of Object.entries(PAGE_META)) {
      expect(meta.title.length, route).toBeGreaterThan(2);
      expect(meta.tooltip.length, route).toBeGreaterThan(20);
      expect(meta.tooltip, route).not.toBe(meta.title);
    }
  });

  it("las pantallas sin barra dicen por que", () => {
    for (const [route, motivo] of Object.entries(PAGES_WITHOUT_HEADER)) {
      expect(motivo.length, route).toBeGreaterThan(20);
    }
  });
});

describe("acciones de la barra", () => {
  const admin = { isAdmin: true };
  const member = { isAdmin: false };

  it("una pantalla sin acciones devuelve una lista vacia, no rompe", () => {
    expect(pageActions("/dashboard/drafts", admin)).toEqual([]);
    expect(pageActions("/dashboard/inventada", admin)).toEqual([]);
  });

  it("un Member no recibe las acciones de administrador", () => {
    expect(pageActions("/dashboard/knowledge", member)).toEqual([]);
    expect(pageActions("/dashboard/knowledge", admin).map((a) => a.id)).toEqual(["upload"]);
  });

  it("las acciones que son de todos las recibe tambien un Member", () => {
    expect(pageActions("/dashboard/contacts", member).map((a) => a.id)).toEqual(["import", "new"]);
  });

  it("el filtro de integraciones es solo de administradores", () => {
    expect(pageActions("/dashboard/settings/integrations", member)).toEqual([]);
    expect(pageActions("/dashboard/settings/integrations", admin)[0]).toMatchObject({
      id: "attention",
      kind: "toggle",
    });
  });

  it("los links traen a donde van", () => {
    const templates = pageActions("/dashboard/flows", admin).find((a) => a.id === "templates");
    expect(templates?.href).toBe("/dashboard/flows/templates");
  });
});

describe("ninguna pantalla se queda sin barra por olvido", () => {
  it("cada page.tsx del dashboard tiene titulo o esta en la lista de excepciones", () => {
    // En el celular la barra superior es la UNICA via al menu: una pantalla sin
    // barra deja a la persona encerrada. Por eso la excepcion tiene que ser
    // explicita y con motivo, no algo que se note recien usando el telefono.
    const root = resolve(__dirname, "../..");
    const base = join(root, "app/(dashboard)");
    const rutas: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "page.tsx") {
          const rel = full.slice(base.length).replace(/\/page\.tsx$/, "");
          // Los route groups (parentesis) no entran en la URL.
          rutas.push(rel.replace(/\/\([^)]+\)/g, "") || "/");
        }
      }
    };
    walk(base);

    const huerfanas = rutas.filter(
      (ruta) => !PAGE_META[ruta] && !PAGES_WITHOUT_HEADER[ruta],
    );

    expect(huerfanas).toEqual([]);
    expect(rutas.length).toBeGreaterThan(20);
  });
});

describe("cada pantalla dibuja la barra de verdad", () => {
  it("todo page.tsx con titulo llega a PageHeader siguiendo sus imports", async () => {
    // El test de arriba solo mira que la ruta tenga titulo. Este mira que la
    // pantalla efectivamente lo use: sin la barra, en el celular no hay menu y
    // la persona queda encerrada en esa pantalla.
    const { readFileSync, readdirSync, statSync, existsSync } = await import("node:fs");
    const { join, dirname, resolve, relative } = await import("node:path");

    const root = resolve(__dirname, "../..");
    const base = join(root, "app/(dashboard)");
    const EXT = [".ts", ".tsx"];

    const resolveImport = (from: string, spec: string): string | null => {
      let candidate: string | null = null;
      if (spec.startsWith("@/")) candidate = join(root, spec.slice(2));
      else if (spec.startsWith(".")) candidate = resolve(dirname(from), spec);
      if (!candidate) return null;
      const tries = [candidate, ...EXT.map((e) => candidate + e), ...EXT.map((e) => join(candidate!, "index" + e))];
      return tries.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
    };

    /** ¿Este archivo, o alguno de los que importa, renderiza <PageHeader? */
    const rendersHeader = (entry: string, seen = new Set<string>()): boolean => {
      if (seen.has(entry) || seen.size > 60) return false;
      seen.add(entry);
      const source = readFileSync(entry, "utf8");
      if (source.includes("<PageHeader")) return true;
      const specs = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specs) {
        const next = resolveImport(entry, spec);
        if (next && !next.includes("node_modules") && rendersHeader(next, seen)) return true;
      }
      return false;
    };

    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "page.tsx") pages.push(full);
      }
    };
    walk(base);

    const sinBarra = pages
      .filter((file) => {
        const ruta = file.slice(base.length).replace(/\/page\.tsx$/, "").replace(/\/\([^)]+\)/g, "") || "/";
        return PAGE_META[ruta] && !rendersHeader(file);
      })
      .map((f) => relative(root, f));

    expect(sinBarra).toEqual([]);
  });
});
