import { describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isBlockedAddress, safeFetch } from "./safe-fetch";

describe("isBlockedAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:7f00:1]", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:0:4136:e378::1", "fec0::1", "ff02::1", "no-es-una-ip"])(
    "bloquea %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"])("deja pasar %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it("rechaza protocolos raros, credenciales y localhost sin resolver nada", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://user:pass@example.com")).rejects.toThrow(/usuario/);
    await expect(assertPublicUrl("http://localhost:3000")).rejects.toThrow(/internas/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/internas/);
    // `new URL` lo normaliza a [::ffff:7f00:1]: escrito asi, antes pasaba el filtro.
    await expect(assertPublicUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow(/internas/);
    await expect(assertPublicUrl("http://[::ffff:169.254.169.254]/latest/meta-data")).rejects.toThrow(/internas/);
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

  it("dice el tipo de contenido y la direccion final despues de redirigir", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://destino.example.com/nota" } }))
      .mockResolvedValueOnce(new Response("<p>hola</p>", { status: 200, headers: { "content-type": "Text/HTML; charset=utf-8" } }));
    const r = await safeFetch("https://a.example.com/l/x", { method: "GET" }, { fetchImpl: fetchImpl as never, checkUrl: ok });
    expect(r).toMatchObject({ contentType: "text/html", finalUrl: "https://destino.example.com/nota", text: "<p>hola</p>" });
  });

  it("respeta el juego de caracteres del encabezado y el del <meta>", async () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // "café"
    const conEncabezado = vi.fn(async () => new Response(latin1, { headers: { "content-type": "text/plain; charset=iso-8859-1" } }));
    expect((await safeFetch("https://a.example.com", { method: "GET" }, { fetchImpl: conEncabezado as never, checkUrl: ok })).text).toBe("café");

    const html = Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><title>'), Buffer.from(latin1), Buffer.from("</title>")]);
    const conMeta = vi.fn(async () => new Response(html, { headers: { "content-type": "text/html" } }));
    expect((await safeFetch("https://a.example.com", { method: "GET" }, { fetchImpl: conMeta as never, checkUrl: ok })).text).toContain("<title>café</title>");
  });

  it("un juego de caracteres desconocido cae en UTF-8, sin lanzar", async () => {
    const fetchImpl = vi.fn(async () => new Response("hola", { headers: { "content-type": "text/plain; charset=inventado" } }));
    expect((await safeFetch("https://a.example.com", { method: "GET" }, { fetchImpl: fetchImpl as never, checkUrl: ok })).text).toBe("hola");
  });

  it("un 500 vuelve con ok=false, no como una respuesta buena", async () => {
    const fetchImpl = vi.fn(async () => new Response("error", { status: 500 }));
    const r = await safeFetch("https://api.example.com", { method: "POST", body: "{}" }, { fetchImpl: fetchImpl as never, checkUrl: ok });
    expect(r).toMatchObject({ status: 500, ok: false, text: "error" });
  });
});
