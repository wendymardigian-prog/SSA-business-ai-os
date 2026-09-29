import { describe, expect, it } from "vitest";
import { alsoLabel, parseVariants, patternCategories, repliesPanel, type PatternSqlRow } from "./patterns";

const VARIANTS = [
  { text_id: "t1", text: "¡Hola! ¿Qué negocio tenés?", count: 82, confidence: 0.97, source: "model", is_button: false, reply_rate: 78, also_spellings: ["hola que negocio tenes"] },
  { text_id: "t2", text: "sí", count: 41, confidence: 0.61, source: "model", is_button: false, reply_rate: null, also_spellings: [] },
];

function row(over: Partial<PatternSqlRow> = {}): PatternSqlRow {
  return {
    category_id: "c1",
    category_name: "Saludo y pregunta por el negocio",
    description: "Primer mensaje que pregunta a qué se dedica.",
    is_fallback: false,
    message_count: 412,
    text_count: 3,
    top_author: "agent",
    reply_rate: 78,
    rank: 1,
    top_variants: VARIANTS,
    ...over,
  };
}

describe("parseVariants", () => {
  it("trae el text_id, que es lo que permite mover un texto", () => {
    const vs = parseVariants(VARIANTS);
    expect(vs.map((v) => v.textId)).toEqual(["t1", "t2"]);
  });

  it("marca la confianza baja (menos de 70 %)", () => {
    const vs = parseVariants(VARIANTS);
    expect(vs[0].lowConfidence).toBe(false);
    expect(vs[1].lowConfidence).toBe(true);
  });

  it("una variante sin id se descarta: el control no podria funcionar", () => {
    expect(parseVariants([{ text: "x", count: 1 }])).toEqual([]);
  });

  it("tolera basura", () => {
    expect(parseVariants(null)).toEqual([]);
    expect(parseVariants("[]")).toEqual([]);
    expect(parseVariants([{ text_id: "t", text: "a", count: "5", confidence: "x", also_spellings: "no" }])[0]).toMatchObject({
      count: 5,
      confidence: null,
      alsoSpellings: [],
    });
  });
});

describe("patternCategories", () => {
  it("mapea la categoria con su volumen y autor principal", () => {
    const [c] = patternCategories([row()]);
    expect(c).toMatchObject({ categoryId: "c1", messageCount: 412, topAuthor: "agent", replyRate: 78, rank: 1 });
    expect(c.variants).toHaveLength(2);
  });

  it("una categoria sin volumen ni variantes no se lista", () => {
    expect(patternCategories([row({ message_count: 0, top_variants: [] })])).toEqual([]);
  });
});

describe("alsoLabel", () => {
  it("lista las otras escrituras", () => {
    const [v] = parseVariants(VARIANTS);
    expect(alsoLabel(v)).toBe("También: hola que negocio tenes");
  });
  it("sin otras escrituras no dice nada", () => {
    const v = parseVariants(VARIANTS)[1];
    expect(alsoLabel(v)).toBeNull();
  });
});

describe("repliesPanel", () => {
  const rows = [
    { reply_category_id: "i3", reply_category_name: "Tiene agencia", reply_is_fallback: false, replies: 31, pct_of_replies: 40, outbound_total: 100, outbound_with_reply: 78 },
    { reply_category_id: null, reply_category_name: "Sin clasificar todavía", reply_is_fallback: false, replies: 47, pct_of_replies: 60, outbound_total: 100, outbound_with_reply: 78 },
  ];

  it("el % que no respondio se calcula sobre los salientes, no restando porcentajes", () => {
    const panel = repliesPanel(rows);
    expect(panel.outboundTotal).toBe(100);
    expect(panel.outboundWithReply).toBe(78);
    expect(panel.noReplyPct).toBe(22);
  });

  it("sin salientes no hay porcentaje", () => {
    expect(repliesPanel([]).noReplyPct).toBeNull();
  });
});
