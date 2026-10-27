import { describe, expect, it } from "vitest";
import { isEmbeddablePath, nextHeadersConfig, securityHeadersFor } from "./security-headers";

const csp = (path: string) => securityHeadersFor(path).find((h) => h.key === "Content-Security-Policy")?.value;
const xfo = (path: string) => securityHeadersFor(path).find((h) => h.key === "X-Frame-Options")?.value;

describe("encabezados por ruta (§15)", () => {
  it("/calendario/*, /embed/* y /f/* se pueden embeber", () => { // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): it("/calendario/* y /embed/* se pueden embeber", () => {
    for (const p of ["/calendario/ana/llamada", "/calendario/agenda/abc", "/embed/embed.js", "/calendario", "/f/aplicacion", "/f"]) { // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): for (const p of ["/calendario/ana/llamada", "/calendario/agenda/abc", "/embed/embed.js", "/calendario"]) {
      expect(isEmbeddablePath(p)).toBe(true);
      expect(csp(p)).toBe("frame-ancestors *");
      expect(xfo(p)).toBeUndefined();
    }
  });

  it("el resto de la app no se embebe (DENY)", () => {
    for (const p of ["/", "/dashboard", "/dashboard/agenda", "/login", "/api/public/scheduling/slots", "/calendarios", "/embedded", "/formulario", "/favicon.ico", "/ejemplo"]) {
      expect(isEmbeddablePath(p)).toBe(false);
      expect(csp(p)).toBe("frame-ancestors 'none'");
      expect(xfo(p)).toBe("DENY");
    }
  });

  // @plantilla-desde(formularios)
  it("la configuracion de next cubre las cuatro fuentes sin superponerse", () => {
    const config = nextHeadersConfig();
    expect(config.map((c) => c.source)).toEqual([
      "/calendario/:path*",
      "/embed/:path*",
      "/f/:path*",
      "/((?!calendario|embed|f/).*)",
    ]);
    expect(config[0].headers[0].value).toBe("frame-ancestors *");
    expect(config[2].headers[0].value).toBe("frame-ancestors *");
    expect(config[3].headers.some((h) => h.key === "X-Frame-Options")).toBe(true);
  });
  // @plantilla-hasta(formularios)
  // @plantilla-sin(formularios): it("la configuracion de next cubre las tres fuentes sin superponerse", () => { const config = nextHeadersConfig(); expect(config.map((c) => c.source)).toEqual(["/calendario/:path*", "/embed/:path*", "/((?!calendario|embed).*)"]); expect(config[0].headers[0].value).toBe("frame-ancestors *"); expect(config[2].headers.some((h) => h.key === "X-Frame-Options")).toBe(true); });

  it("el filtro del resto deja afuera /f/... y solo eso: /dashboard sigue con DENY", () => { // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): it("el filtro del resto deja afuera lo embebible: /dashboard sigue con DENY", () => {
    const rest = nextHeadersConfig()[3]; // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): const rest = nextHeadersConfig()[2];
    const regex = new RegExp(`^${rest.source.replace("/(", "/(")}$`);
    expect(regex.test("/f/aplicacion")).toBe(false); // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): expect(regex.test("/embed/embed.js")).toBe(false);
    for (const p of ["/dashboard", "/dashboard/formularios", "/favicon.ico", "/formulario", "/login", "/"]) {
      expect(regex.test(p), p).toBe(true);
    }
    expect(csp("/dashboard/formularios")).toBe("frame-ancestors 'none'");
    expect(xfo("/dashboard/formularios")).toBe("DENY");
  });
});
