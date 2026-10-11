import { describe, it, expect, vi, beforeEach } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/forms/contract/email-run", () => ({ runContractEmail: run }));

import { handleContractEmail, registerContractEmailHandler, CONTRACT_EMAIL_JOB } from "./contract-email";
import { getJobHandler, resetJobHandlers } from "@/lib/jobs/registry";

const ctx = (payload: unknown) => ({ supabase: { marker: "db" } as never, job: { id: "j1", type: "contract_email", payload, attempts: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("handler contract_email", () => {
  it("manda la copia con el intento y la marca de reenvío del payload", async () => {
    run.mockResolvedValue("sent");
    await handleContractEmail(ctx({ signatureId: "sig-1", attempt: 2, manual: true }));
    expect(run).toHaveBeenCalledWith({ db: { marker: "db" } }, { signatureId: "sig-1", attempt: 2, manual: true });
  });

  it("un job sin firma no hace nada y no lanza", async () => {
    await expect(handleContractEmail(ctx({ attempt: 1 }))).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("no lanza aunque el proveedor haya fallado", async () => {
    run.mockResolvedValue("retry_scheduled");
    await expect(handleContractEmail(ctx({ signatureId: "sig-1" }))).resolves.toBeUndefined();
  });

  it("queda registrado con su tipo", () => {
    resetJobHandlers();
    registerContractEmailHandler();
    expect(CONTRACT_EMAIL_JOB).toBe("contract_email");
    expect(getJobHandler("contract_email")).toBe(handleContractEmail);
  });
});
