import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitForm, safeFileName, buildAttribution, type LoadedForm, type SubmitPorts, type SubmitInput, type SaveInput } from "./submit";
import { newField, type FormField } from "./fields";

const KEY = "3f0c1c2e-0000-4000-8000-000000000001";
const VERSION = "3f0c1c2e-0000-4000-8000-0000000000aa";

const field = (type: Parameters<typeof newField>[0], key: string, extra: Partial<FormField> = {}): FormField => ({
  ...newField(type, key, key),
  ...extra,
});

function makeForm(fields: FormField[], over: Partial<LoadedForm> = {}): LoadedForm {
  return {
    id: "form-1",
    workspaceId: "ws-1",
    name: "Aplicación",
    type: "custom",
    slug: "aplicacion",
    versionId: VERSION,
    versionNumber: 1,
    fields,
    success: { mode: "message", title: "Gracias {{answer.nombre}}", body: "Listo" },
    workspaceTimezone: "America/Costa_Rica",
    contactConfig: { mode: "create_or_link", update: "fill_empty", map: [] },
    customFields: [],
    notifyEnabled: true,
    notifyUserIds: [],
    ...over,
  };
}

const NO_CONTACT = { contactId: null, contactCreated: false, matchedBy: null, conflictContactId: null };

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]);

function makePorts(form: LoadedForm | null, over: Partial<SubmitPorts> = {}) {
  const saves: SaveInput[] = [];
  const uploads: string[] = [];
  const rejected: string[] = [];
  let n = 0;
  const ports: SubmitPorts = {
    limit: vi.fn(async (spec) => ({ allowed: true, count: 1, max: spec.max })),
    limitKeys: { submit: (ip) => `s:${ip}`, submitForm: (f, ip) => `sf:${f}:${ip}` },
    hashIp: () => "ip-hasheada",
    loadForm: vi.fn(async () => form),
    findSubmission: vi.fn(async () => null),
    turnstileSecret: vi.fn(async () => "secret"),
    verifyTurnstile: vi.fn(async () => ({ ok: true as const })),
    recordRejected: vi.fn(async ({ reason }) => {
      rejected.push(reason);
    }),
    upload: vi.fn(async (path) => {
      uploads.push(path);
      return true;
    }),
    save: vi.fn(async (input) => {
      saves.push(input);
      return { ok: true as const, duplicate: false, submissionId: "sub-1", status: "no_contact", ...NO_CONTACT };
    }),
    verifyLink: vi.fn(async () => null),
    recordTouch: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    newId: () => `id-${++n}`,
    ...over,
  };
  return { ports, saves, uploads, rejected };
}

const baseInput = (payload: Record<string, unknown>, files: SubmitInput["files"] = []): SubmitInput => ({
  slug: "aplicacion",
  ip: "203.0.113.9",
  userAgent: "UA/1.0",
  cookieHeader: null,
  payload: {
    idempotency_key: KEY,
    turnstile_token: "tok",
    version_id: VERSION,
    answers: {},
    ...payload,
  },
  files,
});

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => undefined));

describe("submitForm: el camino feliz", () => {
  it("guarda con etiqueta, devuelve el éxito y NO deja basura en los logs", async () => {
    const form = makeForm([field("short_text", "nombre", { label: "Tu nombre", required: true }), field("email", "email")]);
    const { ports, saves } = makePorts(form);
    const out = await submitForm(ports, baseInput({ answers: { nombre: " Ana ", email: "ANA@x.com" } }));

    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, submission_id: "sub-1", success: { title: "Gracias Ana" } });
    expect(saves).toHaveLength(1);
    expect(saves[0].answers).toEqual({
      nombre: { label: "Tu nombre", type: "short_text", value: "Ana" },
      email: { label: "email", type: "email", value: "ana@x.com" },
    });
    expect(saves[0].meta).toMatchObject({ ip_hash: "ip-hasheada", origin: "public_page", user_agent: "UA/1.0" });
    expect(JSON.stringify(saves[0].meta)).not.toContain("203.0.113.9");
    const logged = JSON.stringify((console.info as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain("ana@x.com");
    expect(logged).not.toContain("Ana");
  });
});

