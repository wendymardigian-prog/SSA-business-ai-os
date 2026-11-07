import { describe, expect, it, vi } from "vitest";
import type { AiRunHandle } from "@/lib/ai/run";
import type { DesignDoc } from "../doc/schema";
import { memoryDb, PNG_BYTES } from "../ai/test-db";
import { carousel, singlePage, WS } from "../ai/test-fixtures";
import type { DesignerGenerate, DesignerGenerateArgs } from "../ai/provider";
import { runAiGenerate, type AiGenerateDeps, type AiGeneratePayload } from "./ai-generate";

const photo = `${WS}/images/aaaaaaaa-0000-0000-0000-000000000001.png`;

const textJson = (text: string, over: Record<string, unknown> = {}) => ({
  type: "text",
  x: 50,
  y: 50,
  w: 80,
  text,
  font: { family: "Inter", weight: 700 },
  size: 64,
  align: "center",
  color: "#ffffff",
  ...over,
});
const pageJson = (...texts: string[]) => ({ background: { type: "color", color: "#101010" }, elements: texts.map((t, i) => textJson(t, { y: 30 + i * 20 })) });

function fakeRun() {
  const closes: unknown[] = [];
  const usage: unknown[] = [];
  const handle: AiRunHandle = {
    runId: "run_1",
    setModel: () => {},
    addStepUsage: (u) => void usage.push(u),
    setFinalUsage: () => {},
    addEmbeddingUsage: () => {},
    addAudioUsage: () => {},
    step: async () => null,
    setRouting: () => {},
    setIntent: () => {},
    close: async (input) => (closes.push(input), { costUsd: 0.01, pricingMissing: [] }),
  };
  return { handle, closes, usage };
}

function provider(responses: unknown[] | (() => unknown)) {
  const calls: DesignerGenerateArgs<unknown>[] = [];
  const generate: DesignerGenerate = async <T,>(args: DesignerGenerateArgs<T>) => {
    calls.push(args as DesignerGenerateArgs<unknown>);
    const object = (typeof responses === "function" ? responses() : responses[Math.min(calls.length - 1, responses.length - 1)]) as T;
    return { object, usage: { inputTokens: 100, outputTokens: 50 } };
  };
  return { generate, calls };
}

interface SetupOptions {
  mode?: AiGeneratePayload["mode"];
  kind?: "design" | "template";
  format?: "v45" | "carta_h";
  doc?: DesignDoc;
  attachments?: { asset_path: string; name: string; mime: string }[];
  content?: string;
  scope?: number;
  hooks?: Parameters<typeof memoryDb>[1];
}

function setup(o: SetupOptions = {}) {
  const kind = o.kind ?? "design";
  const format = o.format ?? "v45";
  const doc = o.doc ?? (format === "carta_h" ? singlePage("carta_h") : carousel());
  const table = kind === "design" ? "designs" : "design_templates";
  const mem = memoryDb(
    {
      workspaces: [{ id: WS, name: "Academia Ejemplo", brand_name: "Academia Ejemplo", brand_color: "#c4d94a", ai_language_style: null, design_settings: {}, timezone: "UTC" }],
      [table]: [{ id: "t1", workspace_id: WS, name: "Pieza", format, doc, rev: 3, style: null, origin: "ai", content_post_id: null, archived_at: null, verify: false, doc_type: null, doc_type_label: null, custom_vars: [], date_format: "long" }],
      ai_threads: [{ id: "th1", workspace_id: WS, channel: "designer", subject_type: kind === "design" ? "design" : "design_template", subject_id: "t1", user_id: "u1" }],
      ai_messages: [{ id: "m1", workspace_id: WS, thread_id: "th1", role: "user", content: o.content ?? "Hacé la portada más llamativa", attachments: o.attachments ?? [], context: { scope: o.scope === undefined ? {} : { page: o.scope } }, result: null, created_at: "2026-11-07T11:59:00.000Z" }],
    },
    { files: { [photo]: PNG_BYTES }, ...o.hooks },
  );
  const payload: Record<string, unknown> = { workspaceId: WS, kind, targetId: "t1", threadId: "th1", userMessageId: "m1", mode: o.mode ?? "change", baseRev: 3, userId: "u1" };
  return { ...mem, payload, table };
}

