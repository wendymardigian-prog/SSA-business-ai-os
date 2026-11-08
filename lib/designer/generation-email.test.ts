import { describe, expect, it, vi } from "vitest";
import {
  defaultGenerationEmail,
  emailProblems,
  GENERATION_EMAIL_KIND,
  handleDesignGenerated,
  interpolateGenerationEmail,
  MAX_EMAIL_BODY,
  parseEmailRequest,
  sendGenerationEmailCore,
  type GenerationEmailDeps,
} from "./generation-email";
import type { GeneratedDesign } from "./extensions";
import { LUCIA, TEMPLATE, TOMAS, USER, WS, generationDb, generationRow } from "./testing/generation-fixtures";

const LINKS = { link: "https://links.academia.test/d/K8F2-WQ4M-0001", pdfUrl: "https://links.academia.test/d/K8F2-WQ4M-0001/descargar?formato=pdf", zipUrl: "z" };

function deps() {
  return {
    send: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, id: "re_1" }) as Awaited<ReturnType<NonNullable<GenerationEmailDeps["send"]>>>),
    loadLinks: vi.fn(async (..._a: unknown[]) => LINKS),
    audit: vi.fn(async (..._a: unknown[]) => "a1" as string | null),
  };
}
const asDeps = (d: ReturnType<typeof deps>) => d as unknown as GenerationEmailDeps;

const ready = (over: Record<string, unknown> = {}) =>
  generationRow({ id: "d1", code: "K8F2-WQ4M-0001", values: { "contact.first_name": "Lucía", nombre_en_el_certificado: "Lucía Ferreyra de Salas" }, ...over });

describe("el texto del email", () => {
  it("pega los valores, usa el respaldo de {{x|respaldo}} y deja vacío lo que no hay", () => {
    const values = { "contact.first_name": "Lucía", "design.link": "https://x.test/d/A" };
    expect(interpolateGenerationEmail("Hola {{contact.first_name}}: {{design.link}}", values)).toBe("Hola Lucía: https://x.test/d/A");
    expect(interpolateGenerationEmail("Hola {{ contact.first_name | amigo }}", {})).toBe("Hola amigo");
    expect(interpolateGenerationEmail("Hola {{desconocida}}.", values)).toBe("Hola .");
  });

  it("«Hola, {{nombre|}}.» sin nombre queda «Hola.»", () => {
    expect(interpolateGenerationEmail("Hola, {{contact.first_name|}}.", {})).toBe("Hola.");
    expect(interpolateGenerationEmail("Hola, {{contact.first_name|}}.", { "contact.first_name": "Ana" })).toBe("Hola, Ana.");
  });

  it("el texto por defecto habla del tipo de documento y lleva el link", () => {
    expect(defaultGenerationEmail("Constancia")).toEqual({ subject: "Tu constancia", body: expect.stringContaining("{{design.link}}") });
    expect(defaultGenerationEmail(null).subject).toBe("Tu pieza");
  });

  it("lee lo pedido al emitir de source_ref y descarta lo raro", () => {
    expect(parseEmailRequest({ kind: "user", email_request: { subject: "S", body: "B" } })).toEqual({ subject: "S", body: "B" });
    expect(parseEmailRequest({ email_request: { subject: "", body: "B" } })).toBeNull();
    expect(parseEmailRequest({ email_request: "x" })).toBeNull();
    expect(parseEmailRequest(null)).toBeNull();
  });

  it("asunto y mensaje: obligatorios y con tope", () => {
    expect(emailProblems({ subject: " ", body: "x" })).toBe("Escribí el asunto del email.");
    expect(emailProblems({ subject: "x", body: "" })).toBe("Escribí el mensaje del email.");
    expect(emailProblems({ subject: "x".repeat(201), body: "x" })).toMatch(/asunto es demasiado largo/);
    expect(emailProblems({ subject: "x", body: "x".repeat(MAX_EMAIL_BODY + 1) })).toMatch(/mensaje es demasiado largo/);
    expect(emailProblems({ subject: "Tu certificado", body: "Acá" })).toBeNull();
  });
});

