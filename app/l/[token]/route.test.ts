import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { signTrackedLink } from "@/lib/attribution/tracked-link";

const WS = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const F = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const SECRET = "secreto-de-prueba";
const DEST = "https://example.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f";
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

let db: MemoryDb;
const touches: Array<Record<string, unknown>> = [];
let afterQueue: Array<() => unknown> = [];
let bump = 1;

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void afterQueue.push(fn) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://app.example.test" }));

const { GET } = await import("./route");

const call = async (token: string, ua: string | null = BROWSER) => {
  const res = await GET(new Request(`https://app.example.test/l/${token}`, { headers: ua ? { "user-agent": ua, "x-forwarded-for": "9.9.9.9" } : {} }), { params: Promise.resolve({ token }) });
  for (const fn of afterQueue.splice(0)) await fn();
  return res;
};
const good = () => signTrackedLink({ w: WS, c: C, u: DEST, f: F, p: P }, SECRET);

beforeEach(() => {
  touches.length = 0;
  afterQueue = [];
  bump = 1;
  db = memoryDb({}, { rpc: { read_secret: () => SECRET, bump_rate_limit: () => bump, record_contact_touch: (a) => (touches.push(a), { inserted: true }) } });
});

describe("GET /l/<token>", () => {
  it("un token válido: 302 al destino, sin caché, y deja el toque link_click", async () => {
    const res = await call(good());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(DEST);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer-when-downgrade");
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ p_workspace_id: WS, p_contact_id: C });
    expect(touches[0].p_touch).toMatchObject({ origin: "link_click", medium: "dm_link", content_post_id: P, landing_page: DEST });
  });

  it("un previsualizador redirige y NO registra", async () => {
    const res = await call(good(), "facebookexternalhit/1.1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(DEST);
    expect(touches).toHaveLength(0);
  });

  it("un token alterado o basura redirige a la app sin error ni toque", async () => {
    for (const t of [good().slice(0, -2) + "xx", "basura", "a.b"]) {
      const res = await call(t);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://app.example.test/");
    }
    expect(touches).toHaveLength(0);
  });

  it("el destino NO se puede elegir por la URL (no hay ?to=)", async () => {
    const res = await GET(new Request(`https://app.example.test/l/basura?to=https://evil.example`, { headers: { "user-agent": BROWSER } }), { params: Promise.resolve({ token: "basura" }) });
    expect(res.headers.get("location")).toBe("https://app.example.test/");
  });

  it("pasado el tope por IP responde 429", async () => {
    bump = 121;
    const res = await call(good());
    expect(res.status).toBe(429);
    expect(touches).toHaveLength(0);
  });

  it("si la base se cae, igual redirige a la app y no da 500", async () => {
    db = memoryDb({}, { rpc: { read_secret: () => { throw new Error("caída"); }, bump_rate_limit: () => 1 } });
    const res = await call(good());
    expect(res.status).toBe(302);
  });
});