function deps(over: Partial<AiGenerateDeps> & { generate?: DesignerGenerate } = {}) {
  const run = fakeRun();
  const schedule = vi.fn(async (..._args: unknown[]) => ({ id: "job" }));
  const openRun = vi.fn(async (..._args: unknown[]) => run.handle);
  const d: AiGenerateDeps = {
    model: over.generate ? { generate: over.generate, provider: "anthropic", modelId: "claude-test" } : over.model,
    measure: null,
    budget: async () => ({ allowed: true }),
    openRun: openRun as never,
    schedule: schedule as never,
    now: () => new Date("2026-11-07T12:00:00.000Z"),
    nonce: () => "n0nce",
    ...over,
  };
  delete (d as { generate?: unknown }).generate;
  return { d, run, schedule, openRun };
}

const lastAssistant = (tables: Record<string, Record<string, unknown>[]>) => [...tables.ai_messages].reverse().find((m) => m.role === "assistant") as Record<string, unknown>;
const update = (index: number, id: string, set: Record<string, unknown>) => ({ index, ops: [{ op: "update", id, set }] });

describe("design_ai_generate: un cambio", () => {
  it("aplica el parche, guarda con rev nueva y una versión de la IA, y contesta con qué cambió y el costo", async () => {
    const s = setup({ scope: 2 });
    const p = provider([{ message: "Hice más grande el cierre.", patch: { pages: [update(2, "el_cta0001", { size: 90 })] } }]);
    const { d, run, openRun } = deps({ generate: p.generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "done", mode: "change", runId: "run_1" });

    const row = s.tables.designs[0] as { rev: number; doc: DesignDoc };
    expect(row.rev).toBe(4);
    expect((row.doc.pages[2].elements[0] as { size: number }).size).toBe(90);
    expect(s.inserts.filter((i) => i.table === "design_versions")).toEqual([
      expect.objectContaining({ row: expect.objectContaining({ design_id: "t1", reason: "ai", author_kind: "ai", created_by: "u1" }) }),
    ]);

    const answer = lastAssistant(s.tables);
    expect(answer.agent_run_id).toBe("run_1");
    expect(answer.content).toBe("Hice más grande el cierre.");
    expect(answer.result).toMatchObject({ changed_pages: [2], summary: "Cambió la página 3" });

    // El costo: la corrida es del Diseñador y suma el uso de la llamada.
    expect(openRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "designer", trigger: "job", workspaceId: WS, provider: "anthropic", model: "claude-test" }));
    expect(run.usage).toHaveLength(1);
    expect(run.closes[0]).toMatchObject({ status: "responded" });
    // Guardar una versión no encola ningún render.
    expect(s.inserts.some((i) => i.table === "scheduled_jobs")).toBe(false);
  });

  it("un diseño ya publicado se vuelve a renderizar después del cambio; uno sin publicar, no", async () => {
    const published = setup();
    (published.tables.designs[0] as { published: boolean }).published = true;
    const p = provider([{ message: "Listo", patch: { pages: [update(2, "el_cta0001", { size: 90 })] } }]);
    await runAiGenerate(published.db, published.payload, deps({ generate: p.generate }).d);
    const jobs = published.inserts.filter((i) => i.table === "scheduled_jobs").map((i) => i.row);
    expect(jobs).toEqual([expect.objectContaining({ type: "design_render", payload: { designId: "t1", purpose: "publish" }, dedupe_key: "design_render:t1:publish" })]);

    const draft = setup();
    await runAiGenerate(draft.db, draft.payload, deps({ generate: provider([{ message: "Listo", patch: { pages: [update(2, "el_cta0001", { size: 90 })] } }]).generate }).d);
    expect(draft.inserts.some((i) => i.table === "scheduled_jobs")).toBe(false);
  });

  it("una respuesta que mete un <script> no se guarda (el diseño queda como estaba)", async () => {
    const s = setup();
    const evil = { message: "Listo", patch: { pages: [{ index: 0, ops: [{ op: "add", element: { type: "html", x: 50, y: 50, w: 50, html: "<script>alert(1)</script>" } }] }] } };
    const out = await runAiGenerate(s.db, s.payload, deps({ generate: provider([evil]).generate }).d);
    expect(out).toMatchObject({ status: "failed", reason: "invalid" });
    expect(JSON.stringify(s.tables.designs[0])).not.toContain("<script");
    expect((s.tables.designs[0] as { rev: number }).rev).toBe(3);
  });

  it("«Solo la página N»: el alcance viene del mensaje y el parche de otra página se descarta", async () => {
    const s = setup({ scope: 1 });
    const p = provider([
      { message: "x", patch: { pages: [update(0, "el_title01", { size: 90 })] } },
      { message: "Listo", patch: { pages: [update(1, "el_body001", { size: 90 })] } },
    ]);
    const { d } = deps({ generate: p.generate });
    await runAiGenerate(s.db, s.payload, d);
    expect(p.calls).toHaveLength(2);
    const doc = (s.tables.designs[0] as { doc: DesignDoc }).doc;
    expect((doc.pages[0].elements[0] as { size: number }).size).toBe(64);
    expect((doc.pages[1].elements[0] as { size: number }).size).toBe(90);
  });

  it("conserva lo que la persona tocó mientras la IA trabajaba, y cuando tocaron lo mismo gana la persona y se avisa", async () => {
    const s = setup();
    const generate: DesignerGenerate = async <T,>() => {
      // Mientras la IA «piensa», la persona edita otro texto y el mismo que cambia la IA, y guarda (rev 4).
      const row = s.tables.designs[0] as { rev: number; doc: DesignDoc };
      const mine = structuredClone(row.doc);
      (mine.pages[1].elements[0] as { text: string }).text = "Escrito por mí";
      (mine.pages[0].elements[0] as { text: string }).text = "Título mío";
      row.doc = mine;
      row.rev = 4;
      return { object: { message: "Listo", patch: { pages: [update(0, "el_title01", { size: 120 }), update(2, "el_cta0001", { size: 90 })] } } as T };
    };
    const { d } = deps({ generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out.status).toBe("done");
    const row = s.tables.designs[0] as { rev: number; doc: DesignDoc };
    expect(row.rev).toBe(5);
    expect((row.doc.pages[1].elements[0] as { text: string }).text).toBe("Escrito por mí"); // lo de la persona sigue
    expect((row.doc.pages[0].elements[0] as { text: string; size: number }).text).toBe("Título mío"); // gana la persona
    expect((row.doc.pages[0].elements[0] as { size: number }).size).toBe(64);
    expect((row.doc.pages[2].elements[0] as { size: number }).size).toBe(90); // lo demás de la IA se aplica
    const answer = lastAssistant(s.tables);
    expect((answer.result as { warnings: string[]; kept_manual: string[] }).warnings.join(" ")).toMatch(/Dejé tu cambio manual/);
    expect((answer.result as { kept_manual: string[] }).kept_manual).toEqual(["el_title01"]);
  });

  it("si otra persona guarda justo antes de que guarde la IA (conflicto de rev), vuelve a leer y guarda igual", async () => {
    let bumped = false;
    const s = setup({
      hooks: {
        beforeUpdate: (table, rows) => {
          if (table === "designs" && !bumped) {
            bumped = true;
            (rows[0] as { rev: number }).rev = 9; // otra pestaña guardó entre la lectura y la escritura
          }
        },
      },
    });
    const p = provider([{ message: "Listo", patch: { pages: [update(2, "el_cta0001", { size: 90 })] } }]);
    const { d } = deps({ generate: p.generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out.status).toBe("done");
    expect((s.tables.designs[0] as { rev: number }).rev).toBe(10);
  });

  it("si no consigue entender la respuesta de la IA, dice «No pude aplicar ese cambio» y no toca el diseño", async () => {
    const s = setup();
    const bad = { message: "x", patch: { pages: [update(0, "el_fantasma", { size: 90 })] } };
    const { d } = deps({ generate: provider([bad]).generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "failed", reason: "invalid", message: "No pude aplicar ese cambio" });
    expect((s.tables.designs[0] as { rev: number }).rev).toBe(3);
    expect(s.inserts.filter((i) => i.table === "design_versions")).toEqual([]);
    expect(lastAssistant(s.tables).content).toBe("No pude aplicar ese cambio");
  });
});

