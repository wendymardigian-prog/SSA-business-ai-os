import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { businessDomain, canonicalRedirectUrl, loadPublicBaseUrl, normalizeDomainInput, publicBaseUrl } from "./public-url";

const MAIN = "https://system.empresa.com";
const RAILWAY = "app-production.up.railway.app";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", MAIN));
afterEach(() => vi.unstubAllEnvs());

describe("publicBaseUrl", () => {
  it("sin dominio propio: el principal", () => {
    expect(publicBaseUrl(null)).toBe(MAIN);
    expect(publicBaseUrl({ scheduling_public_base_url: null })).toBe(MAIN);
    expect(publicBaseUrl({ scheduling_public_base_url: "  " })).toBe(MAIN);
  });
  it("con dominio propio: el del negocio, sin barra final", () => {
    expect(publicBaseUrl({ scheduling_public_base_url: "https://links.negocio.com/" })).toBe("https://links.negocio.com");
  });
  it("un valor roto, http o local nunca llega a un link", () => {
    for (const bad of ["no es url", "http://links.negocio.com", "https://localhost:3000", "ftp://x.com"]) {
      expect(businessDomain({ scheduling_public_base_url: bad })).toBeNull();
      expect(publicBaseUrl({ scheduling_public_base_url: bad })).toBe(MAIN);
    }
  });
});

describe("loadPublicBaseUrl", () => {
  const db = (result: { data: unknown; error: unknown } | Error) => ({
    from: () => ({
      select: (cols: string) => {
        expect(cols).toBe("scheduling_public_base_url");
        return {
          eq: () => ({
            maybeSingle: async () => {
              if (result instanceof Error) throw result;
              return result;
            },
          }),
        };
      },
    }),
  });

  it("lee el dominio del negocio", async () => {
    expect(await loadPublicBaseUrl(db({ data: { scheduling_public_base_url: "https://links.negocio.com" }, error: null }), "ws")).toBe("https://links.negocio.com");
  });
  it("si la base falla o tira, el principal (el link igual funciona)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadPublicBaseUrl(db({ data: null, error: { message: "x" } }), "ws")).toBe(MAIN);
    expect(await loadPublicBaseUrl(db(new Error("red")), "ws")).toBe(MAIN);
    spy.mockRestore();
  });
});

describe("normalizeDomainInput", () => {
  it("acepta el dominio solo o con https y barra", () => {
    expect(normalizeDomainInput("links.negocio.com")).toEqual({ ok: true, origin: "https://links.negocio.com" });
    expect(normalizeDomainInput(" https://Links.Negocio.com/ ")).toEqual({ ok: true, origin: "https://links.negocio.com" });
  });
  it("vacío = volver al principal", () => {
    expect(normalizeDomainInput("")).toEqual({ ok: true, origin: null });
  });
  it.each([
    ["http://links.negocio.com", "https://"],
    ["https://links.negocio.com/agenda", "Solo el dominio"],
    ["https://links.negocio.com?x=1", "Solo el dominio"],
    ["https://user:pass@links.negocio.com", "usuario"],
    ["localhost:3000", "local"],
    ["negocio", "terminación"],
    [RAILWAY, "Railway"],
    ["ftp://links.negocio.com", "https://"],
  ])("rechaza %s", (raw, message) => {
    const out = normalizeDomainInput(raw);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain(message);
  });
});

describe("canonicalRedirectUrl", () => {
  const go = (over: Partial<Parameters<typeof canonicalRedirectUrl>[0]> = {}) =>
    canonicalRedirectUrl({ url: `https://${RAILWAY}/dashboard/agenda?vista=semana`, method: "GET", host: RAILWAY, mainUrl: MAIN, ...over });

  it("una página abierta por Railway va al principal, con su ruta y parámetros", () => {
    expect(go()).toBe(`${MAIN}/dashboard/agenda?vista=semana`);
    expect(go({ url: `https://${RAILWAY}/f/aplicacion?utm_source=ig`, method: "HEAD" })).toBe(`${MAIN}/f/aplicacion?utm_source=ig`);
    expect(go({ host: `${RAILWAY}:443` })).toBe(`${MAIN}/dashboard/agenda?vista=semana`);
  });
  it("el dominio principal, uno propio o local no se tocan", () => {
    expect(go({ host: "system.empresa.com" })).toBeNull();
    expect(go({ host: "links.negocio.com" })).toBeNull();
    expect(go({ host: "localhost:3000" })).toBeNull();
    expect(go({ host: null })).toBeNull();
  });
  it("nunca la API (webhooks, baja en un clic), auth, el embed ni un envío", () => {
    expect(go({ url: `https://${RAILWAY}/api/webhooks/late` })).toBeNull();
    expect(go({ url: `https://${RAILWAY}/api/email/baja/abc` })).toBeNull();
    expect(go({ url: `https://${RAILWAY}/auth/callback?code=1` })).toBeNull();
    expect(go({ url: `https://${RAILWAY}/embed/embed.js` })).toBeNull();
    expect(go({ url: `https://${RAILWAY}/calendario/ana/llamada?embed=1` })).toBeNull();
    expect(go({ url: `https://${RAILWAY}/f/aplicacion?embed=1` })).toBeNull();
    expect(go({ method: "POST" })).toBeNull();
  });
  it("sin un principal https propio, no redirige (nunca un bucle)", () => {
    expect(go({ mainUrl: "" })).toBeNull();
    expect(go({ mainUrl: "http://localhost:3000" })).toBeNull();
    expect(go({ mainUrl: `https://${RAILWAY}` })).toBeNull();
    expect(go({ mainUrl: "https://otro.up.railway.app" })).toBeNull();
  });
});

describe("frontera: una sola fuente de los dominios", () => {
  const ROOT = join(__dirname, "..");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name.startsWith(".")) return [];
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }
  const source = ["lib", "app", "components"].flatMap((d) => files(join(ROOT, d))).concat(join(ROOT, "middleware.ts"));
  const rel = (p: string) => p.slice(ROOT.length + 1);

  it("solo lib/app-url.ts lee NEXT_PUBLIC_APP_URL", () => {
    const offenders = source.filter((p) => rel(p) !== "lib/app-url.ts" && /process\.env\.NEXT_PUBLIC_APP_URL/.test(readFileSync(p, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("ningún link se arma con el dominio del navegador (window.location.origin)", () => {
    // trend-explorer copia la URL de la MISMA pantalla que se está mirando: no es un link público.
    const allowed = new Set(["components/dashboards/trend-explorer.tsx"]);
    const offenders = source.filter((p) => !allowed.has(rel(p)) && /location\.origin/.test(readFileSync(p, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });
});
