import { describe, expect, it } from "vitest";
import { loadTaskInstructions } from "./store";
import { ADS_ANALYSIS_DEFAULT_INSTRUCTIONS, CLASSIFY_DEFAULT_INSTRUCTIONS } from "./instructions";

/**
 * `loadTaskInstructions` nunca frena una tarea: ante cualquier problema (sin
 * version activa, la fila no existe, un error de red) se cae al texto del
 * sistema. Cliente falso minimo, mismo patron que runs-query.test.ts.
 */
function fakeClient(opts: { active?: Record<string, number>; versionRow?: { version: number; instructions: string } | null; fail?: boolean }) {
  return {
    from(table: string) {
      if (table === "workspaces") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.fail ? { data: null, error: { message: "boom" } } : { data: { ai_task_prompt_active: opts.active ?? {} }, error: null },
            }),
          }),
        };
      }
      if (table === "ai_task_prompt_versions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: opts.versionRow ?? null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`tabla inesperada: ${table}`);
    },
  } as never;
}

describe("loadTaskInstructions (analisis de anuncios)", () => {
  it("sin version activa, el texto del sistema", async () => {
    const got = await loadTaskInstructions(fakeClient({ active: {} }), "ws-1", "ads_analysis");
    expect(got).toEqual({ version: null, text: ADS_ANALYSIS_DEFAULT_INSTRUCTIONS });
  });

  it("con version activa, el texto de esa version", async () => {
    const got = await loadTaskInstructions(
      fakeClient({ active: { ads_analysis: 2 }, versionRow: { version: 2, instructions: "Resumí en tres puntos." } }),
      "ws-1",
      "ads_analysis",
    );
    expect(got).toEqual({ version: 2, text: "Resumí en tres puntos." });
  });
});

describe("loadTaskInstructions", () => {
  it("una tarea sin instrucciones (close_classification) devuelve texto vacio, version null", async () => {
    const got = await loadTaskInstructions(fakeClient({}), "ws-1", "close_classification");
    expect(got).toEqual({ version: null, text: "" });
  });

  it("sin version activa: el texto del sistema", async () => {
    const got = await loadTaskInstructions(fakeClient({ active: {} }), "ws-1", "message_classification");
    expect(got).toEqual({ version: null, text: CLASSIFY_DEFAULT_INSTRUCTIONS });
  });

  it("con version activa y la fila existe: esa version", async () => {
    const got = await loadTaskInstructions(
      fakeClient({ active: { message_classification: 2 }, versionRow: { version: 2, instructions: "Instrucciones custom" } }),
      "ws-1",
      "message_classification",
    );
    expect(got).toEqual({ version: 2, text: "Instrucciones custom" });
  });

  it("version activa pero la fila no esta (se borro el workspace de otra forma): el texto del sistema", async () => {
    const got = await loadTaskInstructions(fakeClient({ active: { message_classification: 9 }, versionRow: null }), "ws-1", "message_classification");
    expect(got).toEqual({ version: null, text: CLASSIFY_DEFAULT_INSTRUCTIONS });
  });

  it("si falla la lectura del workspace, nunca lanza: el texto del sistema", async () => {
    const got = await loadTaskInstructions(fakeClient({ fail: true }), "ws-1", "conversation_summary");
    expect(got.version).toBeNull();
    expect(got.text.length).toBeGreaterThan(0);
  });
});