describe("design_ai_generate: costos y topes (F38)", () => {
  it("con el tope alcanzado NO llama al proveedor y avisa en el hilo", async () => {
    const s = setup();
    const p = provider([{ message: "x", patch: { pages: [] } }]);
    const { d, openRun } = deps({
      generate: p.generate,
      budget: async () => ({ allowed: false, message: "El workspace llego a su tope mensual de gasto de IA (USD 50). Subilo en Agentes → Costos o espera al proximo mes." }),
    });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "failed", reason: "budget" });
    expect(p.calls).toHaveLength(0);
    expect(openRun).not.toHaveBeenCalled();
    expect(lastAssistant(s.tables).content).toMatch(/^Llegaste al tope de gasto de IA de este mes/);
    expect((s.tables.designs[0] as { rev: number }).rev).toBe(3);
  });

  it("el tope diario tiene su propio mensaje", async () => {
    const s = setup();
    const { d } = deps({ generate: provider([{}]).generate, budget: async () => ({ allowed: false, message: "El workspace llego a su tope diario de gasto de IA (USD 5)." }) });
    await runAiGenerate(s.db, s.payload, d);
    expect(lastAssistant(s.tables).content).toMatch(/^Llegaste al tope de gasto de IA de hoy/);
  });

  it("le pasa al tope el modelo que va a usar (para no gastar sin precio)", async () => {
    const s = setup();
    const budget = vi.fn(async () => ({ allowed: true }));
    const { d } = deps({ generate: provider([{ message: "x", patch: { pages: [] } }]).generate, budget: budget as never });
    await runAiGenerate(s.db, s.payload, d);
    expect(budget).toHaveBeenCalledWith(expect.anything(), WS, expect.any(Date), { model: { provider: "anthropic", model: "claude-test" } });
  });

  it("sin ninguna IA conectada dice «Conectá una clave de IA en Configuración» y no abre ninguna corrida", async () => {
    const s = setup();
    const { d, openRun } = deps({ model: null });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "failed", reason: "no_ai", message: "Conectá una clave de IA en Configuración" });
    expect(openRun).not.toHaveBeenCalled();
    expect(lastAssistant(s.tables).content).toBe("Conectá una clave de IA en Configuración");
  });
});

