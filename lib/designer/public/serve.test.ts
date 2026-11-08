import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { CODE, DESIGN, PNG, WS, publicDb, rpcDesign, rpcGeneration } from "../testing/public-fixtures";
import { filesFor, servePageImage, serveDownload, servePreview, type ServeDeps } from "./serve";
import { loadPublicDesign } from "./load";

const req = (path: string) => new Request(`https://links.test${path}`, { headers: { "x-real-ip": "203.0.113.9" } });
const notFoundFast: ServeDeps["notFound"] = async () => new Response("No encontrado", { status: 404 });
const deps = (extra: ServeDeps = {}): ServeDeps => ({ notFound: notFoundFast, enqueue: vi.fn(async () => undefined), renderImage: vi.fn(async () => new Uint8Array([0x89, 0x50])), ...extra });
const text = async (res: Response) => await res.text();

describe("loadPublicDesign", () => {
  it("junta lo que dice la función pública con los archivos y la marca del negocio", async () => {
    const { db } = publicDb();
    const record = await loadPublicDesign(db.client, CODE.toLowerCase());
    expect(record).toMatchObject({ designId: DESIGN, workspaceId: WS });
    expect(record?.renders?.pages).toHaveLength(1);
    expect(record?.workspace.brand_name).toBe("Academia Ejemplo");
    expect(db.rpcCalls[0]).toEqual({ name: "design_public_get", args: { p_code: CODE } });
  });

  it("un código con forma rara no llega ni a la base", async () => {
    const { db } = publicDb();
    for (const bad of ["../../etc", "", null, undefined, "K8F2-WQ4M-7TQU"]) expect(await loadPublicDesign(db.client, bad as string)).toBeNull();
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("si la función pública devuelve vacío (inexistente, borrador), no se lee nada más", async () => {
    const { db } = publicDb({ rpc: null });
    expect(await loadPublicDesign(db.client, CODE)).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  it("ante un error de la base, 404 en vez de algo a medias", async () => {
    const { db } = publicDb();
    db.failures.set("rpc.design_public_get", "caída");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadPublicDesign(db.client, CODE)).toBeNull();
    spy.mockRestore();
  });
});

describe("la imagen de una página", () => {
  it("sale del bucket privado con el tipo de imagen y sin dejar guardar en caché públicas", async () => {
    const { db } = publicDb();
    const res = await servePageImage(db.client, req(`/d/${CODE}/p/1`), CODE, "1", deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("una página que no existe, un número raro o un borrador: 404", async () => {
    const { db, current } = publicDb({ pages: 2, rpc: rpcDesign({ page_count: 2 }) });
    for (const n of ["0", "3", "-1", "1.5", "abc", "1000", ""]) expect((await servePageImage(db.client, req("/x"), CODE, n, deps())).status).toBe(404);
    current.value = null;
    expect((await servePageImage(db.client, req("/x"), CODE, "1", deps())).status).toBe(404);
  });

  it("una pieza que se está preparando no entrega imágenes", async () => {
    const { db } = publicDb({ rpc: rpcGeneration({ status: "rendering", rendered: false }) });
    expect((await servePageImage(db.client, req("/x"), CODE, "1", deps())).status).toBe(404);
  });

  it("una pieza anulada todavía se ve (con su sello): la imagen sale", async () => {
    const { db } = publicDb({ rpc: rpcGeneration({ status: "void", void_reason: "Error" }) });
    expect((await servePageImage(db.client, req("/x"), CODE, "1", deps())).status).toBe(200);
  });

  it("pasado el tope por IP, 429", async () => {
    const { db, limitHits } = publicDb();
    limitHits.count = 10_000;
    db.rpcs.bump_rate_limit = () => ++limitHits.count;
    const res = await servePageImage(db.client, req("/x"), CODE, "1", deps());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("la variante ×1 de una pieza de redes (guardada ×2) se achica; la ×2 es el archivo tal cual", async () => {
    const { db } = publicDb({ rpc: rpcDesign({ format: "v45" }) });
    const one = await servePageImage(db.client, req(`/d/${CODE}/p/1?x=1`), CODE, "1", deps());
    const two = await servePageImage(db.client, req(`/d/${CODE}/p/1?x=2`), CODE, "1", deps());
    expect(one.status).toBe(200);
    expect(new Uint8Array(await two.arrayBuffer())).toEqual(PNG);
  });

  it("una ruta mal guardada (de otro diseño) no se sirve", async () => {
    const { db } = publicDb({ renders: { version: "x", pdf_path: null, pages: [`${WS}/bbbbbbbb-2222-3333-4444-555555555555/1/page-01.png`] } });
    expect((await servePageImage(db.client, req("/x"), CODE, "1", deps())).status).toBe(404);
  });
});

describe("la descarga (F44)", () => {
  it("un PDF sale por streaming con un nombre legible", async () => {
    const { db } = publicDb();
    const res = await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain('filename="certificado-ana-perez.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([37, 80, 68, 70]);
  });

  it("no expone el bucket ni un link firmado reutilizable", async () => {
    const { db } = publicDb();
    const res = await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps());
    const all = JSON.stringify([...res.headers.entries()]);
    expect(all).not.toMatch(/storage|token|design-renders|supabase/i);
    expect(res.headers.get("location")).toBeNull();
  });

  it("con la descarga apagada, 404", async () => {
    const { db } = publicDb({ rpc: rpcDesign({ allow_download: false }) });
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps())).status).toBe(404);
  });

  it("una pieza anulada no se baja (404)", async () => {
    const { db } = publicDb({ rpc: rpcGeneration({ status: "void", void_reason: "Error" }) });
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps())).status).toBe(404);
  });

  it("una generación que se está preparando no se baja (404)", async () => {
    const { db } = publicDb({ rpc: rpcGeneration({ status: "queued", rendered: false }) });
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps())).status).toBe(404);
  });

  it("un borrador o un código inexistente, 404", async () => {
    const { db } = publicDb({ rpc: null });
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps())).status).toBe(404);
  });

  it("una página web no se descarga (404)", async () => {
    const { db } = publicDb({ rpc: rpcDesign({ format: "web" }) });
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar`), CODE, deps())).status).toBe(404);
  });

  it("un formato o una página raros, 404", async () => {
    const { db } = publicDb();
    for (const q of ["?formato=exe", "?formato=zip", "?formato=png&pagina=2", "?formato=png&pagina=x"]) {
      expect((await serveDownload(db.client, req(`/d/${CODE}/descargar${q}`), CODE, deps())).status).toBe(404);
    }
  });

  it("si todavía no está el archivo: encola el render y responde 202", async () => {
    const { db } = publicDb({ renders: null, rpc: rpcDesign({ rendered: false }) });
    const d = deps();
    const res = await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, d);
    expect(res.status).toBe(202);
    expect(await text(res)).toBe("Se está preparando, probá en unos segundos");
    expect(d.enqueue).toHaveBeenCalledWith(db.client, { designId: DESIGN, purpose: "publish" });
  });

  it("si el archivo está registrado pero falta en el bucket, también se vuelve a pedir", async () => {
    const { db } = publicDb();
    db.buckets.get("design-renders")?.clear();
    const d = deps();
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, d)).status).toBe(202);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it("una generación lista sin archivo responde 202 pero NO se vuelve a renderizar (avisaría dos veces a quien la emitió)", async () => {
    const { db } = publicDb({ renders: null, rpc: rpcGeneration({ rendered: false, status: "ready" }) });
    const d = deps();
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, d)).status).toBe(202);
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("un ZIP junta una imagen por página (01.png, 02.png…)", async () => {
    const { db } = publicDb({ pages: 3, rpc: rpcDesign({ format: "v45", page_count: 3, name: "Carrusel de lanzamiento" }) });
    const res = await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=zip`), CODE, deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("carrusel-de-lanzamiento-imagenes.zip");
    expect(Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer()))).sort()).toEqual(["01.png", "02.png", "03.png"]);
  });

  it("un PNG de una página", async () => {
    const { db } = publicDb({ pages: 3, rpc: rpcDesign({ format: "v45", page_count: 3, name: "Carrusel" }) });
    const res = await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=png&pagina=2`), CODE, deps());
    expect(res.headers.get("content-disposition")).toContain('filename="carrusel-pagina-2.png"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("una generación válida con descarga se baja aunque no esté «publicada»", async () => {
    const { db } = publicDb({ rpc: rpcGeneration() });
    expect((await serveDownload(db.client, req(`/d/${CODE}/descargar?formato=pdf`), CODE, deps())).status).toBe(200);
  });
});

describe("filesFor", () => {
  const record = (renders: { pdfPath: string | null; pages: string[] } | null, pageCount: number) => ({ renders: renders && { version: "1", ...renders }, pub: { pageCount } }) as never;
  it("elige los archivos de lo pedido, o null si el juego no los tiene", () => {
    expect(filesFor(record({ pdfPath: "a.pdf", pages: ["1.png", "2.png"] }, 2), "pdf", 1)).toEqual(["a.pdf"]);
    expect(filesFor(record({ pdfPath: null, pages: ["1.png", "2.png"] }, 2), "pdf", 1)).toBeNull();
    expect(filesFor(record({ pdfPath: "a.pdf", pages: ["1.png", "2.png"] }, 2), "png", 2)).toEqual(["2.png"]);
    expect(filesFor(record({ pdfPath: "a.pdf", pages: ["1.png"] }, 2), "zip", 1)).toBeNull();
    expect(filesFor(record(null, 1), "pdf", 1)).toBeNull();
  });
});

describe("la imagen de la tarjeta", () => {
  it("con archivos de publicar, es la página 1", async () => {
    const { db } = publicDb();
    const d = deps();
    const res = await servePreview(db.client, req(`/d/${CODE}/preview.png`), CODE, d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(d.renderImage).not.toHaveBeenCalled();
  });

  it("sin archivos todavía, la imagen generada con la marca del negocio (nunca el nombre de una pieza que se prepara)", async () => {
    const { db } = publicDb({ renders: null, rpc: rpcGeneration({ status: "queued", rendered: false }) });
    const d = deps();
    const res = await servePreview(db.client, req(`/d/${CODE}/preview.png`), CODE, d);
    expect(res.status).toBe(200);
    expect(d.renderImage).toHaveBeenCalledWith(expect.objectContaining({ title: "Diseño", subtitle: "Academia Ejemplo", brand: expect.objectContaining({ name: "Academia Ejemplo" }) }));
  });

  it("una pieza anulada no muestra su imagen en la tarjeta", async () => {
    const { db } = publicDb({ rpc: rpcGeneration({ status: "void", void_reason: "Error" }) });
    const d = deps();
    await servePreview(db.client, req(`/d/${CODE}/preview.png`), CODE, d);
    expect(d.renderImage).toHaveBeenCalledTimes(1);
  });

  it("un código que no existe: 404", async () => {
    const { db } = publicDb({ rpc: null });
    expect((await servePreview(db.client, req(`/d/${CODE}/preview.png`), CODE, deps())).status).toBe(404);
  });
});
