// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { answerState, citationClock, parseConversationFilter, preview, readConversationsPage, searchSummary } from "./tutor-conversations";

describe("tutor conversations", () => {
  it("el filtro desconocido vuelve a «todas»", () => {
    expect(parseConversationFilter("abajo")).toBe("abajo");
    expect(parseConversationFilter("sin-clases")).toBe("sin-clases");
    expect(parseConversationFilter("cualquiera")).toBe("todas");
    expect(parseConversationFilter(undefined)).toBe("todas");
  });

  it("cómo terminó cada respuesta", () => {
    const cite = [{ item_id: "a", title: "A", second: 1 }];
    expect(answerState({ run_status: "responded", citations: cite })).toBe("with_classes");
    expect(answerState({ run_status: "responded", citations: [] })).toBe("no_classes");
    expect(answerState({ run_status: "error", citations: [] })).toBe("failed");
    expect(answerState({ run_status: null, citations: [] })).toBe("failed");
  });

  it("lo que encontró la búsqueda; una respuesta vieja no dice nada", () => {
    expect(searchSummary(null)).toBeNull();
    expect(searchSummary({})).toBeNull();
    expect(searchSummary({ fragments: 0, cited: 0 })).toBe("No encontró material relacionado");
    expect(searchSummary({ fragments: 1 })).toBe("Encontró 1 pedazo de clase");
    expect(searchSummary({ fragments: 8, cited: 3 })).toBe("Encontró 8 pedazos de clases");
  });

  it("el inicio de un texto, sin formato ni saltos", () => {
    expect(preview("**Hola**\n\nmundo")).toBe("Hola mundo");
    expect(preview("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
    expect(preview(null)).toBe("");
  });

  it("el minuto de una cita", () => {
    expect(citationClock(null)).toBeNull();
    expect(citationClock(725)).toBe("12:05");
    expect(citationClock(3723)).toBe("1:02:03");
  });

  it("lee la página de la base sin confiar en su forma", () => {
    const page = readConversationsPage({
      has_more: true,
      items: [
        { id: "m1", thread_id: "t1", created_at: "2026-11-17T19:58:22Z", contact_id: "c1", student: "Ana", question: "¿Qué?", answer: "Esto", citations: [{ item_id: "i1", title: "Clase", second: 12 }], feedback: "down", result: { fragments: 3, cited: 1 }, run_status: "responded" },
        { id: "m2", citations: null, feedback: "otro" },
        null,
        { nada: true },
      ],
    });
    expect(page.has_more).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.items[0].citations).toEqual([{ item_id: "i1", title: "Clase", second: 12 }]);
    expect(page.items[1]).toMatchObject({ citations: [], feedback: null, answer: "", run_status: null });
    expect(readConversationsPage(null)).toEqual({ items: [], has_more: false });
  });
});
