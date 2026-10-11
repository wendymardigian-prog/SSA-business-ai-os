import { describe, it, expect, vi, beforeEach } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/forms/contract/pdf-run", () => ({ runContractPdf: run }));

import { handleContractPdf, registerContractPdfHandler, CONTRACT_PDF_JOB } from "./contract-pdf";
import { getJobHandler, resetJobHandlers } from "@/lib/jobs/registry";

const ctx = (payload: unknown) => ({ supabase: { marker: "db" } as never, job: { id: "j1", type: "contract_pdf", payload, attempts: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("handler contract_pdf", () => {
  it("genera el PDF de la firma del payload con el cliente de servicio del job", async () => {
    run.mockResolvedValue("generated");
    await handleContractPdf(ctx({ signatureId: "sig-1" }));
    expect(run).toHaveBeenCalledWith({ db: { marker: "db" } }, "sig-1");
  });

  it("un job sin firma no hace nada y no lanza", async () => {
    await expect(handleContractPdf(ctx({}))).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("no lanza aunque la generación haya fallado (la cola reintentaría a los 10 s)", async () => {
    run.mockResolvedValue("retry_scheduled");
    await expect(handleContractPdf(ctx({ signatureId: "sig-1" }))).resolves.toBeUndefined();
  });

  it("queda registrado con su tipo", () => {
    resetJobHandlers();
    registerContractPdfHandler();
    expect(CONTRACT_PDF_JOB).toBe("contract_pdf");
    expect(getJobHandler("contract_pdf")).toBe(handleContractPdf);
  });
});
