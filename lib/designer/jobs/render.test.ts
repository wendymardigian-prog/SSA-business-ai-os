import { describe, expect, it, vi } from "vitest";
import { emptyDoc } from "../doc/schema";
import { RenderFailed, RenderNotConfigured, RENDER_NOT_CONFIGURED_MESSAGE, type RenderRequest } from "../render-client";
import { DESIGN_RENDER_JOB, runDesignRender } from "./render";

const WS = "11111111-2222-3333-4444-555555555555";
const DESIGN = "aaaaaaaa-2222-3333-4444-555555555555";

/** Un cliente de Supabase en memoria con lo justo que usa el job. */
function fakeDb(row: Record<string, unknown>) {
  const state = { row: { ...row }, uploads: [] as string[], updates: [] as Record<string, unknown>[] };
  const db = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => (table === "designs" ? { data: state.row, error: null } : { data: { design_settings: {} }, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            state.updates.push(values);
            Object.assign(state.row, values);
            return { error: null };
          },
        }),
      };
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploads.push(path);
          return { error: null };
        },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://s/${p}` })), error: null }),
      }),
    },
  };
  return { db: db as never, state };
}

const baseRow = (extra: Record<string, unknown> = {}) => ({
  id: DESIGN,
  workspace_id: WS,
  doc: emptyDoc("v45"),
  format: "v45",
  code: "K8F2-WQ4M-7TQA",
  rev: 3,
  values: {},
  template_id: null,
  subject_contact_id: null,
  subject_ref: null,
  renders: {},
  attempts: 0,
  ...extra,
});

const fakeRender = vi.fn(async (req: RenderRequest) => ({
  version: "test",
  files: req.format === "pdf" ? [{ page: 0, contentType: "application/pdf" as const, bytes: new Uint8Array([37]) }] : (req.pages ?? [{ html: req.html! }]).map((_, page) => ({ page, contentType: "image/png" as const, bytes: new Uint8Array([1]) })),
}));
const NOW = new Date("2026-11-07T12:00:00Z");

describe("design_render (F6)", () => {
  it("guarda un PNG por página y un PDF, y deja el juego en `renders`", async () => {
    const { db, state } = fakeDb(baseRow());
    const out = await runDesignRender(db, { designId: DESIGN, purpose: "publish" }, { render: fakeRender, now: () => NOW, schedule: vi.fn() });
    expect(out.status).toBe("rendered");
    expect(state.uploads).toEqual([`${WS}/${DESIGN}/3-${NOW.getTime()}/page-01.png`, `${WS}/${DESIGN}/3-${NOW.getTime()}/document.pdf`]);
    expect(state.row.renders).toMatchObject({ pdf_path: `${WS}/${DESIGN}/3-${NOW.getTime()}/document.pdf`, pages: [`${WS}/${DESIGN}/3-${NOW.getTime()}/page-01.png`] });
    expect(state.row.attempts).toBe(0);
  });

  it("una generación termina `ready`", async () => {
    const { db, state } = fakeDb(baseRow({ template_id: "t1", status: "queued" }));
    await runDesignRender(db, { designId: DESIGN, purpose: "generation" }, { render: fakeRender, now: () => NOW, schedule: vi.fn() });
    expect(state.row.status).toBe("ready");
  });

  it("con el servicio caído deja attempts y next_attempt_at, se reagenda a 1, 5 y 15 min y al cuarto fallo queda failed", async () => {
    const { db, state } = fakeDb(baseRow({ template_id: "t1", status: "queued" }));
    const failing = vi.fn(async () => Promise.reject(new RenderFailed("dormido", { retryable: true, status: 503 })));
    const schedule = vi.fn(async () => ({ id: "j" }));
    const minutes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const out = await runDesignRender(db, { designId: DESIGN, purpose: "generation" }, { render: failing, now: () => NOW, schedule: schedule as never });
      expect(out.status).toBe("retry");
      expect(state.row.attempts).toBe(i + 1);
      minutes.push((Date.parse(state.row.next_attempt_at as string) - NOW.getTime()) / 60_000);
    }
    expect(minutes).toEqual([1, 5, 15]);
    expect(schedule).toHaveBeenCalledTimes(3);
    expect(schedule).toHaveBeenCalledWith(db, DESIGN_RENDER_JOB, expect.objectContaining({ designId: DESIGN }), expect.any(Date));
    const last = await runDesignRender(db, { designId: DESIGN, purpose: "generation" }, { render: failing, now: () => NOW, schedule: schedule as never });
    expect(last.status).toBe("failed");
    expect(state.row.status).toBe("failed");
    expect(state.row.attempts).toBe(4);
    expect(state.row.next_attempt_at).toBeNull();
    expect(state.row.error).toBeTruthy();
  });

  it("sin el servicio configurado queda failed con «Falta conectar el servicio de render» y sin reagendar", async () => {
    const { db, state } = fakeDb(baseRow({ template_id: "t1", status: "queued" }));
    const schedule = vi.fn();
    const out = await runDesignRender(db, { designId: DESIGN, purpose: "generation" }, { render: async () => Promise.reject(new RenderNotConfigured()), now: () => NOW, schedule });
    expect(out).toEqual({ status: "failed", error: RENDER_NOT_CONFIGURED_MESSAGE });
    expect(state.row.status).toBe("failed");
    expect(state.row.error).toBe(RENDER_NOT_CONFIGURED_MESSAGE);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("exporta un ZIP de imágenes en la carpeta de exportaciones", async () => {
    const { db, state } = fakeDb(baseRow());
    const out = await runDesignRender(db, { designId: DESIGN, purpose: "export", exportKind: "zip", stamp: "s1" }, { render: fakeRender, now: () => NOW, schedule: vi.fn() });
    expect(out).toEqual({ status: "exported", paths: [`${WS}/${DESIGN}/exports/s1/imagenes.zip`] });
    expect(state.row.renders).toEqual({});
  });

  it("una página web no se renderiza", async () => {
    const { db } = fakeDb(baseRow({ doc: emptyDoc("web"), format: "web" }));
    const render = vi.fn();
    expect(await runDesignRender(db, { designId: DESIGN, purpose: "publish" }, { render, now: () => NOW, schedule: vi.fn() })).toEqual({ status: "skipped", reason: "web_no_export" });
    expect(render).not.toHaveBeenCalled();
  });
});
