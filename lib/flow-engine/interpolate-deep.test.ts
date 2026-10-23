import { describe, expect, it } from "vitest";
import { interpolateDeep } from "./interpolate";

describe("interpolateDeep", () => {
  it("reemplaza en botones, respuestas rapidas, links y carrusel sin tocar las claves", () => {
    const vars = { contact: { first_name: "Ana" }, link: "https://x.com/a" };
    const msg = {
      text: "Hola {{contact.first_name}}",
      buttons: [{ title: "Sí, {{contact.first_name}}", type: "url", url: "{{link}}" }],
      quickReplies: [{ title: "{{contact.first_name}}", payload: "OK_{{contact.first_name}}" }],
      carousel: { elements: [{ title: "Para {{contact.first_name}}", buttons: [] }] },
      mediaUrl: "{{link}}",
      count: 3,
    };
    expect(interpolateDeep(msg, vars)).toEqual({
      text: "Hola Ana",
      buttons: [{ title: "Sí, Ana", type: "url", url: "https://x.com/a" }],
      quickReplies: [{ title: "Ana", payload: "OK_Ana" }],
      carousel: { elements: [{ title: "Para Ana", buttons: [] }] },
      mediaUrl: "https://x.com/a",
      count: 3,
    });
  });
});
