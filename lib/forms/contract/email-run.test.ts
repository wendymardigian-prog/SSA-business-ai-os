import { describe, it, expect, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { runContractEmail, statusFromError, safeReason } from "./email-run";

const SIG = "11111111-1111-4111-8111-111111111111";
const SHA = "c".repeat(64);
const NOW = new Date("2026-10-11T12:00:00Z");

const signature = (over: Record<string, unknown> = {}) => ({
  id: SIG,
  workspace_id: "ws1",
  form_id: "form1",
  form_version_id: "ver1",
  text_sha256: SHA,
  signer_name: "Ana Pérez",
  signer_email: "ana@x.com",
  contact_id: "contact1",
  signed_at: "2026-10-11T11:00:00Z",
  pdf_path: "ws1/form1/sig/contrato-v1.pdf",
  pdf_status: "generated",
  email_status: "pending",
  email_attempts: 0,
  ...over,
});

function setup(over: { sig?: Record<string, unknown> | null; ccEmails?: string[]; sendResults?: Array<{ ok: boolean; reason?: string; error?: string }>; pdf?: Uint8Array | null } = {}) {
  const db = fakeDb({
    "contract_signatures:select": { data: over.sig === null ? null : signature(over.sig ?? {}) },
    "forms:select": { data: { name: "Mi contrato", contract_config: { title: "Acuerdo", signatureRequired: true, acceptLabel: "Acepto", ccEmails: over.ccEmails ?? [] } } },
    "form_versions:select": { data: { version_number: 1 } },
    "contract_signatures:update": { data: null },
  });
  const results = [...(over.sendResults ?? [{ ok: true }])];
  const sent: Array<Record<string, unknown>> = [];
  const send = vi.fn(async (params: Record<string, unknown>) => {
    sent.push(params);
    const next = results.length > 1 ? results.shift()! : results[0];
    return next as never;
  });
  const scheduled: Array<{ type: string; payload: Record<string, unknown>; runAt: Date; key: string }> = [];
  const deps = {
    db: db.client,
    storage: { download: vi.fn(async () => (over.pdf === undefined ? new Uint8Array([0x25, 0x50, 0x44, 0x46]) : over.pdf)), upload: vi.fn(async () => true) },
    now: () => NOW,
    send: send as never,
    schedule: async (type: string, payload: Record<string, unknown>, runAt: Date, key: string) => {
      scheduled.push({ type, payload, runAt, key });
    },
  };
  return { db, deps, sent, scheduled, send };
}

const lastUpdate = (db: ReturnType<typeof setup>["db"]) => db.writesTo("contract_signatures").at(-1)!.values as Record<string, unknown>;

describe("runContractEmail", () => {
  it("manda el PDF adjunto al firmante, lo marca enviado y registra el contacto", async () => {
    const { db, deps, sent } = setup();
    expect(await runContractEmail(deps, { signatureId: SIG })).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ workspaceId: "ws1", to: "ana@x.com", subject: "Tu copia firmada: Acuerdo", kind: "contract_copy", relatedEntityType: "contract_signature", relatedEntityId: SIG, contactId: "contact1" });
    const attachments = sent[0].attachments as Array<{ filename: string; content: string }>;
    expect(attachments[0].filename).toBe("contrato-acuerdo-v1.pdf");
    expect(Buffer.from(attachments[0].content, "base64").toString()).toBe("%PDF");
    expect(String(sent[0].html)).toContain(SHA.slice(0, 16));
    expect(lastUpdate(db)).toMatchObject({ email_status: "sent", email_sent_at: NOW.toISOString(), email_last_error: null });
  });

  it("las direcciones de copia reciben un envío aparte cada una", async () => {
    const { deps, sent } = setup({ ccEmails: ["a@x.com", "b@x.com"] });
    await runContractEmail(deps, { signatureId: SIG });
    expect(sent.map((s) => s.to)).toEqual(["ana@x.com", "a@x.com", "b@x.com"]);
  });

  it("tres fallos transitorios seguidos agendan +5, +15 y +30; el cuarto queda not_sent sin un quinto job", async () => {
    const fail = { ok: false, reason: "failed", error: "Resend respondio 503: unavailable" };
    const seen: Array<{ result: string; delay: number | null; status: unknown }> = [];
    for (const attempt of [0, 1, 2, 3]) {
      const { db, deps, scheduled } = setup({ sendResults: [fail], sig: { email_status: attempt ? "retrying" : "pending", email_attempts: attempt } });
      const result = await runContractEmail(deps, { signatureId: SIG, attempt });
      seen.push({ result, delay: scheduled[0] ? (scheduled[0].runAt.getTime() - NOW.getTime()) / 60_000 : null, status: lastUpdate(db).email_status });
    }
    expect(seen).toEqual([
      { result: "retry_scheduled", delay: 5, status: "retrying" },
      { result: "retry_scheduled", delay: 15, status: "retrying" },
      { result: "retry_scheduled", delay: 30, status: "retrying" },
      { result: "not_sent", delay: null, status: "not_sent" },
    ]);
  });

  it("el job de reintento lleva la clave del intento (no pisa a otro)", async () => {
    const { deps, scheduled } = setup({ sendResults: [{ ok: false, reason: "failed", error: "Resend respondio 429: slow down" }] });
    await runContractEmail(deps, { signatureId: SIG, attempt: 1 });
    expect(scheduled[0]).toMatchObject({ type: "contract_email", payload: { signatureId: SIG, attempt: 2 }, key: `contract_email:${SIG}:2` });
  });

  it("un fallo permanente queda not_sent sin reintentos y sin direcciones en el motivo", async () => {
    const { db, deps, scheduled } = setup({ sendResults: [{ ok: false, reason: "failed", error: "Resend respondio 422: The ana@x.com address is not valid" }] });
    expect(await runContractEmail(deps, { signatureId: SIG })).toBe("not_sent");
    expect(scheduled).toEqual([]);
    expect(lastUpdate(db)).toMatchObject({ email_status: "not_sent" });
    expect(String(lastUpdate(db).email_last_error)).not.toContain("ana@x.com");
    expect(String(lastUpdate(db).email_last_error)).toContain("[email]");
  });

  it("Resend sin conectar: not_sent directo, con el motivo", async () => {
    const { db, deps, scheduled } = setup({ sendResults: [{ ok: false, reason: "not_configured", error: "Resend no esta conectado" }] });
    expect(await runContractEmail(deps, { signatureId: SIG })).toBe("not_sent");
    expect(scheduled).toEqual([]);
    expect(lastUpdate(db)).toMatchObject({ email_status: "not_sent", email_last_error: "Resend no está conectado" });
  });

  it("un reintento viejo no vuelve a mandar lo que ya salió, pero un reenvío manual sí", async () => {
    const old = setup({ sig: { email_status: "sent" } });
    expect(await runContractEmail(old.deps, { signatureId: SIG, attempt: 1 })).toBe("already");
    expect(old.send).not.toHaveBeenCalled();
    const manual = setup({ sig: { email_status: "sent" } });
    expect(await runContractEmail(manual.deps, { signatureId: SIG, manual: true })).toBe("sent");
    expect(manual.send).toHaveBeenCalledTimes(1);
  });

  it("sin PDF todavía no manda nada: queda not_sent con el motivo", async () => {
    const { db, deps, send } = setup({ sig: { pdf_status: "failed", pdf_path: null } });
    expect(await runContractEmail(deps, { signatureId: SIG })).toBe("no_pdf");
    expect(send).not.toHaveBeenCalled();
    expect(lastUpdate(db)).toMatchObject({ email_status: "not_sent" });
  });

  it("si no puede leer el PDF del bucket, queda not_sent", async () => {
    const { deps, send } = setup({ pdf: null });
    expect(await runContractEmail(deps, { signatureId: SIG })).toBe("not_sent");
    expect(send).not.toHaveBeenCalled();
  });

  it("una firma que no existe no hace nada", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, send } = setup({ sig: null });
    expect(await runContractEmail(deps, { signatureId: SIG })).toBe("missing");
    expect(send).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("helpers", () => {
  it("statusFromError lee el estado HTTP o da 0", () => {
    expect(statusFromError("Resend respondio 429: x")).toBe(429);
    expect(statusFromError("No se pudo contactar a Resend: fetch failed")).toBe(0);
  });
  it("safeReason quita direcciones de email y recorta", () => {
    expect(safeReason("falló para a.b+c@x.co.uk ahora")).toBe("falló para [email] ahora");
    expect(safeReason("x".repeat(500))).toHaveLength(300);
  });
});
