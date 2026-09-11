import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

const generateEmbeddings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/knowledge/embeddings", () => ({ generateEmbeddings }));

import { indexDocument } from "./index-document";
import { EMBEDDING_DIMENSIONS } from "./voyage";
import { makePdf } from "./extract.fixtures";

const vec = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

interface World {
  document?: Record<string, unknown> | null;
  documentError?: { message: string };
  file?: Uint8Array;
  downloadError?: { message: string };
  insertError?: { message: string };
}

/**
 * Cliente falso. Graba los updates de knowledge_base y las filas insertadas en
 * knowledge_chunks, que es lo que hay que assertear.
 */
function fakeClient(world: World) {
  const updates: Array<Record<string, unknown>> = [];
  const inserted: Array<Record<string, unknown>> = [];
  let deletedChunks = false;

  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      maybeSingle: async () => ({
        data: world.document ?? null,
        error: world.documentError ?? null,
      }),
      update: (values: Record<string, unknown>) => {
        if (table === "knowledge_base") updates.push(values);
        return builder;
      },
      delete: () => {
        if (table === "knowledge_chunks") deletedChunks = true;
        return builder;
      },
      insert: async (rows: Array<Record<string, unknown>>) => {
        if (table === "knowledge_chunks") inserted.push(...rows);
        return { error: world.insertError ?? null };
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
    };
    return builder;
  };

  const storage = {
    from: () => ({
      download: async () => ({
        data: world.file
          ? { arrayBuffer: async () => world.file!.buffer.slice(0) as ArrayBuffer }
          : null,
        error: world.downloadError ?? null,
      }),
    }),
  };

  return {
    client: { from, storage } as unknown as SupabaseClient<Database>,
    updates,
    inserted,
    get deletedChunks() {
      return deletedChunks;
    },
  };
}

const DOC = {
  source_file_path: "ws-1/doc-1.pdf",
  source_filename: "precios.pdf",
  source_mime: "application/pdf",
};

const PDF = makePdf("El plan avanzado cuesta 1200 dolares por mes. Incluye soporte prioritario.");

const PAYLOAD = { documentId: "doc-1", workspaceId: "ws-1" };

beforeEach(() => {
  generateEmbeddings.mockReset();
});

describe("el camino feliz", () => {
  it("indexa, guarda los fragmentos y deja el documento listo", async () => {
    generateEmbeddings.mockImplementation(async (_ws: string, texts: string[]) => ({
      ok: true,
      embeddings: texts.map(() => vec()),
      model: "voyage-4-lite",
      totalTokens: 30,
    }));

    const { client, updates, inserted } = fakeClient({ document: DOC, file: PDF });
    const outcome = await indexDocument(client, PAYLOAD);

    expect(outcome.status).toBe("ready");
    expect(outcome.chunks).toBeGreaterThan(0);
    expect(inserted.length).toBe(outcome.chunks);

    const final = updates[updates.length - 1];
    expect(final.status).toBe("ready");
    expect(final.embedding_model).toBe("voyage-4-lite");
    expect(final.error_detail).toBeNull();
    expect(final.indexed_at).toBeTruthy();
  });

  it("indexa con input_type=document, no con el de consulta", async () => {
    generateEmbeddings.mockImplementation(async (_ws: string, texts: string[]) => ({
      ok: true,
      embeddings: texts.map(() => vec()),
      model: "voyage-4-lite",
      totalTokens: 1,
    }));

    const { client } = fakeClient({ document: DOC, file: PDF });
    await indexDocument(client, PAYLOAD);

    expect(generateEmbeddings).toHaveBeenCalledWith(
      "ws-1",
      expect.any(Array),
      expect.objectContaining({ inputType: "document" }),
    );
  });

  it("guarda el embedding en el formato que espera pgvector", async () => {
    generateEmbeddings.mockImplementation(async (_ws: string, texts: string[]) => ({
      ok: true,
      embeddings: texts.map(() => vec()),
      model: "voyage-4-lite",
      totalTokens: 1,
    }));

    const { client, inserted } = fakeClient({ document: DOC, file: PDF });
    await indexDocument(client, PAYLOAD);

    expect(String(inserted[0].embedding)).toMatch(/^\[0\.1(,0\.1)*\]$/);
    expect(inserted[0].workspace_id).toBe("ws-1");
    expect(inserted[0].document_id).toBe("doc-1");
  });

  it("borra los fragmentos viejos antes de escribir: reindexar no duplica", async () => {
    generateEmbeddings.mockImplementation(async (_ws: string, texts: string[]) => ({
      ok: true,
      embeddings: texts.map(() => vec()),
      model: "voyage-4-lite",
      totalTokens: 1,
    }));

    const fake = fakeClient({ document: DOC, file: PDF });
    await indexDocument(fake.client, PAYLOAD);

    expect(fake.deletedChunks).toBe(true);
  });

  it("un documento borrado mientras estaba en cola no es un error", async () => {
    const { client } = fakeClient({ document: null });
    const outcome = await indexDocument(client, PAYLOAD);

    expect(outcome.status).toBe("ready");
    expect(outcome.chunks).toBe(0);
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });
});

