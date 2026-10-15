import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { attributeOutgoing, readNodeAttribution } from "./outgoing-links";
import { verifyTrackedLink } from "./tracked-link";

vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://app.example.test" }));

const WS = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const FLOW = "33333333-3333-4333-8333-333333333333";
const CP = "44444444-4444-4444-8444-444444444444";
let secrets: Record<string, string>;

const world = () => {
  secrets = {};
  return memoryDb(
    { flows: [{ id: FLOW, name: "Info del reel" }] },
    {
      rpc: {
        read_secret: (a) => secrets[String(a.secret_name)] ?? null,
        store_secret: (a) => { secrets[String(a.secret_name)] = String(a.secret_value); return null; },
      },
    },
  ).client;
};
const ctx = (over: Record<string, unknown> = {}) => ({ workspaceId: WS, contactId: CONTACT, flowId: FLOW, platform: "instagram", variables: {}, ...over });
const message = () => ({
  text: "Mirá https://wendy.com/programa y escribime a https://wa.me/123",
  buttons: [{ title: "Ver", type: "url", url: "https://wendy.com/programa" }, { title: "Hola", type: "postback", payload: "p" }],
  template: { elements: [{ title: "Uno", buttons: [{ type: "url", title: "Abrir", url: "https://wendy.com/a" }] }] },
});

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("readNodeAttribution", () => {
  it("solo 'append: true' lo enciende; lo demás es apagado", () => {
    expect(readNodeAttribution(undefined)).toBeNull();
    expect(readNodeAttribution({ append: false, trackClicks: true })).toBeNull();
    expect(readNodeAttribution({ append: "true" })).toBeNull();
    expect(readNodeAttribution({ append: true })).toEqual({ append: true, trackClicks: false });
    expect(readNodeAttribution({ append: true, trackClicks: true })).toEqual({ append: true, trackClicks: true });
  });
});

describe("attributeOutgoing", () => {
  it("apagado devuelve el MISMO objeto y no lee nada", async () => {
    const m = message();
    const db = world();
    expect(await attributeOutgoing(db, ctx(), undefined, m)).toBe(m);
    expect(await attributeOutgoing(db, ctx(), { append: false, trackClicks: true }, m)).toBe(m);
  });

  it("con append: agrega los UTM al link del texto, al botón URL y al del carrusel; no toca wa.me ni los postback", async () => {
    const out = await attributeOutgoing(world(), ctx({ variables: { content: { code: "c8k2f" } } }), { append: true, trackClicks: false }, message());
    const utm = "utm_source=instagram&utm_medium=dm&utm_campaign=info-del-reel&utm_content=c8k2f";
    expect(out.text).toBe(`Mirá https://wendy.com/programa?${utm} y escribime a https://wa.me/123`);
    expect(out.buttons?.[0].url).toBe(`https://wendy.com/programa?${utm}`);
    expect(out.buttons?.[1]).toEqual({ title: "Hola", type: "postback", payload: "p" });
    expect(out.template?.elements[0].buttons?.[0].url).toBe(`https://wendy.com/a?${utm}`);
  });

  it("sin pieza, utm_content es el código del flujo", async () => {
    const out = await attributeOutgoing(world(), ctx(), { append: true, trackClicks: false }, { text: "https://a.com/x" });
    expect(out.text).toContain("utm_content=f-33333333");
  });

  it("nunca pisa un parámetro que el link ya trae", async () => {
    const out = await attributeOutgoing(world(), ctx(), { append: true, trackClicks: false }, { text: "https://a.com/x?utm_source=bio#ancla" });
    expect(out.text).toBe("https://a.com/x?utm_source=bio&utm_medium=dm&utm_campaign=info-del-reel&utm_content=f-33333333#ancla");
  });

  it("con seguimiento, cada link de destino sale como /l/<token> firmado con el destino ya con UTM, la pieza y el flujo", async () => {
    const db = world();
    const out = await attributeOutgoing(db, ctx({ variables: { content: { code: "c8k2f", content_post_id: CP } } }), { append: true, trackClicks: true }, message());
    const link = /https:\/\/app\.example\.test\/l\/(\S+)/.exec(out.text);
    expect(link).not.toBeNull();
    expect(out.text).toContain("https://wa.me/123"); // el link de chat no se envuelve
    const verified = verifyTrackedLink(link![1], secrets.attribution_link_secret);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toMatchObject({ w: WS, c: CONTACT, f: FLOW, p: CP, s: null });
      expect(verified.payload.u).toBe("https://wendy.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-del-reel&utm_content=c8k2f");
    }
    expect(out.buttons?.[0].url).toMatch(/^https:\/\/app\.example\.test\/l\//);
    expect(out.template?.elements[0].buttons?.[0].url).toMatch(/^https:\/\/app\.example\.test\/l\//);
    expect(Object.keys(secrets)).toEqual(["attribution_link_secret"]);
  });

  it("sin contacto, el link sale con UTM pero SIN seguimiento", async () => {
    const out = await attributeOutgoing(world(), ctx({ contactId: null }), { append: true, trackClicks: true }, { text: "https://a.com/x" });
    expect(out.text).toBe("https://a.com/x?utm_source=instagram&utm_medium=dm&utm_campaign=info-del-reel&utm_content=f-33333333");
  });

  it("si no puede firmar (Vault caído), el link sale con sus UTM y no lanza", async () => {
    const db = memoryDb({ flows: [{ id: FLOW, name: "x" }] }, { rpc: { read_secret: () => null, store_secret: () => { throw new Error("vault caído"); } } }).client;
    const out = await attributeOutgoing(db, ctx(), { append: true, trackClicks: true }, { text: "https://a.com/x" });
    expect(out.text).toContain("utm_source=instagram");
    expect(out.text).not.toContain("/l/");
  });

  it("el mismo link repetido se firma una vez y el texto sin links no cambia", async () => {
    const db = world();
    const out = await attributeOutgoing(db, ctx(), { append: true, trackClicks: true }, { text: "https://a.com/x y otra vez https://a.com/x" });
    const links = out.text.match(/\/l\/\S+/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links[0]).toBe(links[1]);
    const plain = { text: "Hola sin links" };
    expect(await attributeOutgoing(db, ctx(), { append: true, trackClicks: true }, plain)).toBe(plain);
  });
});
