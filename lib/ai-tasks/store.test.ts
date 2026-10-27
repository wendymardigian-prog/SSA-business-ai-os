import { describe, expect, it } from "vitest";
import { loadTaskInstructions, loadTaskInstructionsForRun } from "./store";
import { ADS_ANALYSIS_DEFAULT_INSTRUCTIONS, CLASSIFY_DEFAULT_INSTRUCTIONS, CLOSE_CLASSIFICATION_DEFAULT_INSTRUCTIONS } from "./instructions";

/**
 * `loadTaskInstructions` nunca frena una tarea: ante cualquier problema (sin
 * version activa, la fila no existe, un error de red) se cae al texto del
 * sistema. Cliente falso minimo, mismo patron que runs-query.test.ts.
 */
function fakeClient(opts: { active?: Record<string, number>; versionRow?: { version: number; instructions: string } | null; fail?: boolean; style?: string | null }) {
  return {
    from(table: string) {
      if (table === "workspaces") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.fail ? { data: null, error: { message: "boom" } } : { data: { ai_task_prompt_active: opts.active ?? {}, ai_language_style: opts.style ?? null }, error: null },
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
  it("una tarea sin instrucciones (knowledge_indexing) devuelve texto vacio, version null", async () => {
    const got = await loadTaskInstructions(fakeClient({}), "ws-1", "knowledge_indexing");
    expect(got).toEqual({ version: null, text: "" });
  });

  it("clasificacion al cierre: sin version activa, sus criterios por defecto", async () => {
    const got = await loadTaskInstructions(fakeClient({ active: {} }), "ws-1", "close_classification");
    expect(got).toEqual({ version: null, text: CLOSE_CLASSIFICATION_DEFAULT_INSTRUCTIONS });
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

describe("las tareas con instrucciones son las mismas en los tres lugares", () => {
  it("catalogo (instructions.editable) = DEFAULT_TEXT = CHECK de la ultima migracion que lo toca", async () => {
    const { checkValues } = await import("@/lib/test-utils/migrations");
    const { AI_TASK_IDS, AI_TASKS } = await import("./catalog");
    const { DEFAULT_TEXT } = await import("./store");

    const fromCatalog = AI_TASK_IDS.filter((id) => AI_TASKS[id].instructions.editable).sort();
    const fromDefaults = Object.keys(DEFAULT_TEXT).sort();

    // El CHECK vigente es el de la ultima migracion que lo redefine.
    const check = checkValues("ai_task_prompt_versions_task_check")?.values.sort() ?? null;

    expect(fromDefaults).toEqual(fromCatalog);
    expect(check).toEqual(fromCatalog);
  });
});

describe("loadTaskInstructionsForRun (el tono del negocio, 00266)", () => {
  it("sin tono propio, el texto vuelve igual: el prompt final no cambia", async () => {
    const forRun = await loadTaskInstructionsForRun(fakeClient({ active: {} }), "ws-1", "ads_analysis");
    const plain = await loadTaskInstructions(fakeClient({ active: {} }), "ws-1", "ads_analysis");
    expect(forRun).toEqual(plain);
  });

  it("con tono propio, {{estilo}} ya viene puesto con el del negocio", async () => {
    const got = await loadTaskInstructionsForRun(
      fakeClient({ active: { ads_analysis: 2 }, versionRow: { version: 2, instructions: "Hablá en {{estilo}}. Máximo {{largo_maximo}}." }, style: "español mexicano (tú)" }),
      "ws-1",
      "ads_analysis",
    );
    // Solo el estilo: las otras variables las pone quien arma el prompt, como siempre.
    expect(got).toEqual({ version: 2, text: "Hablá en español mexicano (tú). Máximo {{largo_maximo}}." });
  });

  it("si no puede leer el tono, sigue con el texto de siempre (nunca frena la tarea)", async () => {
    const got = await loadTaskInstructionsForRun(fakeClient({ fail: true }), "ws-1", "ads_analysis");
    expect(got).toEqual({ version: null, text: ADS_ANALYSIS_DEFAULT_INSTRUCTIONS });
  });
});
