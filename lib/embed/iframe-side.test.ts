/**
 * El lado de adentro del embed (F41).
 *
 * Lo que más importa acá es lo que NO pasa: sin origen declarado no sale
 * ningún mensaje, y un `agenda:ui` de otro origen se ignora.
 */

import { describe, expect, it, vi } from "vitest";
import { connectIframeSide, isInsideIframe, parentOriginFromSearch, type IframeWindow } from "./iframe-side";
import { EMBED_MESSAGE_SOURCE } from "./events";

function fakeWindow(): { win: IframeWindow; posts: Array<{ message: unknown; origin: string }>; fire: (data: unknown, origin: string) => void } {
  const posts: Array<{ message: unknown; origin: string }> = [];
  const listeners: Array<(e: { data: unknown; origin: string }) => void> = [];
  const win: IframeWindow = {
    parent: { postMessage: (message, targetOrigin) => posts.push({ message, origin: targetOrigin }) },
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: (_type, listener) => {
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
    },
    self: {},
    top: {},
    location: { search: "" },
  };
  return { win, posts, fire: (data, origin) => listeners.forEach((l) => l({ data, origin })) };
}

describe("isInsideIframe", () => {
  it("es verdadero cuando self y top no son lo mismo", () => {
    const a = {};
    expect(isInsideIframe({ self: a, top: {} })).toBe(true);
    expect(isInsideIframe({ self: a, top: a })).toBe(false);
  });
});

describe("parentOriginFromSearch", () => {
  it("lee el origen y descarta la ruta", () => {
    expect(parentOriginFromSearch("?embedOrigin=https%3A%2F%2Fcliente.com%2Fagenda")).toBe("https://cliente.com");
  });
  it("también lo saca del referrer, que es lo que manda el script", () => {
    expect(parentOriginFromSearch("?embed=1&referrer=https%3A%2F%2Fcliente.com%2Fpagina%3Fa%3D1")).toBe("https://cliente.com");
  });

  it("sin parámetro o con basura, null", () => {
    expect(parentOriginFromSearch("")).toBeNull();
    expect(parentOriginFromSearch("?embedOrigin=no-es-una-url")).toBeNull();
  });
});

describe("connectIframeSide", () => {
  it("avisa que cargó al origen declarado, y a nadie más", () => {
    const { win, posts } = fakeWindow();
    const side = connectIframeSide({ window: win, parentOrigin: "https://cliente.com" });
    side.ready();
    expect(posts).toHaveLength(1);
    expect(posts[0].origin).toBe("https://cliente.com");
    expect(posts[0].message).toMatchObject({ source: EMBED_MESSAGE_SOURCE, type: "agenda:loaded" });
  });

  it("sin origen declarado no manda nada (nunca postMessage a *)", () => {
    const { win, posts } = fakeWindow();
    const side = connectIframeSide({ window: win, parentOrigin: null });
    side.ready();
    side.sendHeight(400);
    side.emit("agenda:bookingSuccessful", { uid: "abc" });
    expect(posts).toHaveLength(0);
  });

  it("la altura se manda solo cuando cambia", () => {
    const { win, posts } = fakeWindow();
    const side = connectIframeSide({ window: win, parentOrigin: "https://cliente.com" });
    side.sendHeight(420);
    side.sendHeight(420.2);
    side.sendHeight(421);
    expect(posts.map((p) => (p.message as { payload: { height: number } }).payload.height)).toEqual([420, 421]);
  });

  it("una altura de cero o negativa no se manda", () => {
    const { win, posts } = fakeWindow();
    const side = connectIframeSide({ window: win, parentOrigin: "https://cliente.com" });
    side.sendHeight(0);
    side.sendHeight(-10);
    expect(posts).toHaveLength(0);
  });

  it("acepta agenda:ui del origen declarado", () => {
    const { win, fire } = fakeWindow();
    const onUi = vi.fn();
    connectIframeSide({ window: win, parentOrigin: "https://cliente.com", onUi });
    fire({ source: EMBED_MESSAGE_SOURCE, type: "agenda:ui", namespace: "", payload: { theme: "dark" } }, "https://cliente.com");
    expect(onUi).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("ignora agenda:ui de otro origen", () => {
    const { win, fire } = fakeWindow();
    const onUi = vi.fn();
    connectIframeSide({ window: win, parentOrigin: "https://cliente.com", onUi });
    fire({ source: EMBED_MESSAGE_SOURCE, type: "agenda:ui", namespace: "", payload: { theme: "dark" } }, "https://atacante.com");
    expect(onUi).not.toHaveBeenCalled();
  });

  it("ignora mensajes que no son del protocolo", () => {
    const { win, fire } = fakeWindow();
    const onUi = vi.fn();
    connectIframeSide({ window: win, parentOrigin: "https://cliente.com", onUi });
    fire({ type: "agenda:ui", payload: { theme: "dark" } }, "https://cliente.com");
    fire("hola", "https://cliente.com");
    expect(onUi).not.toHaveBeenCalled();
  });

  it("stop deja de escuchar", () => {
    const { win, fire } = fakeWindow();
    const onUi = vi.fn();
    const side = connectIframeSide({ window: win, parentOrigin: "https://cliente.com", onUi });
    side.stop();
    fire({ source: EMBED_MESSAGE_SOURCE, type: "agenda:ui", namespace: "", payload: {} }, "https://cliente.com");
    expect(onUi).not.toHaveBeenCalled();
  });

  it("el evento de agenda creada viaja con el espacio de nombres", () => {
    const { win, posts } = fakeWindow();
    const side = connectIframeSide({ window: win, parentOrigin: "https://cliente.com", namespace: "ventas" });
    side.emit("agenda:bookingSuccessful", { uid: "abc", startTime: "2026-10-01T15:00:00.000Z" });
    expect(posts[0].message).toMatchObject({ type: "agenda:bookingSuccessful", namespace: "ventas" });
  });
});
