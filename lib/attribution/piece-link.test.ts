import { describe, expect, it } from "vitest";
import { composePieceLink, validateDestination } from "./piece-link";

const base = { platform: "instagram", pieceTitle: "Reel: 3 errores al vender", contentCode: "c8k2f" };

describe("validateDestination", () => {
  it("acepta http y https", () => {
    expect(validateDestination(" https://wendy.com/programa ")).toEqual({ ok: true, url: "https://wendy.com/programa" });
    expect(validateDestination("http://wendy.com")).toEqual({ ok: true, url: "http://wendy.com" });
  });

  it("rechaza vacío, texto suelto, otros protocolos y espacios", () => {
    for (const bad of ["", "   ", "wendy.com", "hola", "ftp://a.com", "javascript:alert(1)", "mailto:a@b.com", "https://a.com/un link"]) {
      const res = validateDestination(bad);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(10);
    }
  });
});

describe("composePieceLink", () => {
  it("arma los cuatro parámetros con el código de la pieza y organic_social", () => {
    const res = composePieceLink({ ...base, url: "https://wendy.com/programa" });
    expect(res).toEqual({
      ok: true,
      unchanged: false,
      url: "https://wendy.com/programa?utm_source=instagram&utm_medium=organic_social&utm_campaign=reel-3-errores-al-vender&utm_content=c8k2f",
    });
  });

  it("cambia la red", () => {
    const res = composePieceLink({ ...base, platform: "tiktok", url: "https://wendy.com/p" });
    expect(res.ok && new URL(res.url).searchParams.get("utm_source")).toBe("tiktok");
  });

  it("sin título omite utm_campaign (no hay id de flujo)", () => {
    const res = composePieceLink({ ...base, pieceTitle: "", url: "https://wendy.com/p" });
    expect(res.ok && new URL(res.url).searchParams.has("utm_campaign")).toBe(false);
  });

  it("respeta lo que el link ya trae y conserva el #hash", () => {
    const res = composePieceLink({ ...base, url: "https://wendy.com/p?utm_source=bio#precios" });
    expect(res.ok && res.url).toBe(
      "https://wendy.com/p?utm_source=bio&utm_medium=organic_social&utm_campaign=reel-3-errores-al-vender&utm_content=c8k2f#precios",
    );
  });

  it("un link que ya trae todo sale igual y lo avisa", () => {
    const full = "https://wendy.com/p?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d";
    expect(composePieceLink({ ...base, url: full })).toEqual({ ok: true, url: full, unchanged: true });
  });

  it("un link de chat no se arma", () => {
    for (const chat of ["https://wa.me/5491100000000", "https://instagram.com/wendy", "https://m.me/wendy", "https://l.instagram.com/x"]) {
      const res = composePieceLink({ ...base, url: chat });
      expect(res.ok, chat).toBe(false);
    }
  });

  it("valida la red, el código y el destino", () => {
    expect(composePieceLink({ ...base, platform: "myspace", url: "https://a.com" }).ok).toBe(false);
    expect(composePieceLink({ ...base, contentCode: "  ", url: "https://a.com" }).ok).toBe(false);
    expect(composePieceLink({ ...base, url: "nada" }).ok).toBe(false);
  });
});
