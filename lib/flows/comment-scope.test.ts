import { describe, expect, it } from "vitest";
import { parsePostIds, postOptionLabel, scopeSummary, togglePostId } from "./comment-scope";

describe("alcance del disparador de comentario", () => {
  it("lee los ids pegados sin repetir y descarta lo que no parece un id", () => {
    expect(parsePostIds("18136695418785095, 18107363185823064\n18136695418785095 <script>")).toEqual(["18136695418785095", "18107363185823064"]);
    expect(parsePostIds("   ")).toEqual([]);
  });

  it("agrega y saca una publicacion", () => {
    expect(togglePostId(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePostId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("muestra la primera linea o la fecha", () => {
    const date = () => "6/11";
    expect(postOptionLabel({ caption: "\nComentá CLASE\nmas texto", published_at: null }, date)).toBe("Comentá CLASE");
    expect(postOptionLabel({ caption: null, published_at: "2026-11-06T00:00:00Z" }, date)).toBe("Publicación del 6/11");
  });

  it("resume cuenta y publicaciones", () => {
    expect(scopeSummary({ channelName: null, postCount: 0 })).toBe("Todas las cuentas · todas las publicaciones");
    expect(scopeSummary({ channelName: "@wendy", postCount: 2 })).toBe("@wendy · 2 publicaciones");
  });
});
