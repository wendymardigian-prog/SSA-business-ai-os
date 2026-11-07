import { describe, expect, it } from "vitest";
import { messageLinkCardUrl } from "./message-link-card";

const on = { outbound: false, failed: false, channelShowsCards: true };

describe("messageLinkCardUrl", () => {
  it("el primer link del mensaje", () => {
    expect(messageLinkCardUrl({ text: "Mirá https://a.com y https://b.com" }, on)).toBe("https://a.com");
  });

  it("sin link, o solo con links de chat, no hay tarjeta", () => {
    expect(messageLinkCardUrl({ text: "hola" }, on)).toBeNull();
    expect(messageLinkCardUrl({ text: "https://wa.me/123" }, on)).toBeNull();
    expect(messageLinkCardUrl({ text: null }, on)).toBeNull();
  });

  it("no en un canal sin tarjetas, un fallido ni un email", () => {
    expect(messageLinkCardUrl({ text: "https://a.com" }, { ...on, channelShowsCards: false })).toBeNull();
    expect(messageLinkCardUrl({ text: "https://a.com" }, { ...on, failed: true })).toBeNull();
    expect(messageLinkCardUrl({ text: "https://a.com", email_from: "x@y.com" }, on)).toBeNull();
  });

  it("no si ya trae su tarjeta: un reel compartido no sale dos veces", () => {
    const share = { v: 2, items: [{ kind: "share", meta: { url: "https://instagram.com/reel/x" } }] };
    expect(messageLinkCardUrl({ text: "https://otro.com", attachments: share }, on)).toBeNull();
  });

  it("una foto con un link en el pie si lleva tarjeta", () => {
    const image = { v: 2, items: [{ kind: "image", storagePath: "a/b.png" }] };
    expect(messageLinkCardUrl({ text: "https://a.com", attachments: image }, on)).toBe("https://a.com");
  });
});