describe("submitForm: tope por IP y disponibilidad", () => {
  it("superado el tope por IP responde 429 y NO registra form_rejected", async () => {
    const { ports, rejected } = makePorts(makeForm([]), { limit: vi.fn(async (s) => ({ allowed: false, count: 99, max: s.max })) });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(429);
    expect(rejected).toEqual([]);
    expect(ports.loadForm).not.toHaveBeenCalled();
  });

  it("superado el tope por formulario también es 429 sin form_rejected", async () => {
    let call = 0;
    const { ports, rejected } = makePorts(makeForm([]), {
      limit: vi.fn(async (s) => ({ allowed: ++call === 1, count: 6, max: s.max })),
    });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(429);
    expect(rejected).toEqual([]);
  });

  it("un formulario no disponible es 404", async () => {
    const { ports } = makePorts(null);
    expect((await submitForm(ports, baseInput({}))).status).toBe(404);
  });

  it("un pedido con forma inválida es 400", async () => {
    const { ports } = makePorts(makeForm([]));
    const out = await submitForm(ports, { ...baseInput({}), payload: { idempotency_key: "no-uuid" } });
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("invalid_request");
  });
});

describe("submitForm: idempotencia", () => {
  it("si ya existe devuelve lo mismo sin verificar Turnstile ni guardar", async () => {
    const form = makeForm([field("short_text", "nombre")]);
    const { ports, saves } = makePorts(form, {
      findSubmission: vi.fn(async () => ({
        id: "sub-0",
        status: "no_contact" as const,
        answers: { nombre: { label: "nombre", type: "short_text", value: "Ana" } },
        attribution: {},
      })),
    });
    const out = await submitForm(ports, baseInput({ answers: { nombre: "Ana" } }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, duplicate: true, submission_id: "sub-0" });
    expect(ports.verifyTurnstile).not.toHaveBeenCalled();
    expect(saves).toHaveLength(0);
  });

  it("timeout-or-duplicate: si la otra pestaña ya guardó, devuelve esa respuesta", async () => {
    const form = makeForm([]);
    let looked = 0;
    const { ports, rejected } = makePorts(form, {
      findSubmission: vi.fn(async () => (++looked === 1 ? null : { id: "sub-9", status: "no_contact" as const, answers: {}, attribution: {} })),
      verifyTurnstile: vi.fn(async () => ({ ok: false as const, codes: ["timeout-or-duplicate"] })),
    });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ duplicate: true, submission_id: "sub-9" });
    expect(rejected).toEqual([]);
  });

  it("la RPC puede devolver duplicado (carrera real) y se responde 200 igual", async () => {
    const { ports } = makePorts(makeForm([]), {
      save: vi.fn(async () => ({ ok: true as const, duplicate: true, submissionId: "sub-7", status: "no_contact", ...NO_CONTACT })),
    });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ duplicate: true, submission_id: "sub-7" });
  });
});

describe("submitForm: honeypot y captcha", () => {
  it("honeypot lleno: 200 falso, no guarda y deja form_rejected", async () => {
    const { ports, saves, rejected } = makePorts(makeForm([]));
    const out = await submitForm(ports, baseInput({ honeypot: "http://spam" }));
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(saves).toHaveLength(0);
    expect(rejected).toEqual(["honeypot"]);
    expect(ports.verifyTurnstile).not.toHaveBeenCalled();
  });

  it("captcha rechazado: 400 captcha_failed, no guarda y deja form_rejected", async () => {
    const { ports, saves, rejected } = makePorts(makeForm([]), {
      verifyTurnstile: vi.fn(async () => ({ ok: false as const, codes: ["invalid-input-response"] })),
    });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("captcha_failed");
    expect(saves).toHaveLength(0);
    expect(rejected).toEqual(["captcha"]);
  });

  it("Cloudflare no responde: 503 y NO se guarda sin verificar", async () => {
    const { ports, saves, rejected } = makePorts(makeForm([]), {
      verifyTurnstile: vi.fn(async () => ({ ok: false as const, codes: ["network"] })),
    });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(503);
    expect(saves).toHaveLength(0);
    expect(rejected).toEqual([]);
  });

  it("sin secret key configurada: 503, no se acepta sin verificar", async () => {
    const { ports, saves } = makePorts(makeForm([]), { turnstileSecret: vi.fn(async () => null) });
    expect((await submitForm(ports, baseInput({}))).status).toBe(503);
    expect(saves).toHaveLength(0);
  });

  it("el token, la IP y la clave de idempotencia viajan a Turnstile", async () => {
    const { ports } = makePorts(makeForm([]));
    await submitForm(ports, baseInput({}));
    expect(ports.verifyTurnstile).toHaveBeenCalledWith({ secret: "secret", token: "tok", ip: "203.0.113.9", idempotencyKey: KEY });
  });
});

