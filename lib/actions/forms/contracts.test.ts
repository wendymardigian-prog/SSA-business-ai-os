import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), schedule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/scheduler", () => ({ scheduleJob: mocks.schedule }));

import { getContractPdfUrl, regenerateContractPdf, resendContractCopy } from "./contracts";

const SUB = "22222222-2222-4222-8222-222222222222";
const SIG = "33333333-3333-4333-8333-333333333333";

function setup(over: { signature?: Record<string, unknown> | null; signedUrl?: string | null } = {}) {
  const user = fakeDb({
    "contract_signatures:select": { data: over.signature === null ? null : { id: SIG, form_id: "form1", pdf_path: "ws1/form1/sig/contrato-v1.pdf", pdf_status: "generated", email_status: "sent", ...(over.signature ?? {}) } },
  });
  const createSignedUrl = vi.fn(async () => ({ data: over.signedUrl === null ? null : { signedUrl: over.signedUrl ?? "https://storage/firmado" }, error: over.signedUrl === null ? { message: "x" } : null }));
  const service = fakeDb({ "contract_signatures:update": { data: null } });
  (service.client as { storage: unknown }).storage = { from: vi.fn(() => ({ createSignedUrl })) };
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client });
  mocks.service.mockResolvedValue(service.client);
  return { user, service, createSignedUrl };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.schedule.mockResolvedValue({ id: "job1" });
});

describe("getContractPdfUrl", () => {
  it("devuelve un link firmado de 60 segundos para quien ve la respuesta", async () => {
    const { createSignedUrl } = setup();
    expect(await getContractPdfUrl({ submissionId: SUB })).toEqual({ ok: true, url: "https://storage/firmado" });
    expect(createSignedUrl).toHaveBeenCalledWith("ws1/form1/sig/contrato-v1.pdf", 60);
  });

  it("quien no ve la respuesta (la RLS no devuelve la firma) NO obtiene el link", async () => {
    const { createSignedUrl } = setup({ signature: null });
    expect(await getContractPdfUrl({ submissionId: SUB })).toEqual({ ok: false, error: expect.stringMatching(/No encontré/) });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("sin permiso, sin link", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await getContractPdfUrl({ submissionId: SUB })).ok).toBe(false);
  });

  it("con el PDF todavía sin generar no hay link", async () => {
    setup({ signature: { pdf_status: "pending", pdf_path: null } });
    expect((await getContractPdfUrl({ submissionId: SUB })).ok).toBe(false);
  });
});

describe("resendContractCopy", () => {
  it("vuelve a 'retrying' con intentos en 0, encola un job con clave propia y deja el historial", async () => {
    const { service } = setup();
    expect(await resendContractCopy({ submissionId: SUB, now: 1_700_000_000_000 })).toEqual({ ok: true });
    expect(service.writesTo("contract_signatures")[0].values).toEqual({ email_status: "retrying", email_attempts: 0, email_next_retry_at: null, email_last_error: null });
    expect(mocks.schedule).toHaveBeenCalledWith(expect.anything(), "contract_email", { signatureId: SIG, attempt: 0, manual: true }, expect.any(Date), `contract_email:${SIG}:manual:1700000000000`);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "form_submission", entityId: SUB, action: "contract.email_resent" }));
  });

  it("tocar dos veces en el mismo instante usa la misma clave (la cola no duplica)", async () => {
    setup();
    await resendContractCopy({ submissionId: SUB, now: 5 });
    await resendContractCopy({ submissionId: SUB, now: 5 });
    expect(mocks.schedule.mock.calls[0][4]).toBe(mocks.schedule.mock.calls[1][4]);
  });

  it("una clave repetida (23505) no es un error", async () => {
    setup();
    mocks.schedule.mockRejectedValue({ code: "23505" });
    expect((await resendContractCopy({ submissionId: SUB })).ok).toBe(true);
  });

  it("sin PDF no reenvía", async () => {
    const { service } = setup({ signature: { pdf_status: "failed" } });
    expect((await resendContractCopy({ submissionId: SUB })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("sin forms.manage no hace nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await resendContractCopy({ submissionId: SUB })).ok).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

describe("regenerateContractPdf", () => {
  it("solo si el PDF falló: vuelve a pending y encola contract_pdf", async () => {
    const { service } = setup({ signature: { pdf_status: "failed", pdf_path: null } });
    expect(await regenerateContractPdf({ submissionId: SUB, now: 9 })).toEqual({ ok: true });
    expect(service.writesTo("contract_signatures")[0].values).toEqual({ pdf_status: "pending", pdf_attempts: 0 });
    expect(mocks.schedule).toHaveBeenCalledWith(expect.anything(), "contract_pdf", { signatureId: SIG }, expect.any(Date), `contract_pdf:${SIG}:manual:9`);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "contract.pdf_regenerated" }));
  });

  it("con el PDF bien generado no se regenera", async () => {
    const { service } = setup();
    expect((await regenerateContractPdf({ submissionId: SUB })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