describe("design_ai_generate: un fallo del proveedor no lanza", () => {
  const boom = async () => {
    throw new Error("503 Service Unavailable");
  };

  it("reagenda a 1 minuto con el contador de reintentos y no deja ningún mensaje todavía", async () => {
    const s = setup();
    const { d, schedule, run } = deps({ generate: boom as never });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "retry", attempt: 1 });
    expect(schedule).toHaveBeenCalledWith(expect.anything(), "design_ai_generate", expect.objectContaining({ retry: 1, userMessageId: "m1" }), new Date("2026-11-07T12:01:00.000Z"));
    expect(lastAssistant(s.tables)).toBeUndefined();
    expect(run.closes[0]).toMatchObject({ status: "error", statusDetail: "retry_scheduled" });
  });

  it("los siguientes reintentos esperan 5 y 15 minutos", async () => {
    for (const [retry, minutes] of [[1, 5], [2, 15]] as const) {
      const s = setup();
      const { d, schedule } = deps({ generate: boom as never });
      await runAiGenerate(s.db, { ...s.payload, retry }, d);
      expect(schedule.mock.calls[0][3]).toEqual(new Date(Date.parse("2026-11-07T12:00:00.000Z") + minutes * 60_000));
    }
  });

  it("agotados los intentos, deja el error en el hilo (y no lanza)", async () => {
    const s = setup();
    const { d, schedule } = deps({ generate: boom as never });
    const out = await runAiGenerate(s.db, { ...s.payload, retry: 3 }, d);
    expect(out).toMatchObject({ status: "failed", reason: "error" });
    expect(schedule).not.toHaveBeenCalled();
    expect(lastAssistant(s.tables).content).toMatch(/La IA no respondió/);
    expect((lastAssistant(s.tables).result as { error: string }).error).toBeTruthy();
  });

  it("un rechazo permanente (clave inválida) no se reintenta", async () => {
    const s = setup();
    const unauthorized = async () => {
      throw Object.assign(new Error("invalid x-api-key"), { statusCode: 401 });
    };
    const { d, schedule } = deps({ generate: unauthorized as never });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "failed", reason: "error" });
    expect(schedule).not.toHaveBeenCalled();
    expect(lastAssistant(s.tables).content).toMatch(/rechazó el pedido/);
  });
});

