import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fathom/history-import", () => ({ FATHOM_HISTORY_IMPORT_JOB: "fathom_history_import", runFathomHistoryImport: run }));

import { handleFathomHistoryImport } from "./fathom-history-import";

const ctx = (payload: Record<string, unknown>) => ({ job: { id: "j", type: "fathom_history_import", payload }, supabase: fakeDb().client }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handleFathomHistoryImport", () => {
  it("corre la vuelta de esa conexion y esa corrida", async () => {
    run.mockResolvedValue("continued");
    await handleFathomHistoryImport(ctx({ connectionId: "c1", runId: "r1", step: 2 }));
    expect(run).toHaveBeenCalledWith(expect.anything(), { connectionId: "c1", runId: "r1", step: 2 });
  });

  it("un job incompleto no corre ni lanza", async () => {
    await handleFathomHistoryImport(ctx({ connectionId: "c1" }));
    expect(run).not.toHaveBeenCalled();
  });

  it("un error de la base guardando el avance lanza: lo reintenta la cola", async () => {
    run.mockRejectedValue(new Error("no pude guardar"));
    await expect(handleFathomHistoryImport(ctx({ connectionId: "c1", runId: "r1", step: 0 }))).rejects.toThrow();
  });
});
