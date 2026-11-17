// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./community-text.cases.json";
import {
  communityBlocks,
  communityFromEditorDoc,
  communityPlainText,
  communityToEditorDoc,
  communityVideos,
  looksLikeMarkdown,
  mediaPaths,
  MAX_VIDEOS,
  teamMediaPath,
} from "./community-text";

describe("casos compartidos con el portal", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    if ("blocks" in c && c.blocks) expect(communityBlocks(c.body)).toEqual(c.blocks);
    expect(communityVideos(c.body).map((v) => v.embedUrl)).toEqual(c.videos);
  });
});

describe("ida y vuelta con el editor", () => {
  it("lo que se guarda vuelve igual", () => {
    const body = "## Bienvenida\n\nHola, **bienvenido**.\nSegunda línea.\n\n- uno\n- dos\n\n1. tres\n2. cuatro\n\nVer [el link](https://ejemplo.com/a_b).";
    expect(communityFromEditorDoc(communityToEditorDoc(body))).toBe(body);
  });
  it("un texto con asteriscos sueltos no se rompe", () => {
    const body = "Precio 2 \\* 3 y nombre\\_apellido";
    expect(communityPlainText(communityFromEditorDoc(communityToEditorDoc(body)))).toBe("Precio 2 * 3 y nombre_apellido");
  });
});

describe("pegar Markdown", () => {
  it("reconoce títulos, listas, negritas y links", () => {
    expect(looksLikeMarkdown("## Hola")).toBe(true);
    expect(looksLikeMarkdown("texto\n- uno")).toBe(true);
    expect(looksLikeMarkdown("es **muy** bueno")).toBe(true);
    expect(looksLikeMarkdown("[a](https://x.com)")).toBe(true);
  });
  it("un texto común se pega como siempre", () => {
    expect(looksLikeMarkdown("Hola, bienvenido. 🙌\nSi estás leyendo esto…")).toBe(false);
    expect(looksLikeMarkdown("1️⃣ Presentate en los comentarios")).toBe(false);
  });
});

describe("videos y fotos", () => {
  it("como mucho cuatro reproductores", () => {
    const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd", "eeeeeeeeeee"];
    expect(communityVideos(ids.map((id) => `https://youtu.be/${id}`).join(" "))).toHaveLength(MAX_VIDEOS);
  });
  it("el path de una foto del equipo y lo que se lee de la base", () => {
    expect(teamMediaPath({ workspaceId: "w", productId: "p", fileId: "f", ext: "png" })).toBe("w/p/team/f.png");
    expect(mediaPaths([{ path: "a.png" }, { nope: 1 }, "x", null])).toEqual(["a.png"]);
    expect(mediaPaths(null)).toEqual([]);
  });
});
