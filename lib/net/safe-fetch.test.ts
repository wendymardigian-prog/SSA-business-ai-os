import { describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isBlockedAddress, safeFetch } from "./safe-fetch";

describe("isBlockedAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "bloquea %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"])("deja pasar %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it("rechaza protocolos raros, credenciales y localhost sin resolver nada", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://user:pass@example.com")).rejects.toThrow(/usuario/);
    await expect(assertPublicUrl("http://localhost:3000")).rejects.toThrow(/internas/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/internas/);
  });
});

describe("safeFetch", () => {
  const ok = async (u: string) => new URL(u);
  it("corta la respuesta al tope y lo marca", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(100), { status: 200 }));
    const r = await safeFetch("https://api.example.com", { method: "GET" }, { fetchImpl: fetchImpl as never, checkUrl: ok, maxBytes: 10 });
    expect(r.text).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it("vuelve a validar cada redireccion", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    // Sin DNS en el test: la primera direccion pasa, la de la redireccion la frena la misma regla de IPs.
    const check = async (u: string) => {
      const url = new URL(u);
      if (isBlockedAddress(url.hostname)) throw new Error("bloqueada");
      return url;
    };
    await expect(safeFetch("https://93.184.216.34", { method: "GET" }, { fetchImpl: fetchImpl as never, checkUrl: check })).rejects.toThrow("bloqueada");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("un 500 vuelve con ok=false, no como una respuesta buena", async () => {
    const fetchImpl = vi.fn(async () => new Response("error", { status: 500 }));
    const r = await safeFetch("https://api.example.com", { method: "POST", body: "{}" }, { fetchImpl: fetchImpl as never, checkUrl: ok });
    expect(r).toMatchObject({ status: 500, ok: false, text: "error" });
  });
});