describe("design_ai_generate: primera versión (F33)", () => {
  it("crear un carrusel con una imagen deja pages[0].background.type = image y una capa con opacidad > 0", async () => {
    const s = setup({ mode: "first", doc: { v: 1, format: "v45", pages: [{ id: "pg_blank001", background: { type: "color", color: "#ffffff" }, elements: [] }] }, attachments: [{ asset_path: photo, name: "foto.png", mime: "image/png" }], content: "Un carrusel con mi foto" });
    const p = provider([{ message: "Armé 3 láminas.", doc: { pages: [pageJson("Portada", "Gancho"), pageJson("Idea"), pageJson("Seguinos")] } }]);
    const { d } = deps({ generate: p.generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "done", mode: "first" });
    const row = s.tables.designs[0] as { doc: DesignDoc; rev: number; style: string };
    expect(row.doc.pages[0].background.type).toBe("image");
    expect(row.doc.pages[0].background.image?.asset).toBe(photo);
    expect(row.doc.pages[0].background.overlay?.opacity).toBeGreaterThan(0);
    expect(row.doc.pages).toHaveLength(3);
    expect(row.rev).toBe(4);
    expect(row.style).toBe("auto");
    expect(p.calls[0].images).toHaveLength(1);
    expect(lastAssistant(s.tables).result).toMatchObject({ summary: "Creó 3 páginas" });
  });

  it("una imagen de otro negocio no llega a la IA y se avisa", async () => {
    const s = setup({ mode: "first", doc: { v: 1, format: "v45", pages: [{ id: "pg_blank001", background: { type: "color", color: "#ffffff" }, elements: [] }] }, attachments: [{ asset_path: "99999999-0000-0000-0000-000000000000/images/x.png", name: "ajena.png", mime: "image/png" }] });
    const p = provider([{ message: "Listo", doc: { pages: [pageJson("Hola")] } }]);
    const { d } = deps({ generate: p.generate });
    await runAiGenerate(s.db, s.payload, d);
    expect(p.calls[0].images).toHaveLength(0);
    expect((lastAssistant(s.tables).result as { warnings: string[] }).warnings.join(" ")).toMatch(/No pude usar alguna de las imágenes/);
  });

  it("deja en el diseño lo que dejó la revisión (designs.last_qa)", async () => {
    const s = setup({ mode: "first", doc: { v: 1, format: "v45", pages: [{ id: "pg_blank001", background: { type: "color", color: "#ffffff" }, elements: [] }] } });
    const p = provider([{ message: "Listo", doc: { pages: [pageJson("Hola")] } }]);
    const { d } = deps({ generate: p.generate });
    await runAiGenerate(s.db, s.payload, d);
    const row = s.tables.designs[0] as { last_qa: { at: string; issues: unknown[]; unchecked: string[] } };
    expect(row.last_qa.at).toBe("2026-11-07T12:00:00.000Z");
    expect(row.last_qa.unchecked[0]).toMatch(/falta conectar el servicio de render/);
  });
});

