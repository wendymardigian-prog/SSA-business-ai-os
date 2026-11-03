import { describe, expect, it, vi } from "vitest";
import { BlockedUrlError } from "@/lib/net/safe-fetch";
import { checkDomainPointsHere, INSTANCE_PATH, instanceFingerprint } from "./domain-check";

const ORIGIN = "https://links.negocio.com";
const publicUrl = async (url: string) => new URL(url);
const respond = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));

describe("checkDomainPointsHere", () => {
  it("el dominio responde con la huella de esta instalación: sirve", async () => {
    const fetchImpl = respond(200, JSON.stringify({ instance: "abc" }));
    expect(await checkDomainPointsHere(ORIGIN, { fetchImpl, checkUrl: publicUrl, fingerprint: "abc" })).toEqual({ ok: true });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(`${ORIGIN}${INSTANCE_PATH}`);
  });

  it("otra instalación u otra web: no se guarda", async () => {
    for (const fetchImpl of [respond(200, JSON.stringify({ instance: "otra" })), respond(200, "<html>mi web</html>"), respond(404, "")]) {
      const out = await checkDomainPointsHere(ORIGIN, { fetchImpl, checkUrl: publicUrl, fingerprint: "abc" });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toContain("abre otra página");
    }
  });

  it("no responde (DNS sin apuntar, caído): explica qué revisar", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    for (const fetchImpl of [down, respond(502, "")]) {
      const out = await checkDomainPointsHere(ORIGIN, { fetchImpl, checkUrl: publicUrl, fingerprint: "abc" });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toContain("Railway");
    }
  });

  it("una dirección interna se rechaza sin pedirle nada", async () => {
    const fetchImpl = respond(200, "{}");
    const out = await checkDomainPointsHere(ORIGIN, {
      fetchImpl,
      checkUrl: async () => {
        throw new BlockedUrlError("interna");
      },
    });
    expect(out.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("la huella es estable y distinta por proyecto", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://a.supabase.co");
    const a = instanceFingerprint();
    expect(instanceFingerprint()).toBe(a);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://b.supabase.co");
    expect(instanceFingerprint()).not.toBe(a);
    vi.unstubAllEnvs();
  });
});
