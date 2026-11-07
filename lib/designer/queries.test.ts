import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { emptyDoc } from "./doc/schema";
import { DEFAULT_LIST_FILTERS } from "./screens/list";
import { loadEditorRecord, loadList, parseCustomVars } from "./queries";

const WS = "11111111-2222-3333-4444-555555555555";

function withStorage(fake: ReturnType<typeof fakeDb>) {
  const signed: string[][] = [];
  fake.client.storage = {
    from: () => ({
      createSignedUrls: async (paths: string[]) => {
        signed.push(paths);
        return { data: paths.map((path) => ({ path, signedUrl: `https://s.test/${path}` })), error: null };
      },
    }),
  };
  return signed;
}

const designRow = (id: string, extra: Record<string, unknown> = {}) => {
  const doc = emptyDoc("v45");
  doc.pages.push({ ...doc.pages[0], id: "pg_bbbbbb" });
  return { id, name: `Pieza ${id}`, format: "v45", origin: "ai", published: false, archived_at: null, updated_at: "2026-11-07T10:00:00Z", doc, ...extra };
};

describe("la lista (F15) y las miniaturas en vivo (F48)", () => {
  it("la lista de Diseños pide SOLO diseños propios: una generación nunca entra (template_id IS NULL)", async () => {
    const fake = fakeDb({ designs: { data: [designRow("d1")], count: 1 } });
    withStorage(fake);
    await loadList(fake.client, WS, DEFAULT_LIST_FILTERS, {});
    const listCall = fake.calls.find((c) => c.table === "designs" && c.op === "select" && c.filters.some((f) => f.column === "name") === false && c.filters.some((f) => f.method === "range"));
    expect(listCall).toBeTruthy();
    expect(listCall!.filters).toContainEqual({ method: "is", column: "template_id", value: null });
    expect(listCall!.filters).toContainEqual({ method: "eq", column: "workspace_id", value: WS });
    expect(listCall!.filters).toContainEqual({ method: "is", column: "archived_at", value: null });
  });

  it("pagina de a 48 y aplica buscador, formato y origen", async () => {
    const fake = fakeDb({ designs: { data: [], count: 0 } });
    withStorage(fake);
    await loadList(fake.client, WS, { ...DEFAULT_LIST_FILTERS, q: "carrusel", format: "v45", origin: "manual", page: 2 }, {});
    const call = fake.calls.find((c) => c.filters.some((f) => f.method === "range"))!;
    expect(call.filters).toContainEqual({ method: "range", column: 48, value: 95 });
    expect(call.filters.find((f) => f.method === "ilike")?.value).toBe("%carrusel%");
    expect(call.filters).toContainEqual({ method: "eq", column: "format", value: "v45" });
    expect(call.filters).toContainEqual({ method: "in", column: "origin", value: ["blank", "image"] });
  });

  it("el buscador no deja pasar comodines ni comas que rompan el filtro", async () => {
    const fake = fakeDb({ designs: { data: [], count: 0 } });
    withStorage(fake);
    await loadList(fake.client, WS, { ...DEFAULT_LIST_FILTERS, q: "a%b,c_d" }, {});
    const call = fake.calls.find((c) => c.filters.some((f) => f.method === "ilike"))!;
    expect(call.filters.find((f) => f.method === "ilike")?.value).toBe("%a b c d%");
  });

  it("la lista NO dispara renders: no escribe nada y no toca la cola de jobs", async () => {
    const fake = fakeDb({
      designs: { data: [designRow("d1"), designRow("d2")], count: 2 },
    });
    withStorage(fake);
    const data = await loadList(fake.client, WS, DEFAULT_LIST_FILTERS, {});
    expect(fake.writes()).toEqual([]);
    expect(fake.calls.some((c) => c.table === "scheduled_jobs")).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
    expect(data.items).toHaveLength(2);
    // Cada tarjeta lleva solo su primera página (para dibujarla) y cuenta todas.
    expect(data.items[0].card.pages).toBe(2);
    expect(data.items[0].thumbDoc?.pages).toHaveLength(1);
  });

  it("firma las imágenes de la primera página para las miniaturas, en un solo pedido", async () => {
    const doc = emptyDoc("v45");
    doc.pages[0].background = { type: "image", image: { asset: `${WS}/images/a.png`, fit: "cover", focal: { x: 50, y: 50 }, locked: true } };
    const fake = fakeDb({ designs: { data: [designRow("d1", { doc })], count: 1 } });
    const signed = withStorage(fake);
    const data = await loadList(fake.client, WS, DEFAULT_LIST_FILTERS, {});
    expect(signed).toEqual([[`${WS}/images/a.png`]]);
    expect(data.assetUrls[`${WS}/images/a.png`]).toBe(`https://s.test/${WS}/images/a.png`);
  });

  it("una fila con un formato desconocido no rompe la lista: se saltea", async () => {
    const fake = fakeDb({ designs: { data: [designRow("d1", { format: "raro" }), designRow("d2")], count: 2 } });
    withStorage(fake);
    const data = await loadList(fake.client, WS, DEFAULT_LIST_FILTERS, {});
    expect(data.items.map((i) => i.card.id)).toEqual(["d2"]);
  });

  it("Plantillas: cuenta variables y generaciones sin escribir nada", async () => {
    const doc = emptyDoc("carta_h");
    doc.pages[0].elements.push({ id: "el_aaaaaa", type: "text", x: 50, y: 50, w: 80, text: "{{contact.display_name}} y {{contact.first_name}}", font: { family: "Inter", weight: 400 }, size: 30, align: "center", color: "#111111" });
    const fake = fakeDb({
      design_templates: (call) => (call.filters.some((f) => f.method === "range") ? { data: [{ id: "t1", name: "Certificado", format: "carta_h", origin: "ai", verify: true, doc_type: "certificado", doc_type_label: null, custom_vars: [], archived_at: null, updated_at: "2026-11-07T10:00:00Z", doc }], count: 1 } : { data: null, count: 1 }),
      designs: { data: null, count: 5 },
    });
    withStorage(fake);
    const data = await loadList(fake.client, WS, { ...DEFAULT_LIST_FILTERS, tab: "plantillas" }, {});
    expect(data.items[0].card).toMatchObject({ kind: "template", variables: 2, generated: 5, verify: true, docType: "certificado" });
    expect(fake.writes()).toEqual([]);
  });
});

