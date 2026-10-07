import { describe, expect, it } from "vitest";
import { isEmbeddablePath, nextHeadersConfig, securityHeadersFor } from "./security-headers";

const csp = (path: string) => securityHeadersFor(path).find((h) => h.key === "Content-Security-Policy")?.value;
const xfo = (path: string) => securityHeadersFor(path).find((h) => h.key === "X-Frame-Options")?.value;

describe("encabezados por ruta (§15)", () => {
  it("/calendario/* y /embed/* se pueden embeber", () => {
    for (const p of ["/calendario/ana/llamada", "/calendario/agenda/abc", "/embed/embed.js", "/calendario"]) {
      expect(isEmbeddablePath(p)).toBe(true);
      expect(csp(p)).toBe("frame-ancestors *");
      expect(xfo(p)).toBeUndefined();
    }
  });

  it("el resto de la app no se embebe (DENY)", () => {
    for (const p of ["/", "/dashboard", "/dashboard/agenda", "/login", "/api/public/scheduling/slots", "/calendarios", "/embedded"]) {
      expect(isEmbeddablePath(p)).toBe(false);
      expect(csp(p)).toBe("frame-ancestors 'none'");
      expect(xfo(p)).toBe("DENY");
    }
  });

  it("la configuracion de next cubre las tres fuentes sin superponerse", () => {
    const config = nextHeadersConfig();
    expect(config.map((c) => c.source)).toEqual(["/calendario/:path*", "/embed/:path*", "/((?!calendario|embed).*)"]);
    expect(config[0].headers[0].value).toBe("frame-ancestors *");
    expect(config[2].headers.some((h) => h.key === "X-Frame-Options")).toBe(true);
  });
});