describe("design_ai_generate: cambiar de estilo (F35)", () => {
  it("guarda el diseño anterior como versión (se puede volver atrás), cambia el estilo y conserva los textos", async () => {
    const s = setup({ mode: "style", content: "Rehacé el diseño con el estilo Minimal" });
    s.payload.styleKey = "minimal";
    const before = structuredClone((s.tables.designs[0] as { doc: DesignDoc }).doc);
    const p = provider([{ message: "Rehice el diseño con el estilo «Minimal».", patch: { pages: before.pages.map((pg, i) => ({ index: i, background: { type: "color", color: "#ffffff" }, ops: pg.elements.map((e) => ({ op: "update", id: e.id, set: { color: "#111111" } })) })) } }]);
    const { d } = deps({ generate: p.generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "done", mode: "style" });
    const row = s.tables.designs[0] as { doc: DesignDoc; style: string };
    expect(row.style).toBe("minimal");
    expect(row.doc.style).toBe("minimal");
    const texts = (doc: DesignDoc) => doc.pages.flatMap((pg) => pg.elements.map((e) => (e.type === "text" ? e.text : ""))).sort();
    expect(texts(row.doc)).toEqual(texts(before));
    const versions = s.inserts.filter((i) => i.table === "design_versions").map((i) => i.row);
    expect(versions.map((v) => v.reason)).toEqual(["manual", "ai"]);
    expect(versions[0].doc).toEqual(before);
  });
});

describe("design_ai_generate: propuestas con «Hacerlo / No» (F30, F47)", () => {
  const withImage = (): DesignDoc => ({ v: 1, format: "carta_h", pages: [{ id: "pg_img00001", background: { type: "image", image: { asset: photo, fit: "cover", focal: { x: 50, y: 50 }, locked: true } }, elements: [] }] });
  const proposal = (kind: string) => ({ message: "Puse el nombre y la fecha.", documentKind: kind, patch: { pages: [{ index: 0, ops: [{ op: "add", element: textJson("{{contact.display_name}}", { color: "#111111", size: 48 }) }] }] } });

  it("proponer textos para una imagen base: no guarda el diseño, deja la propuesta pendiente y, si parece un certificado, ofrece la verificación", async () => {
    const s = setup({ mode: "propose_texts", kind: "template", format: "carta_h", doc: withImage(), content: "Que la IA me proponga dónde van los textos y las variables." });
    const p = provider([proposal("certificado")]);
    const { d } = deps({ generate: p.generate });
    const out = await runAiGenerate(s.db, s.payload, d);
    expect(out).toMatchObject({ status: "proposed" });
    // No se guardó nada en la plantilla.
    expect((s.tables.design_templates[0] as { rev: number }).rev).toBe(3);
    expect(s.inserts.some((i) => i.table === "design_versions")).toBe(false);
    // La IA vio la imagen base.
    expect(p.calls[0].images).toHaveLength(1);

    const assistants = s.tables.ai_messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0].content).toMatch(/¿Lo hago\?$/);
    expect(assistants[0].result).toMatchObject({ proposal: { kind: "template_texts", status: "pending", payload: { baseRev: 3 } } });
    expect(assistants[1].result).toMatchObject({ proposal: { kind: "enable_verification", status: "pending", payload: { doc_type: "certificado" } } });
    expect(assistants[1].content).toMatch(/¿Prendo la verificación como Certificado\?/);
  });

  it("primera versión de una plantilla impresa que es un certificado: la respuesta trae la propuesta de verificación con su texto", async () => {
    const s = setup({ mode: "first", kind: "template", format: "carta_h", doc: { v: 1, format: "carta_h", pages: [{ id: "pg_blank001", background: { type: "color", color: "#ffffff" }, elements: [] }] }, content: "Un certificado de finalización" });
    const p = provider([{ message: "Armé el certificado.", documentKind: "certificado", doc: { pages: [{ background: { type: "color", color: "#ffffff" }, elements: [textJson("Certificado", { color: "#111111", size: 48 })] }] } }]);
    const { d } = deps({ generate: p.generate });
    await runAiGenerate(s.db, s.payload, d);
    const answer = lastAssistant(s.tables);
    expect(answer.result).toMatchObject({ proposal: { kind: "enable_verification", status: "pending", payload: { doc_type: "certificado" } } });
    expect(answer.content).toContain("Armé el certificado.");
    expect(answer.content).toMatch(/¿Prendo la verificación como Certificado\?/);
  });

  it("también la propone por las palabras del pedido si la IA no dijo nada", async () => {
    const s = setup({ mode: "first", kind: "template", format: "a4_h" as never, doc: { v: 1, format: "carta_h", pages: [{ id: "pg_blank001", background: { type: "color", color: "#ffffff" }, elements: [] }] }, content: "Una constancia de asistencia" });
    (s.tables.design_templates[0] as { format: string }).format = "carta_h";
    const p = provider([{ message: "Listo", doc: { pages: [{ background: { type: "color", color: "#ffffff" }, elements: [textJson("Constancia", { color: "#111111", size: 48 })] }] } }]);
    const { d } = deps({ generate: p.generate });
    await runAiGenerate(s.db, s.payload, d);
    expect(lastAssistant(s.tables).result).toMatchObject({ proposal: { kind: "enable_verification", payload: { doc_type: "constancia" } } });
  });

  it("no la propone en un diseño suelto, en un formato de redes ni si la plantilla ya verifica", async () => {
    const blank = (format: "v45" | "carta_h"): DesignDoc => ({ v: 1, format, pages: [{ id: "pg_blank001", background: { type: "color", color: "#ffffff" }, elements: [] }] });
    const reply = { message: "Listo", documentKind: "certificado", doc: { pages: [{ background: { type: "color", color: "#ffffff" }, elements: [textJson("Certificado", { color: "#111111", size: 48 })] }] } };

    const design = setup({ mode: "first", kind: "design", format: "carta_h", doc: blank("carta_h") });
    await runAiGenerate(design.db, design.payload, deps({ generate: provider([reply]).generate }).d);
    expect((lastAssistant(design.tables).result as { proposal?: unknown }).proposal).toBeUndefined();

    const social = setup({ mode: "first", kind: "template", format: "v45", doc: blank("v45") });
    await runAiGenerate(social.db, social.payload, deps({ generate: provider([reply]).generate }).d);
    expect((lastAssistant(social.tables).result as { proposal?: unknown }).proposal).toBeUndefined();

    const verifies = setup({ mode: "first", kind: "template", format: "carta_h", doc: blank("carta_h") });
    (verifies.tables.design_templates[0] as { verify: boolean }).verify = true;
    await runAiGenerate(verifies.db, verifies.payload, deps({ generate: provider([reply]).generate }).d);
    expect((lastAssistant(verifies.tables).result as { proposal?: unknown }).proposal).toBeUndefined();
  });

  it("un cambio común no vuelve a proponer la verificación", async () => {
    const s = setup({ mode: "change", kind: "template", format: "carta_h" });
    const p = provider([{ message: "Listo", documentKind: "certificado", patch: { pages: [update(0, "el_only001", { size: 50 })] } }]);
    await runAiGenerate(s.db, s.payload, deps({ generate: p.generate }).d);
    expect((lastAssistant(s.tables).result as { proposal?: unknown }).proposal).toBeUndefined();
  });
});