describe("submitForm: validación en el servidor (lo que el navegador no dejaría mandar)", () => {
  it("falta un obligatorio visible → 400 con el campo", async () => {
    const { ports, saves } = makePorts(makeForm([field("short_text", "nombre", { required: true })]));
    const out = await submitForm(ports, baseInput({ answers: {} }));
    expect(out.status).toBe(400);
    expect((out.body.fields as Record<string, string>).nombre).toBeDefined();
    expect(saves).toHaveLength(0);
  });

  it("un obligatorio oculto por condición no se exige y su valor colado no se guarda", async () => {
    const form = makeForm([
      field("single_select", "facturacion", { options: ["menos de 1k", "más de 10k"], required: true }),
      field("short_text", "presupuesto", {
        required: true,
        visibility: { rootConjunction: "and", conditions: [{ fieldKey: "facturacion", operator: "is", value: "más de 10k" }], groups: [] },
      }),
    ]);
    const { ports, saves } = makePorts(form);
    const out = await submitForm(ports, baseInput({ answers: { facturacion: "menos de 1k", presupuesto: "colado" } }));
    expect(out.status).toBe(200);
    expect(Object.keys(saves[0].answers)).toEqual(["facturacion"]);
  });

  it("una opción que no existe → 400", async () => {
    const { ports } = makePorts(makeForm([field("single_select", "plan", { options: ["A", "B"] })]));
    expect((await submitForm(ports, baseInput({ answers: { plan: "Z" } }))).status).toBe(400);
  });

  it("un NPS de 11 o de 7.5 → 400", async () => {
    const form = makeForm([field("nps", "nps", { required: true })]);
    for (const nps of [11, 7.5]) {
      const { ports } = makePorts(form);
      expect((await submitForm(ports, baseInput({ answers: { nps } }))).status, String(nps)).toBe(400);
    }
  });

  it("un oculto fixed lo pone el servidor y el valor del navegador se ignora", async () => {
    const form = makeForm([
      field("short_text", "nombre"),
      { ...field("hidden", "canal"), hidden: { source: "fixed", value: "octubre" } },
    ]);
    const { ports, saves } = makePorts(form);
    await submitForm(ports, baseInput({ answers: { nombre: "Ana", canal: "hackeado" } }));
    expect(saves[0].answers.canal.value).toBe("octubre");
  });

  it("un oculto de atribución toma el valor de la atribución del SERVIDOR, no el que mande el navegador", async () => {
    const form = makeForm([{ ...field("hidden", "campana"), hidden: { source: "attribution", param: "utm_campaign" } }]);
    const { ports, saves } = makePorts(form);
    await submitForm(ports, baseInput({ answers: { campana: "falsa" }, attribution: { utm_campaign: "octubre" } }));
    expect(saves[0].answers.campana.value).toBe("octubre");
    const noAttr = makePorts(form);
    await submitForm(noAttr.ports, baseInput({ answers: { campana: "falsa" } }));
    expect(noAttr.saves[0].answers.campana).toBeUndefined();
  });

  it("republicado durante el llenado: si sigue siendo válido se guarda con la vigente", async () => {
    const { ports, saves } = makePorts(makeForm([field("short_text", "nombre")]));
    const out = await submitForm(ports, baseInput({ version_id: "3f0c1c2e-0000-4000-8000-0000000000bb", answers: { nombre: "Ana" } }));
    expect(out.status).toBe(200);
    expect(saves[0].form.versionId).toBe(VERSION);
  });

  it("republicado y ya no es válido → 409 form_changed", async () => {
    const { ports } = makePorts(makeForm([field("short_text", "nombre", { required: true })]));
    const out = await submitForm(ports, baseInput({ version_id: "3f0c1c2e-0000-4000-8000-0000000000bb", answers: {} }));
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("form_changed");
  });

  it("la respuesta guarda la etiqueta de la versión con la que se guardó", async () => {
    const { ports, saves } = makePorts(makeForm([field("short_text", "nombre", { label: "Nombre (nuevo)" })]));
    await submitForm(ports, baseInput({ answers: { nombre: "Ana" } }));
    expect(saves[0].answers.nombre.label).toBe("Nombre (nuevo)");
  });
});

