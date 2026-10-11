import { describe, it, expect, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { runContractPdf, pdfJobKey } from "./pdf-run";
import { newField } from "@/lib/forms/fields";
import type { ContractPdfInput } from "./pdf";

const SIG = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);
const NOW = new Date("2026-10-11T12:00:00Z");

const signature = (over: Record<string, unknown> = {}) => ({
  id: SIG,
  workspace_id: "ws1",
  submission_id: "sub1",
  form_id: "form1",
  form_version_id: "ver1",
  text_sha256: SHA,
  signer_name: "Ana Pérez",
  signer_email: "ana@x.com",
  signature_path: "ws1/form1/key/signature.png",
  signed_at: "2026-10-11T11:00:00Z",
  legal: { ip: "203.0.113.9", device: "mobile", os: "iOS", browser: "Safari", timezone: "America/Costa_Rica", locale: "es-CR", accepted_label: "Acepto" },
  pdf_path: null,
  pdf_status: "pending",
  pdf_attempts: 0,
  email_status: "pending",
  ...over,
});

function setup(over: { sig?: Record<string, unknown> | null; version?: Record<string, unknown> | null; upload?: boolean; download?: Uint8Array | null; build?: () => Promise<Uint8Array> } = {}) {
  const db = fakeDb({
    "contract_signatures:select": { data: over.sig === null ? null : signature(over.sig ?? {}) },
    "form_versions:select": {
      data: over.version === null ? null : { version_number: 2, definition: { fields: [newField("short_text", "nombre", "Nombre")] }, contract_text: "# Acuerdo\n\nTexto", contract_text_sha256: SHA, ...(over.version ?? {}) },
    },
    "forms:select": { data: { name: "Mi contrato", contract_config: { title: "Acuerdo de servicios" } } },
    "form_submissions:select": { data: { answers: { nombre: { label: "Nombre", type: "short_text", value: "Ana Pérez" } } } },
    "workspaces:select": { data: { timezone: "America/Costa_Rica" } },
    "contract_signatures:update": { data: null },
  });
  const uploads: Array<{ path: string; mime: string }> = [];
  const storage = {
    download: vi.fn(async () => (over.download === undefined ? new Uint8Array([1, 2, 3]) : over.download)),
    upload: vi.fn(async (path: string, _bytes: Uint8Array, mime: string) => {
      uploads.push({ path, mime });
      return over.upload ?? true;
    }),
  };
  const scheduled: Array<{ type: string; payload: Record<string, unknown>; runAt: Date; key: string }> = [];
  const build = vi.fn<(input: ContractPdfInput) => Promise<Uint8Array>>(over.build ? (async () => over.build!()) : async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  const deps = {
    db: db.client,
    storage,
    now: () => NOW,
    build,
    businessName: () => "Mi Negocio",
    schedule: async (type: string, payload: Record<string, unknown>, runAt: Date, key: string) => {
      scheduled.push({ type, payload, runAt, key });
    },
  };
  return { db, deps, uploads, scheduled, build, storage };
}

describe("runContractPdf", () => {
  it("genera el PDF de la versión de la FIRMA, lo sube con su ruta y encola el email", async () => {
    const { db, deps, uploads, scheduled, build } = setup();
    expect(await runContractPdf(deps, SIG)).toBe("generated");
    expect(uploads).toEqual([{ path: `ws1/form1/${SIG}/contrato-v2.pdf`, mime: "application/pdf" }]);
    expect(db.writesTo("contract_signatures")[0].values).toEqual({ pdf_path: `ws1/form1/${SIG}/contrato-v2.pdf`, pdf_status: "generated" });
    expect(scheduled).toEqual([{ type: "contract_email", payload: { signatureId: SIG, attempt: 0 }, runAt: NOW, key: `contract_email:${SIG}:0` }]);
    // El PDF lleva lo de la firma, no lo vigente.
    expect(build.mock.calls[0][0]).toMatchObject({ businessName: "Mi Negocio", title: "Acuerdo de servicios", versionNumber: 2, sha256: SHA, signer: { name: "Ana Pérez", email: "ana@x.com" }, timeZone: "America/Costa_Rica", legal: { ip: "203.0.113.9", device: "mobile", acceptedLabel: "Acepto" } });
    expect(build.mock.calls[0][0].answers).toEqual([{ label: "Nombre", value: "Ana Pérez" }]);
    expect(build.mock.calls[0][0].signaturePng).toBeInstanceOf(Uint8Array);
  });

  it("un PDF ya generado no se vuelve a generar (salvo force)", async () => {
    const first = setup({ sig: { pdf_status: "generated", pdf_path: "x.pdf" } });
    expect(await runContractPdf(first.deps, SIG)).toBe("already");
    expect(first.build).not.toHaveBeenCalled();
    const forced = setup({ sig: { pdf_status: "generated", pdf_path: "x.pdf" } });
    expect(await runContractPdf(forced.deps, SIG, { force: true })).toBe("generated");
  });

  it("si la subida falla: queda failed con pdf_attempts = 1 y un job de reintento a +5 min (sin lanzar)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, deps, scheduled } = setup({ upload: false });
    expect(await runContractPdf(deps, SIG)).toBe("retry_scheduled");
    expect(db.writesTo("contract_signatures")[0].values).toEqual({ pdf_status: "failed", pdf_attempts: 1 });
    expect(scheduled).toEqual([{ type: "contract_pdf", payload: { signatureId: SIG }, runAt: new Date("2026-10-11T12:05:00Z"), key: pdfJobKey(SIG, "retry:1") }]);
    expect(scheduled.some((s) => s.type === "contract_email")).toBe(false);
    errors.mockRestore();
  });

  it("el segundo y el tercer fallo agendan +15 y +30; el cuarto queda failed sin otro reintento", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const results: Array<[string, number | null]> = [];
    for (const attempts of [1, 2, 3]) {
      const { deps, scheduled } = setup({ upload: false, sig: { pdf_attempts: attempts, pdf_status: "failed" } });
      const result = await runContractPdf(deps, SIG);
      results.push([result, scheduled[0] ? (scheduled[0].runAt.getTime() - NOW.getTime()) / 60_000 : null]);
    }
    expect(results).toEqual([["retry_scheduled", 15], ["retry_scheduled", 30], ["failed", null]]);
    errors.mockRestore();
  });

  it("si la generación lanza, tampoco lanza el job y la firma queda guardada", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, deps } = setup({ build: async () => { throw new Error("pdf-lib se rompió"); } });
    expect(await runContractPdf(deps, SIG)).toBe("retry_scheduled");
    expect(db.writesTo("contract_signatures")[0].values).toMatchObject({ pdf_status: "failed", pdf_attempts: 1 });
    // El log no lleva el email ni el nombre del firmante.
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/ana@x\.com|Ana Pérez/);
    errors.mockRestore();
  });

  it("si la huella guardada ya no coincide con la versión, no genera nada con ese texto", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, build } = setup({ version: { contract_text_sha256: "b".repeat(64) } });
    expect(await runContractPdf(deps, SIG)).not.toBe("generated");
    expect(build).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("una firma que no existe no hace nada ni lanza", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, build } = setup({ sig: null });
    expect(await runContractPdf(deps, SIG)).toBe("missing");
    expect(build).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("sin imagen de firma (era opcional) genera igual", async () => {
    const { deps, build, storage } = setup({ sig: { signature_path: null } });
    expect(await runContractPdf(deps, SIG)).toBe("generated");
    expect(storage.download).not.toHaveBeenCalled();
    expect(build.mock.calls[0][0].signaturePng).toBeNull();
  });

  it("si no se puede leer la imagen de la firma, falla con reintento (no genera un PDF sin ella)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, build } = setup({ download: null });
    expect(await runContractPdf(deps, SIG)).toBe("retry_scheduled");
    expect(build).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("si el email ya salió, regenerar el PDF no encola otro email", async () => {
    const { deps, scheduled } = setup({ sig: { email_status: "sent", pdf_status: "failed" } });
    expect(await runContractPdf(deps, SIG)).toBe("generated");
    expect(scheduled).toEqual([]);
  });
});
