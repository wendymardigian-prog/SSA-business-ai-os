import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { PENDING_BATCH_LIMIT, countPending, enqueuePendingDocuments, indexDedupeKey } from "./pending";

const WS = "ws-1";
const doc = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  workspace_id: WS,
  status,
  deleted_at: null,
  source_file_path: `${WS}/${id}.pdf`,
  error_detail: status === "error" ? "algo fallo" : null,
  created_at: `2026-10-0${(Number(id.replace(/\D/g, "")) % 9) + 1}T00:00:00Z`,
  ...over,
});

const jobs = (db: ReturnType<typeof memoryDb>) => db.rows("scheduled_jobs");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("retomar los documentos pendientes (F1)", () => {
  it("encola SOLO los pendientes: ni lo listo, ni lo que esta procesando, ni los errores", async () => {
    const db = memoryDb({
      knowledge_base: [doc("d1", "pending"), doc("d2", "ready"), doc("d3", "processing"), doc("d4", "error"), doc("d5", "pending")],
      scheduled_jobs: [],
    });
    const result = await enqueuePendingDocuments(db.client, WS);

    expect(result).toEqual({ queued: 2, failed: 0, remaining: 0 });
    expect(jobs(db).map((j) => (j.payload as { documentId: string }).documentId).sort()).toEqual(["d1", "d5"]);
    // Lo encolado pasa a processing; lo demas queda como estaba.
    const status = Object.fromEntries(db.rows("knowledge_base").map((d) => [d.id as string, d.status]));
    expect(status).toEqual({ d1: "processing", d2: "ready", d3: "processing", d4: "error", d5: "processing" });
  });

  it("cada trabajo lleva una clave de dedupe por documento", async () => {
    const db = memoryDb({ knowledge_base: [doc("d1", "pending")], scheduled_jobs: [] });
    await enqueuePendingDocuments(db.client, WS);
    expect(jobs(db)[0]).toMatchObject({ type: "index_document", dedupe_key: indexDedupeKey("d1") });
  });

  it("no duplica: una segunda pasada no encola nada porque ya no hay pendientes", async () => {
    const db = memoryDb({ knowledge_base: [doc("d1", "pending")], scheduled_jobs: [] });
    await enqueuePendingDocuments(db.client, WS);
    const second = await enqueuePendingDocuments(db.client, WS);
    expect(second.queued).toBe(0);
    expect(jobs(db)).toHaveLength(1);
  });

  it("si ya hay un job de ese documento en cola (23505), no es un fallo ni se duplica", async () => {
    const db = memoryDb(
      { knowledge_base: [doc("d1", "pending")], scheduled_jobs: [{ id: "j0", type: "index_document", dedupe_key: indexDedupeKey("d1"), status: "pending" }] },
      { unique: { scheduled_jobs: (a, b) => a.dedupe_key === b.dedupe_key } },
    );
    const result = await enqueuePendingDocuments(db.client, WS);
    expect(result).toMatchObject({ queued: 1, failed: 0 });
    expect(jobs(db)).toHaveLength(1);
  });

  it("si no se pudo encolar, el documento VUELVE a pendiente (no queda en un procesando eterno)", async () => {
    const db = memoryDb({ knowledge_base: [doc("d1", "pending")] });
    const client = db.client;
    const originalFrom = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "scheduled_jobs") {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "XX000", message: "se cayo" } }) }) }) };
      }
      return originalFrom(table as never);
    };
    const result = await enqueuePendingDocuments(client, WS);
    expect(result).toMatchObject({ queued: 0, failed: 1 });
    expect(db.rows("knowledge_base")[0].status).toBe("pending");
  });

  it("no toca los documentos de otro workspace ni los borrados ni los sin archivo", async () => {
    const db = memoryDb({
      knowledge_base: [
        doc("d1", "pending", { workspace_id: "otro" }),
        doc("d2", "pending", { deleted_at: "2026-10-01T00:00:00Z" }),
        doc("d3", "pending", { source_file_path: null }),
        doc("d4", "pending"),
      ],
      scheduled_jobs: [],
    });
    const result = await enqueuePendingDocuments(db.client, WS);
    expect(result.queued).toBe(1);
    expect((jobs(db)[0].payload as { documentId: string }).documentId).toBe("d4");
  });

  it("una tanda tiene tope y avisa cuantos quedaron afuera", async () => {
    const rows = Array.from({ length: PENDING_BATCH_LIMIT + 3 }, (_, i) => doc(`d${i}`, "pending"));
    const db = memoryDb({ knowledge_base: rows, scheduled_jobs: [] });
    const result = await enqueuePendingDocuments(db.client, WS);
    expect(result.queued).toBe(PENDING_BATCH_LIMIT);
    expect(result.remaining).toBe(3);
  });

  it("nunca lanza: un error al leer devuelve ceros", async () => {
    const db = memoryDb({});
    const client = db.client;
    (client as unknown as { from: () => unknown }).from = () => {
      throw new Error("base caida");
    };
    await expect(enqueuePendingDocuments(client, WS)).resolves.toEqual({ queued: 0, failed: 0, remaining: 0 });
  });
});

describe("countPending", () => {
  it("cuenta solo los pendientes", () => {
    expect(countPending([{ status: "pending" }, { status: "ready" }, { status: "pending" }, { status: "error" }])).toBe(2);
  });
});