describe("submitForm: archivos", () => {
  const form = () => makeForm([{ ...field("file", "cv"), file: { accept: ["application/pdf"], maxMb: 1, maxFiles: 1 } }]);
  const file = (bytes: Uint8Array, name = "cv.pdf", declaredType = "application/pdf") => ({ fieldKey: "cv", name, declaredType, bytes });

  it("un PDF real se sube a la carpeta de la clave de idempotencia y queda en la respuesta", async () => {
    const { ports, saves, uploads } = makePorts(form());
    const out = await submitForm(ports, baseInput({ answers: {} }, [file(PDF)]));
    expect(out.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(new RegExp(`^ws-1/form-1/${KEY}/cv/id-\\d+\\.pdf$`));
    expect(saves[0].uploadPrefix).toBe(`ws-1/form-1/${KEY}`);
    expect(saves[0].answers.cv.value).toEqual([expect.objectContaining({ name: "cv.pdf", mime: "application/pdf" })]);
  });

  it("un .exe renombrado a .pdf se rechaza por su tipo real y no sube nada", async () => {
    const { ports, uploads, saves } = makePorts(form());
    const out = await submitForm(ports, baseInput({ answers: {} }, [file(EXE, "cv.pdf", "application/pdf")]));
    expect(out.status).toBe(400);
    expect((out.body.fields as Record<string, string>).cv).toMatch(/tipo/);
    expect(uploads).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  it("un archivo de más de lo permitido se rechaza por tamaño", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PDF);
    const { ports, uploads } = makePorts(form());
    const out = await submitForm(ports, baseInput({ answers: {} }, [file(big)]));
    expect(out.status).toBe(400);
    expect(uploads).toHaveLength(0);
  });

  it("más archivos que maxFiles se rechaza", async () => {
    const { ports } = makePorts(form());
    const out = await submitForm(ports, baseInput({ answers: {} }, [file(PDF), file(PDF, "otro.pdf")]));
    expect(out.status).toBe(400);
  });

  it("un archivo obligatorio sin archivos falla", async () => {
    const f = makeForm([{ ...field("file", "cv", { required: true }), file: { accept: ["application/pdf"], maxMb: 1, maxFiles: 1 } }]);
    const { ports } = makePorts(f);
    expect((await submitForm(ports, baseInput({ answers: {} }))).status).toBe(400);
  });

  it("si falla la subida responde 500 y no guarda", async () => {
    const { ports, saves } = makePorts(form(), { upload: vi.fn(async () => false) });
    const out = await submitForm(ports, baseInput({ answers: {} }, [file(PDF)]));
    expect(out.status).toBe(500);
    expect(saves).toHaveLength(0);
  });
});

describe("submitForm: errores al guardar", () => {
  it("already_answered → 409", async () => {
    const { ports } = makePorts(makeForm([]), { save: vi.fn(async () => ({ ok: false as const, error: "already_answered" as const })) });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("already_answered");
  });

  it("un fallo de la base es 500 sin detalles", async () => {
    const { ports } = makePorts(makeForm([]), { save: vi.fn(async () => ({ ok: false as const, error: "failed" as const })) });
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toMatch(/rpc|postgres|sql/i);
  });
});

describe("buildAttribution y safeFileName", () => {
  it("vuelve a sanear lo que manda el navegador y suma las cookies del mismo dominio", () => {
    const payload = { attribution: { utm_source: "meta", password: "x" } } as never;
    const out = buildAttribution(payload, "_fbp=fb.1.2.3; otra=1");
    expect(out).toEqual({ utm_source: "meta", fbp: "fb.1.2.3" });
  });

  it("la cookie no pisa lo que ya mandó el navegador", () => {
    const payload = { attribution: { fbp: "del-cliente" } } as never;
    expect(buildAttribution(payload, "_fbp=de-la-cookie").fbp).toBe("del-cliente");
  });

  it("safeFileName quita rutas y caracteres de control", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\ana\\cv.pdf")).toBe("cv.pdf");
    expect(safeFileName("a\u0000b.pdf")).toBe("ab.pdf");
    expect(safeFileName("")).toBe("archivo");
  });
});

