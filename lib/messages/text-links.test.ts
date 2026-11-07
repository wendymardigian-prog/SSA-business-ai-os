import { describe, expect, it } from "vitest";
import { signTrackedLink } from "@/lib/attribution/tracked-link";
import { firstPreviewableLink, linkifyToHtml, messageLinkHref, messageSegments, splitTextLinks, trackedLinkDestination } from "./text-links";

const links = (text: string) => splitTextLinks(text).flatMap((s) => (s.type === "link" ? [s.value] : []));
const rejoin = (text: string) => splitTextLinks(text).map((s) => s.value).join("");

describe("splitTextLinks", () => {
  it("separa texto y link", () => {
    expect(splitTextLinks("Mirá https://a.com/x y avisame")).toEqual([
      { type: "text", value: "Mirá " },
      { type: "link", value: "https://a.com/x", href: "https://a.com/x" },
      { type: "text", value: " y avisame" },
    ]);
  });

  it("un texto sin links es un solo pedazo, y uno vacio no tiene ninguno", () => {
    expect(splitTextLinks("hola")).toEqual([{ type: "text", value: "hola" }]);
    expect(splitTextLinks("")).toEqual([]);
    expect(splitTextLinks(null)).toEqual([]);
  });

  it("www lleva https, pero el texto se ve como se escribio", () => {
    expect(splitTextLinks("www.a.com")).toEqual([{ type: "link", value: "www.a.com", href: "https://www.a.com" }]);
  });

  it.each(["www.hola", "awww.hola.com", "gracias.nos vemos", "hola.com", "ftp://a.com", "javascript:alert(1)"])("no vuelve link %s", (text) => {
    expect(links(text)).toEqual([]);
  });

  it.each([
    ["Mirá https://a.com.", "https://a.com", "."],
    ["(https://a.com)", "https://a.com", ")"],
    ["https://es.wikipedia.org/wiki/Foo_(bar)", "https://es.wikipedia.org/wiki/Foo_(bar)", ""],
    ["*https://a.com*", "https://a.com", "*"],
    ["_https://a.com._", "https://a.com", "._"],
    ["~https://a.com~", "https://a.com", "~"],
  ])("deja afuera la puntuacion y el formato: %s", (text, url, tail) => {
    const segments = splitTextLinks(text);
    const link = segments.find((s) => s.type === "link");
    expect(link?.value).toBe(url);
    expect(segments.at(-1)?.type === "text" ? segments.at(-1)?.value : "").toBe(tail);
  });

  it("no corta un guion bajo que es parte del link", () => {
    expect(links("https://baja.invalid/__unsubscribe__")).toEqual(["https://baja.invalid/__unsubscribe__"]);
  });

  it("varios links, saltos de linea y acentos: unir los pedazos da el texto original", () => {
    const text = "Hola,\nhttps://a.com?x=1&y=2, www.b.com\n\ny (https://c.com/ñandú).";
    expect(links(text)).toEqual(["https://a.com?x=1&y=2", "www.b.com", "https://c.com/ñandú"]);
    expect(rejoin(text)).toBe(text);
  });
});

describe("links medidos", () => {
  const token = signTrackedLink(
    { w: "11111111-1111-4111-8111-111111111111", c: "22222222-2222-4222-8222-222222222222", u: "https://destino.com/ñ?a=1", f: "33333333-3333-4333-8333-333333333333" },
    "secreto",
  );
  const tracked = `https://app.com/l/${token}`;

  it("lee el destino de un token real, firmado por el modulo de servidor", () => {
    expect(trackedLinkDestination(tracked)).toBe("https://destino.com/ñ?a=1");
  });

  it.each(["https://app.com/l/nada", "https://app.com/otra/a.b", "no es una url", "https://app.com/l/e30.firma"])("no inventa un destino para %s", (url) => {
    expect(trackedLinkDestination(url)).toBeNull();
  });

  it("no acepta un destino que no sea http(s)", () => {
    const body = Buffer.from(JSON.stringify({ v: 1, u: "javascript:alert(1)" })).toString("base64url");
    expect(trackedLinkDestination(`https://app.com/l/${body}.firma`)).toBeNull();
  });

  it("un saliente va al destino; un entrante, nunca (un lead podria falsificarlo)", () => {
    expect(messageLinkHref(tracked, true)).toBe("https://destino.com/ñ?a=1");
    expect(messageLinkHref(tracked, false)).toBe(tracked);
    expect(messageSegments(`Mirá ${tracked}`, true)[1]).toMatchObject({ value: tracked, href: "https://destino.com/ñ?a=1" });
  });
});

describe("firstPreviewableLink", () => {
  it("el primero, salteando los de chat", () => {
    expect(firstPreviewableLink("https://wa.me/123 y https://instagram.com/x y https://a.com y https://b.com", false)).toBe("https://a.com");
  });

  it("www cuenta, ya convertido", () => {
    expect(firstPreviewableLink("www.a.com", false)).toBe("https://www.a.com");
  });

  it("sin links, null", () => {
    expect(firstPreviewableLink("hola", false)).toBeNull();
    expect(firstPreviewableLink(null, false)).toBeNull();
  });
});

describe("linkifyToHtml", () => {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  it("escapa el texto y el link", () => {
    expect(linkifyToHtml('<b> https://a.com?x=1&y=2 "ok"', escape)).toBe(
      '&lt;b&gt; <a href="https://a.com?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">https://a.com?x=1&amp;y=2</a> &quot;ok&quot;',
    );
  });

  it("sin links es solo el escape", () => {
    expect(linkifyToHtml("a < b", escape)).toBe("a &lt; b");
  });
});
