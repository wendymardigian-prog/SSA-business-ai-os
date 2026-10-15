import { describe, expect, it } from "vitest";
import { LINK_CLICKS_PER_MINUTE, clickTouchFor, resolveLinkClick, type LinkClickDeps } from "./link-click";
import { signTrackedLink } from "./tracked-link";

const WS = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const F = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const S = "55555555-5555-4555-8555-555555555555";
const SECRET = "secreto-de-prueba";
const NOW = Date.parse("2026-10-10T15:00:00Z");
const DEST = "https://wendy.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f";
const APP = "https://app.example.test";
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

const deps = (over: Partial<LinkClickDeps> = {}): LinkClickDeps => ({
  readSecret: async () => SECRET,
  limit: async () => ({ allowed: true }),
  fallbackUrl: APP,
  now: () => NOW,
  ...over,
});
const token = (over: Partial<Parameters<typeof signTrackedLink>[0]> = {}, secret = SECRET) =>
  signTrackedLink({ w: WS, c: C, u: DEST, f: F, p: P, s: S, ...over }, secret, NOW);
const open = (t: unknown, ua: string | null = BROWSER, d: Partial<LinkClickDeps> = {}) => resolveLinkClick({ token: t, userAgent: ua, ip: "1.2.3.4" }, deps(d));

describe("resolveLinkClick", () => {
  it("un token válido en un navegador: 302 al destino y un toque link_click con la pieza", async () => {
    const r = await open(token());
    expect(r.status).toBe(302);
    expect(r.location).toBe(DEST);
    expect(r.touch).toMatchObject({
      workspaceId: WS,
      contactId: C,
      input: { origin: "link_click", medium: "dm_link", source: "instagram", campaign: "info-reel", content: "c8k2f", contentPostId: P, socialPostId: S, landingPage: DEST },
    });
  });

  it("la clave es uno por día, por persona y pieza (la misma el mismo día, otra al día siguiente)", async () => {
    const a = clickTouchFor({ v: 1, w: WS, c: C, u: DEST, f: F, p: P, s: null, e: 9e9 }, new Date("2026-10-10T01:00:00Z")).input.dedupeKey;
    const b = clickTouchFor({ v: 1, w: WS, c: C, u: DEST, f: F, p: P, s: null, e: 9e9 }, new Date("2026-10-10T23:00:00Z")).input.dedupeKey;
    const c = clickTouchFor({ v: 1, w: WS, c: C, u: DEST, f: F, p: P, s: null, e: 9e9 }, new Date("2026-10-11T01:00:00Z")).input.dedupeKey;
    expect(a).toBe(`click:${C}:${F}:${P}:2026-10-10`);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("sin pieza, la clave usa el flujo", () => {
    expect(clickTouchFor({ v: 1, w: WS, c: C, u: DEST, f: F, p: null, s: null, e: 9e9 }, new Date(NOW)).input.dedupeKey).toBe(`click:${C}:${F}:${F}:2026-10-10`);
  });

  it("un previsualizador de links redirige SIN registrar", async () => {
    for (const ua of ["facebookexternalhit/1.1", "WhatsApp/2.23.20", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; Googlebot/2.1)", "TelegramBot (like TwitterBot)"]) {
      const r = await open(token(), ua);
      expect(r.status).toBe(302);
      expect(r.location).toBe(DEST);
      expect(r.touch).toBeNull();
    }
  });

  it("un token alterado redirige a la app, sin registrar y sin error (NO al destino que dice el texto)", async () => {
    const t = token();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "https://evil.example/phish" })).toString("base64url") + "." + sig;
    const r = await open(forged);
    expect(r).toEqual({ status: 302, location: APP, touch: null });
    expect(await open(t.slice(0, -3) + "AAA")).toEqual({ status: 302, location: APP, touch: null });
  });

  it("un token firmado con otro secreto, sin secreto, o basura, cae a la app", async () => {
    expect((await open(token({}, "otro-secreto"))).location).toBe(APP);
    expect((await open(token(), BROWSER, { readSecret: async () => null })).location).toBe(APP);
    for (const junk of ["", "x", "a.b", null, undefined, 42, "a".repeat(5000)]) {
      expect(await open(junk)).toEqual({ status: 302, location: APP, touch: null });
    }
  });

  it("vencido pero con firma válida: redirige al destino sin registrar", async () => {
    const expired = signTrackedLink({ w: WS, c: C, u: DEST, f: F, e: Math.floor(NOW / 1000) - 10 }, SECRET, NOW);
    const r = await open(expired);
    expect(r).toEqual({ status: 302, location: DEST, touch: null });
  });

  it("si el secreto no se puede leer (la base falla), cae a la app sin lanzar", async () => {
    const r = await open(token(), BROWSER, { readSecret: async () => { throw new Error("vault"); } });
    expect(r).toEqual({ status: 302, location: APP, touch: null });
  });

  it("pasado el tope por IP responde 429 y no mira el token", async () => {
    let read = 0;
    const r = await open(token(), BROWSER, { limit: async () => ({ allowed: false }), readSecret: async () => (read++, SECRET) });
    expect(r).toEqual({ status: 429, location: null, touch: null });
    expect(read).toBe(0);
    expect(LINK_CLICKS_PER_MINUTE).toBe(120);
  });
});