describe("submitForm: contacto, toque y aviso (FO2)", () => {
  const mapped = () =>
    makeForm([field("short_text", "nombre"), field("email", "email"), field("phone", "tel")], {
      contactConfig: {
        mode: "create_or_link",
        update: "fill_empty",
        map: [
          { fieldKey: "nombre", target: "contact.display_name" },
          { fieldKey: "email", target: "contact.email" },
        ],
      },
    });

  const withContact = (over: Partial<{ contactId: string | null; contactCreated: boolean; duplicate: boolean; status: string }> = {}) =>
    vi.fn(async (input: SaveInput) => {
      void input;
      return {
        ok: true as const,
        duplicate: over.duplicate ?? false,
        submissionId: "sub-1",
        status: over.status ?? "received",
        contactId: over.contactId === undefined ? "contact-1" : over.contactId,
        contactCreated: over.contactCreated ?? true,
        matchedBy: null,
        conflictContactId: null,
      };
    });

  it("le pasa a la base el contacto armado con el mapeo, sin ids firmados", async () => {
    const { ports } = makePorts(mapped(), { save: withContact() });
    await submitForm(ports, baseInput({ answers: { nombre: "Ana Pérez", email: "ANA@x.com" } }));
    const sent = (ports.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as SaveInput;
    expect(sent.contactHint).toEqual({ display_name: "Ana Pérez", email: "ana@x.com", custom: {} });
    expect(ports.verifyLink).not.toHaveBeenCalled();
  });

  it("con un link firmado válido manda los ids; con uno inválido los ignora", async () => {
    const valid = makePorts(mapped(), {
      save: withContact(),
      verifyLink: vi.fn(async () => ({ contactId: "c-9", serviceId: "s-1", saleId: null })),
    });
    await submitForm(valid.ports, baseInput({ answers: { nombre: "Ana" }, link_token: "tok.firma" }));
    const sent = (valid.ports.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as SaveInput;
    expect(sent.contactHint).toMatchObject({ signed_contact_id: "c-9", signed_service_id: "s-1" });
    expect(sent.contactHint).not.toHaveProperty("signed_sale_id");

    const invalid = makePorts(mapped(), { save: withContact() });
    await submitForm(invalid.ports, baseInput({ answers: { nombre: "Ana" }, link_token: "falso" }));
    const sent2 = (invalid.ports.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as SaveInput;
    expect(sent2.contactHint).not.toHaveProperty("signed_contact_id");
  });

  it("con contacto: anota el toque y avisa", async () => {
    const { ports } = makePorts(mapped(), { save: withContact() });
    const out = await submitForm(ports, baseInput({ answers: { email: "a@x.com" }, attribution: { utm_source: "meta" } }));
    expect(out.status).toBe(200);
    expect(ports.recordTouch).toHaveBeenCalledWith(expect.objectContaining({ submissionId: "sub-1", contactId: "contact-1", attribution: { utm_source: "meta" } }));
    expect(ports.notify).toHaveBeenCalledWith(expect.objectContaining({ submissionId: "sub-1", contactId: "contact-1", contactCreated: true }));
  });

  it("sin contacto: no anota toque, pero igual avisa", async () => {
    const { ports } = makePorts(mapped(), { save: withContact({ contactId: null, contactCreated: false, status: "no_contact" }) });
    await submitForm(ports, baseInput({}));
    expect(ports.recordTouch).not.toHaveBeenCalled();
    expect(ports.notify).toHaveBeenCalledWith(expect.objectContaining({ contactId: null }));
  });

  it("un envío repetido (duplicado) no vuelve a anotar toque ni a avisar", async () => {
    const { ports } = makePorts(mapped(), { save: withContact({ duplicate: true }) });
    await submitForm(ports, baseInput({}));
    expect(ports.recordTouch).not.toHaveBeenCalled();
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("una respuesta marcada como spam no avisa", async () => {
    const { ports } = makePorts(mapped(), { save: withContact({ status: "spam" }) });
    await submitForm(ports, baseInput({}));
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("si el toque o el aviso fallan, el envío sigue siendo un éxito y el log no lleva datos", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ports } = makePorts(mapped(), {
      save: withContact(),
      recordTouch: vi.fn(async () => {
        throw new Error("ana@x.com se cayó");
      }),
      notify: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const out = await submitForm(ports, baseInput({ answers: { email: "ana@x.com" } }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, submission_id: "sub-1" });
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/ana@x\.com/);
    errors.mockRestore();
  });
});