describe("el editor carga lo suyo", () => {
  it("un diseño inexistente (o que la RLS no deja ver) es 'no existe'", async () => {
    const fake = fakeDb({ designs: { data: null } });
    expect(await loadEditorRecord(fake.client, WS, "design", "x")).toEqual({ ok: false, reason: "not_found" });
  });

  it("un documento guardado que no valida se avisa, no rompe", async () => {
    const fake = fakeDb({ designs: { data: { ...designRow("d1"), doc: { v: 1, format: "v45", pages: [] }, template_id: null } } });
    expect(await loadEditorRecord(fake.client, WS, "design", "d1")).toEqual({ ok: false, reason: "invalid_doc" });
  });

  it("una generación trae su plantilla y para quién es", async () => {
    const fake = fakeDb({
      designs: { data: { ...designRow("g1"), code: "K8F2-WQ4M-7TQA", allow_download: true, allow_indexing: false, style: null, rev: 2, template_id: "t1", content_post_id: null, content_network: null, subject_ref: { label: "Ana Pérez" }, status: "ready" } },
      design_templates: { data: { name: "Certificado", verify: true, doc_type: "constancia", doc_type_label: null } },
    });
    const out = await loadEditorRecord(fake.client, WS, "design", "g1");
    expect(out.ok && out.record.generation).toEqual({ templateId: "t1", templateName: "Certificado", subjectLabel: "Ana Pérez", status: "ready", verify: true, docType: "constancia", docTypeLabel: null });
  });

  it("las variables propias se leen con su forma y lo demás se descarta", () => {
    expect(parseCustomVars([{ key: "nombre_en_el_certificado", label: "Nombre", sample: "Ana" }, { key: "Mal Escrita", label: "x" }, { key: "ok_1", label: 3 }, null, "x"])).toEqual([
      { key: "nombre_en_el_certificado", label: "Nombre", sample: "Ana", default: null },
    ]);
    expect(parseCustomVars("no")).toEqual([]);
  });
});