describe("sendGenerationEmailCore (F50, F54)", () => {
  it("manda por el email del negocio como transaccional, con el link del DOMINIO DEL NEGOCIO, y lo anota", async () => {
    const db = generationDb({ designs: [ready()] });
    const d = deps();
    const out = await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "Tu certificado, {{contact.first_name}}", body: "Hola {{contact.first_name}}\n\nAcá: {{design.link}}\nPDF: {{design.pdf_url}}\nCódigo {{design.code}}" }, asDeps(d));
    expect(out).toEqual({ ok: true, data: { to: "lucia@ejemplo.com" } });
    expect(d.loadLinks).toHaveBeenCalledWith(db.client, WS, "K8F2-WQ4M-0001");
    const sent = d.send.mock.calls[0][0] as { to: string; subject: string; html: string; category: string; kind: string; contactId: string; createdBy: string; workspaceId: string; relatedEntityId: string };
    expect(sent).toMatchObject({ workspaceId: WS, to: "lucia@ejemplo.com", subject: "Tu certificado, Lucía", category: "transactional", kind: GENERATION_EMAIL_KIND, contactId: LUCIA, createdBy: USER, relatedEntityId: "d1" });
    expect(sent.html).toContain(LINKS.link);
    expect(sent.html).toContain("K8F2-WQ4M-0001");
    expect(db.rows("designs")[0].email_status).toBe("sent");
    expect((d.audit.mock.calls[0][0] as { action: string }).action).toBe("design.email_sent");
  });

  it("el link NUNCA sale del navegador: ningún link se arma con otro dominio que el que devuelve loadDesignLinks", async () => {
    const db = generationDb({ designs: [ready()] });
    const d = deps();
    await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "{{design.link}} {{design.pdf_url}}" }, asDeps(d));
    const html = (d.send.mock.calls[0][0] as { html: string }).html;
    const urls = html.match(/https?:\/\/[^\s"'<)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith("https://links.academia.test/")).toBe(true);
  });

  it("sin texto propio usa lo que se pidió al emitir; y sin eso, el de siempre", async () => {
    const asked = ready({ source_ref: { kind: "user", user_id: USER, email_request: { subject: "Pedido al emitir", body: "Mirá {{design.link}}" } } });
    const d = deps();
    await sendGenerationEmailCore(generationDb({ designs: [asked] }).client, { workspaceId: WS, designId: "d1", userId: USER }, asDeps(d));
    expect((d.send.mock.calls[0][0] as { subject: string }).subject).toBe("Pedido al emitir");

    const plain = deps();
    await sendGenerationEmailCore(generationDb({ designs: [ready()] }).client, { workspaceId: WS, designId: "d1", userId: USER }, asDeps(plain));
    expect((plain.send.mock.calls[0][0] as { subject: string }).subject).toBe("Tu certificado");
  });

  it("un valor con HTML no inyecta nada: el cuerpo se escapa", async () => {
    const db = generationDb({ designs: [ready({ values: { "contact.first_name": "<img src=x onerror=alert(1)>" } })] });
    const d = deps();
    await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "Hola {{contact.first_name}}" }, asDeps(d));
    const html = (d.send.mock.calls[0][0] as { html: string }).html;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("un contacto sin email: no sale nada y queda «skipped» con un motivo claro", async () => {
    const db = generationDb({ designs: [ready({ subject_contact_id: TOMAS })] });
    const d = deps();
    const out = await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(d));
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("no tiene email") });
    expect(d.send).not.toHaveBeenCalled();
    expect(db.rows("designs")[0].email_status).toBe("skipped");
  });

  it("una pieza que no está lista (o anulada) no se manda", async () => {
    for (const status of ["queued", "rendering", "failed", "void"]) {
      const db = generationDb({ designs: [ready({ status, void_reason: status === "void" ? "x" : null })] });
      const d = deps();
      const out = await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(d));
      expect(out.ok).toBe(false);
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("una pieza de otro negocio no existe", async () => {
    const db = generationDb({ designs: [ready()] });
    const out = await sendGenerationEmailCore(db.client, { workspaceId: "otro-negocio", designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(deps()));
    expect(out).toEqual({ ok: false, error: "No encontramos esa pieza." });
  });

  it("si ya se mandó no se manda dos veces", async () => {
    const db = generationDb({ designs: [ready({ email_status: "sent" })] });
    const d = deps();
    const out = await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(d));
    expect(out).toEqual({ ok: false, error: "El email de esta pieza ya se mandó." });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("un email que falló antes se puede volver a mandar", async () => {
    const db = generationDb({ designs: [ready({ email_status: "failed" })] });
    const out = await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(deps()));
    expect(out.ok).toBe(true);
    expect(db.rows("designs")[0].email_status).toBe("sent");
  });

  it("cada falla del envío se anota y se explica en español", async () => {
    const cases: [Awaited<ReturnType<NonNullable<GenerationEmailDeps["send"]>>>, string, string][] = [
      [{ ok: false, reason: "not_configured", error: "Resend no esta conectado" }, "failed", "No hay un email conectado"],
      [{ ok: false, reason: "failed", error: "500" }, "failed", "No se pudo mandar el email"],
      [{ ok: false, reason: "skipped", skip: "bounced" as never, error: "rebota" }, "skipped", "no puede recibirlo"],
      [{ ok: false, reason: "deferred", defer: "daily_cap" as never, retryAt: new Date(), error: "tope" }, "failed", "más tarde"],
    ];
    for (const [result, status, message] of cases) {
      const db = generationDb({ designs: [ready()] });
      const d = deps();
      d.send.mockResolvedValue(result);
      const out = await sendGenerationEmailCore(db.client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(d));
      expect(out).toMatchObject({ ok: false, error: expect.stringContaining(message) });
      expect(db.rows("designs")[0].email_status).toBe(status);
    }
  });

  it("nunca lanza: si el envío explota, devuelve un error", async () => {
    const d = deps();
    d.send.mockRejectedValue(new Error("boom"));
    const out = await sendGenerationEmailCore(generationDb({ designs: [ready()] }).client, { workspaceId: WS, designId: "d1", userId: USER, subject: "x", body: "y" }, asDeps(d));
    expect(out.ok).toBe(false);
  });
});

describe("cuando la pieza queda lista (onDesignGenerated)", () => {
  const generated = (over: Partial<GeneratedDesign> = {}): GeneratedDesign => ({ designId: "d1", workspaceId: WS, templateId: TEMPLATE, code: "K8F2-WQ4M-0001", subjectContactId: LUCIA, subjectRef: null, ...over });
  const requested = { kind: "user", user_id: USER, email_request: { subject: "Tu certificado", body: "Acá: {{design.link}}" } };

  it("manda el email que se pidió al emitir, una vez, a nombre de quien emitió", async () => {
    const db = generationDb({ designs: [ready({ source_ref: requested })] });
    const d = deps();
    await handleDesignGenerated(db.client, generated(), asDeps(d));
    expect(d.send).toHaveBeenCalledTimes(1);
    expect((d.send.mock.calls[0][0] as { createdBy: string }).createdBy).toBe(USER);
    expect(db.rows("designs")[0].email_status).toBe("sent");
    // Si el aviso llega de nuevo (un reintento del render), no vuelve a salir.
    await handleDesignGenerated(db.client, generated(), asDeps(d));
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("si nadie pidió email, no manda nada (una automatización tiene su propio paso de email)", async () => {
    const db = generationDb({ designs: [ready()] });
    const d = deps();
    await handleDesignGenerated(db.client, generated(), asDeps(d));
    expect(d.send).not.toHaveBeenCalled();
    expect(db.rows("designs")[0].email_status).toBeNull();
  });

  it("nunca lanza", async () => {
    const db = generationDb({ designs: [ready({ source_ref: requested })] });
    const d = deps();
    d.loadLinks.mockRejectedValue(new Error("x"));
    await expect(handleDesignGenerated(db.client, generated(), asDeps(d))).resolves.toBeUndefined();
  });
});