/**
 * La distincion que ordena todo el modulo: lo que se puede reintentar se lanza
 * (el runner reintenta con backoff) y lo que no, deja el documento en 'error'.
 */
describe("fallos permanentes: marcan error y NO se reintentan", () => {
  it("sin la key de Voyage", async () => {
    generateEmbeddings.mockResolvedValue({
      ok: false,
      problem: "not_connected",
      message: "Voyage AI no esta conectado.",
      retryable: false,
    });

    const { client, updates } = fakeClient({ document: DOC, file: PDF });
    const outcome = await indexDocument(client, PAYLOAD);

    expect(outcome.status).toBe("error");
    expect(updates.at(-1)?.status).toBe("error");
    expect(String(updates.at(-1)?.error_detail)).toContain("Voyage");
  });

  it("guarda igual el markdown: la conversion anduvo, lo que fallo fue indexar", async () => {
    // Sin esto no habria forma de distinguir "no pude leer el archivo" de "lo
    // lei bien pero no lo pude indexar", y la pantalla de detalle quedaria vacia
    // para un documento que en realidad se convirtio perfecto.
    generateEmbeddings.mockResolvedValue({
      ok: false,
      problem: "not_connected",
      message: "Voyage AI no esta conectado.",
      retryable: false,
    });

    const { client, updates } = fakeClient({ document: DOC, file: PDF });
    await indexDocument(client, PAYLOAD);

    const conContenido = updates.find((u) => typeof u.content_md === "string");
    expect(conContenido).toBeDefined();
    expect(String(conContenido?.content_md)).toContain("1200 dolares");
  });

  it("con la key invalida", async () => {
    generateEmbeddings.mockResolvedValue({
      ok: false,
      problem: "invalid_key",
      message: "Voyage AI rechazo la API key.",
      retryable: false,
    });

    const { client, updates } = fakeClient({ document: DOC, file: PDF });
    const outcome = await indexDocument(client, PAYLOAD);

    expect(outcome.status).toBe("error");
    expect(updates.at(-1)?.status).toBe("error");
  });

  it("con un archivo que no se puede leer", async () => {
    const basura = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0xff, 0xfe, 0x00, 0x01]);
    const { client, updates } = fakeClient({ document: DOC, file: basura });

    const outcome = await indexDocument(client, PAYLOAD);

    expect(outcome.status).toBe("error");
    expect(String(updates.at(-1)?.error_detail)).toContain("No se reconoce");
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });

  it("con un documento sin archivo asociado", async () => {
    const { client, updates } = fakeClient({
      document: { ...DOC, source_file_path: null },
    });

    const outcome = await indexDocument(client, PAYLOAD);

    expect(outcome.status).toBe("error");
    expect(String(updates.at(-1)?.error_detail)).toContain("no tiene archivo");
  });
});

describe("fallos transitorios: se lanzan para que el runner reintente", () => {
  it("cuando Voyage limita el ritmo", async () => {
    generateEmbeddings.mockResolvedValue({
      ok: false,
      problem: "rate_limited",
      message: "Voyage AI esta limitando el ritmo.",
      retryable: true,
    });

    const { client, updates } = fakeClient({ document: DOC, file: PDF });

    await expect(indexDocument(client, PAYLOAD)).rejects.toThrow(/limitando/);
    // El documento sigue en processing: no se marca error todavia.
    expect(updates.at(-1)?.status).toBeUndefined();
    expect(updates.at(-1)?.error_detail).toBeTruthy();
  });

  it("cuando no se puede bajar el archivo", async () => {
    const { client } = fakeClient({
      document: DOC,
      downloadError: { message: "network" },
    });

    await expect(indexDocument(client, PAYLOAD)).rejects.toThrow(/No se pudo bajar/);
  });

  it("cuando falla la lectura del documento en la base", async () => {
    const { client } = fakeClient({ documentError: { message: "timeout" } });

    await expect(indexDocument(client, PAYLOAD)).rejects.toThrow(/No se pudo leer/);
  });

  it("cuando falla el insert de los fragmentos", async () => {
    generateEmbeddings.mockImplementation(async (_ws: string, texts: string[]) => ({
      ok: true,
      embeddings: texts.map(() => vec()),
      model: "voyage-4-lite",
      totalTokens: 1,
    }));

    const { client } = fakeClient({
      document: DOC,
      file: PDF,
      insertError: { message: "constraint" },
    });

    await expect(indexDocument(client, PAYLOAD)).rejects.toThrow(/No se pudieron guardar/);
  });
});
