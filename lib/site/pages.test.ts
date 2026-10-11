import { describe, it, expect } from "vitest";
import { RESERVED_ROUTES, SITE_PAGES, buildRobots, isReservedPath, sitemapEntries, validateSitePages } from "./pages";

describe("la lista de páginas de la plantilla", () => {
  it("está vacía: cada clon arma la suya", () => {
    expect(SITE_PAGES).toEqual([]);
    expect(validateSitePages(SITE_PAGES)).toEqual([]);
  });
});

describe("validateSitePages", () => {
  it("acepta rutas bien escritas", () => {
    expect(validateSitePages([{ path: "/" }, { path: "/servicios" }, { path: "/blog/hola-mundo", priority: 0.5, lastModified: "2026-10-11" }])).toEqual([]);
  });
  it("rechaza las rutas reservadas del sistema", () => {
    for (const route of RESERVED_ROUTES) {
      expect(validateSitePages([{ path: `/${route}` }]).join(" ")).toMatch(/reservada/);
      expect(validateSitePages([{ path: `/${route}/algo` }]).join(" ")).toMatch(/reservada/);
    }
    expect(isReservedPath("/dashboard")).toBe(true);
    expect(isReservedPath("/servicios")).toBe(false);
    expect(isReservedPath("/")).toBe(false);
  });
  it("rechaza mayúsculas, espacios, sin barra, dobles barras y repetidas", () => {
    expect(validateSitePages([{ path: "/Servicios" }])).not.toEqual([]);
    expect(validateSitePages([{ path: "/mis servicios" }])).not.toEqual([]);
    expect(validateSitePages([{ path: "servicios" }])).not.toEqual([]);
    expect(validateSitePages([{ path: "/a//b" }])).not.toEqual([]);
    expect(validateSitePages([{ path: "/a" }, { path: "/a" }]).join(" ")).toMatch(/repetida/);
  });
  it("rechaza una prioridad fuera de rango o una fecha mal escrita", () => {
    expect(validateSitePages([{ path: "/a", priority: 2 }])).not.toEqual([]);
    expect(validateSitePages([{ path: "/a", lastModified: "11/10/2026" }])).not.toEqual([]);
  });
});

describe("sitemapEntries", () => {
  it("sin páginas no hay entradas", () => {
    expect(sitemapEntries([], "https://app.x")).toEqual([]);
  });
  it("arma las URLs completas (la raíz es la base sola) y deja afuera lo inválido o reservado", () => {
    const out = sitemapEntries([{ path: "/" }, { path: "/servicios", priority: 0.8 }, { path: "/login" }, { path: "/Mal" }], "https://app.x/");
    expect(out).toEqual([{ url: "https://app.x" }, { url: "https://app.x/servicios", priority: 0.8 }]);
  });
});

describe("buildRobots", () => {
  it("sin páginas queda IGUAL que antes: bloquea todo y no menciona un sitemap", () => {
    expect(buildRobots([], "https://app.x")).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });
  it("con páginas bloquea todo, permite solo esas y suma el sitemap", () => {
    expect(buildRobots([{ path: "/" }, { path: "/servicios" }], "https://app.x/")).toEqual({
      rules: [{ userAgent: "*", allow: ["/$", "/servicios"], disallow: "/" }],
      sitemap: "https://app.x/sitemap.xml",
    });
  });
  it("nunca permite una ruta reservada aunque alguien la agregue", () => {
    expect(buildRobots([{ path: "/dashboard" }], "https://app.x")).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });
});