describe("design_ai_generate: casos de borde", () => {
  it("un job sin lo necesario no hace nada", async () => {
    const s = setup();
    expect(await runAiGenerate(s.db, { workspaceId: WS }, deps().d)).toEqual({ status: "skipped", reason: "bad_payload" });
  });

  it("un pedido que ya tiene respuesta no se contesta dos veces", async () => {
    const s = setup();
    s.tables.ai_messages.push({ id: "m2", thread_id: "th1", role: "assistant", content: "Ya", result: { changed_pages: [], summary: "" }, created_at: "2026-11-07T12:00:30.000Z" });
    const p = provider([{ message: "x", patch: { pages: [] } }]);
    expect(await runAiGenerate(s.db, s.payload, deps({ generate: p.generate }).d)).toEqual({ status: "skipped", reason: "already_answered" });
    expect(p.calls).toHaveLength(0);
  });

  it("un diseño que ya no existe contesta con un aviso", async () => {
    const s = setup();
    s.tables.designs.length = 0;
    const out = await runAiGenerate(s.db, s.payload, deps({ generate: provider([{}]).generate }).d);
    expect(out).toMatchObject({ status: "failed", reason: "gone" });
  });

  it("nunca trabaja sobre un diseño de otro negocio", async () => {
    const s = setup();
    (s.tables.designs[0] as { workspace_id: string }).workspace_id = "99999999-2222-3333-4444-555555555555";
    const out = await runAiGenerate(s.db, s.payload, deps({ generate: provider([{}]).generate }).d);
    expect(out).toMatchObject({ status: "failed", reason: "gone" });
  });
});
