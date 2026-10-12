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
    contract: null,
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
    uploadContractFile: vi.fn(async () => true),
    discardContractFile: vi.fn(async () => undefined),
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
  it("si ya existe devuelve lo mismo sin guardar de nuevo", async () => {
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
    expect(saves).toHaveLength(0);
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

describe("submitForm: el tope por IP (R2)", () => {
  it("30 envíos desde la misma IP en una hora se guardan; el 31 recibe 429", async () => {
    // Un contador por clave, como `rate_limits`: suma uno y deja pasar mientras no se pase del máximo.
    const counts = new Map<string, number>();
    const limit = vi.fn(async (spec: { key: string; max: number }) => {
      const count = (counts.get(spec.key) ?? 0) + 1;
      counts.set(spec.key, count);
      return { allowed: count <= spec.max, count, max: spec.max };
    });
    const { ports, saves } = makePorts(makeForm([]), { limit });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const key = `3f0c1c2e-0000-4000-8000-${String(i).padStart(12, "0")}`;
      statuses.push((await submitForm(ports, baseInput({ idempotency_key: key }))).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(saves).toHaveLength(30);
  });
});

describe("submitForm: honeypot y envío sin captcha", () => {
  it("honeypot lleno: 200 falso, no guarda y deja form_rejected", async () => {
    const { ports, saves, rejected } = makePorts(makeForm([]));
    const out = await submitForm(ports, baseInput({ honeypot: "http://spam" }));
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(saves).toHaveLength(0);
    expect(rejected).toEqual(["honeypot"]);
  });

  it("un envío sin token de captcha se guarda (el captcha ya no existe)", async () => {
    const { ports, saves, rejected } = makePorts(makeForm([]));
    const out = await submitForm(ports, baseInput({}));
    expect(out.status).toBe(200);
    expect(saves).toHaveLength(1);
    expect(rejected).toEqual([]);
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

  it("con el interruptor de contactos apagado (none) no viaja nada: ni el mapeo ni un link firmado (R3)", async () => {
    const form = { ...mapped(), contactConfig: { ...mapped().contactConfig, mode: "none" as const } };
    const { ports } = makePorts(form, {
      save: withContact(),
      verifyLink: vi.fn(async () => ({ contactId: "c-9", serviceId: null, saleId: null })),
    });
    await submitForm(ports, baseInput({ answers: { nombre: "Ana Pérez", email: "ANA@x.com" }, link_token: "tok.firma" }));
    const sent = (ports.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as SaveInput;
    expect(sent.contactHint).toEqual({});
    expect(ports.verifyLink).not.toHaveBeenCalled();
  });

  it("un país que no se reconoce se anota en meta y la respuesta se guarda igual (R6)", async () => {
    const form = makeForm([field("short_text", "pais")], { contactConfig: { mode: "create_or_link", update: "fill_empty", map: [{ fieldKey: "pais", target: "contact.country" }] } });
    const { ports, saves } = makePorts(form);
    const out = await submitForm(ports, baseInput({ answers: { pais: "Narnia" } }));
    expect(out.status).toBe(200);
    expect(saves[0].meta.contact_notes).toEqual([{ reason: "country_unrecognized", text: "Narnia" }]);
    expect(saves[0].contactHint).not.toHaveProperty("country");
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

describe("submitForm: origen del sitio (FO4)", () => {
  it("meta.origin = 'site' y meta.site_path = la ruta, limpia de query y hash", async () => {
    const { ports, saves } = makePorts(makeForm([field("short_text", "nombre")]));
    await submitForm(ports, baseInput({ answers: { nombre: "Ana" }, origin: "site", site_path: "/servicios/?x=1#form" }));
    expect(saves[0].meta).toMatchObject({ origin: "site", site_path: "/servicios" });
  });

  it("fuera del sitio no se guarda site_path aunque lo manden; con una ruta inválida, tampoco", async () => {
    const a = makePorts(makeForm([field("short_text", "nombre")]));
    await submitForm(a.ports, baseInput({ answers: { nombre: "Ana" }, origin: "public_page", site_path: "/x" }));
    expect(a.saves[0].meta).not.toHaveProperty("site_path");
    const b = makePorts(makeForm([field("short_text", "nombre")]));
    await submitForm(b.ports, baseInput({ answers: { nombre: "Ana" }, origin: "site", site_path: "sin-barra" }));
    expect(b.saves[0].meta).toMatchObject({ origin: "site" });
    expect(b.saves[0].meta).not.toHaveProperty("site_path");
  });
});

describe("submitForm: contratos (FO3)", () => {
  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const goodSignature = `data:image/png;base64,${Buffer.from([...PNG_HEAD, 1, 2, 3, 4]).toString("base64")}`;
  const contractForm = (over: Partial<LoadedForm> = {}) =>
    makeForm([{ ...field("short_text", "nombre", { required: true, label: "Nombre del firmante" }) }, { ...field("email", "email", { required: true, label: "Email" }) }], {
      type: "contract",
      contract: { title: "Acuerdo", signatureRequired: true, acceptLabel: "Leí y acepto el contrato", ccEmails: [] },
      success: { mode: "message", title: "¡Gracias!", body: "Recibimos tu respuesta." },
      ...over,
    });
  const signed = (extra: Record<string, unknown> = {}) => ({
    answers: { nombre: "Ana Pérez", email: "ANA@x.com" },
    accepted: true,
    signature: goodSignature,
    signature_strokes: 3,
    ...extra,
  });

  it("sin aceptar la casilla: 400 y no guarda ni sube nada", async () => {
    const { ports, saves } = makePorts(contractForm());
    const out = await submitForm(ports, baseInput(signed({ accepted: false })));
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("accept_required");
    expect(saves).toHaveLength(0);
    expect(ports.uploadContractFile).not.toHaveBeenCalled();
  });

  it("sin el campo accepted tampoco", async () => {
    const { ports } = makePorts(contractForm());
    const body = signed();
    delete (body as Record<string, unknown>).accepted;
    expect((await submitForm(ports, baseInput(body))).body.error).toBe("accept_required");
  });

  it("firma obligatoria vacía o sin trazos: 400 signature_required (aunque el navegador la dejó pasar)", async () => {
    for (const bad of [{ signature: "" }, { signature: undefined }, { signature_strokes: 0 }]) {
      const { ports, saves } = makePorts(contractForm());
      const out = await submitForm(ports, baseInput(signed(bad)));
      expect(out.status).toBe(400);
      expect(out.body.error).toBe("signature_required");
      expect(saves).toHaveLength(0);
    }
  });

  it("un data URL que dice PNG pero es otra cosa, o que pesa de más: signature_invalid", async () => {
    const jpeg = `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString("base64")}`;
    const big = `data:image/png;base64,${Buffer.from([...PNG_HEAD, ...new Array(250 * 1024).fill(1)]).toString("base64")}`;
    for (const signature of [jpeg, big]) {
      const { ports } = makePorts(contractForm());
      const out = await submitForm(ports, baseInput(signed({ signature })));
      expect(out.status).toBe(400);
      expect(out.body.error).toBe("signature_invalid");
    }
  });

  it("firma opcional y sin dibujar: se firma sin imagen", async () => {
    const form = contractForm({ contract: { title: "A", signatureRequired: false, acceptLabel: "Acepto", ccEmails: [] } });
    const { ports, saves } = makePorts(form);
    const out = await submitForm(ports, baseInput(signed({ signature: undefined, signature_strokes: undefined })));
    expect(out.status).toBe(200);
    expect(ports.uploadContractFile).not.toHaveBeenCalled();
    expect(saves[0].contract?.signaturePath).toBeNull();
  });

  it("el camino feliz: sube la firma al bucket de contratos y la guarda con la metadata legal del servidor", async () => {
    const { ports, saves } = makePorts(contractForm());
    const out = await submitForm(ports, { ...baseInput(signed({ client_meta: { timezone: "America/Costa_Rica", locale: "es-CR" }, attribution: { utm_source: "meta" } })), userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1" });
    expect(out.status).toBe(200);
    expect(ports.uploadContractFile).toHaveBeenCalledWith(`ws-1/form-1/${KEY}/signature.png`, expect.any(Uint8Array), "image/png");
    const contract = saves[0].contract!;
    expect(contract.signaturePath).toBe(`ws-1/form-1/${KEY}/signature.png`);
    expect(contract.signerEmail).toBe("ana@x.com");
    expect(contract.signerName).toBe("Ana Pérez");
    expect(contract.legal).toMatchObject({ ip: "203.0.113.9", device: "mobile", os: "iOS", browser: "Safari", timezone: "America/Costa_Rica", locale: "es-CR", accepted_label: "Leí y acepto el contrato", signature_strokes: 3, utm: { utm_source: "meta" } });
  });

  it("el navegador no puede meter su propio texto del contrato: ni se mira", async () => {
    const { ports, saves } = makePorts(contractForm());
    await submitForm(ports, baseInput(signed({ contract_text: "OTRO TEXTO", contract_html: "<b>x</b>" })));
    expect(JSON.stringify(saves[0])).not.toContain("OTRO TEXTO");
    expect(JSON.stringify(saves[0])).not.toContain("<b>x</b>");
  });

  it("la pantalla de éxito dice a dónde va la copia", async () => {
    const { ports } = makePorts(contractForm());
    const out = await submitForm(ports, baseInput(signed()));
    expect(out.body.success).toMatchObject({ title: "Listo", body: "Te mandamos la copia firmada a ana@x.com en unos minutos." });
  });

  it("si la RPC falla, la imagen de la firma se descarta y responde 500 sin detalles", async () => {
    const { ports } = makePorts(contractForm(), { save: vi.fn(async () => ({ ok: false as const, error: "failed" as const })) });
    const out = await submitForm(ports, baseInput(signed()));
    expect(out.status).toBe(500);
    expect(ports.discardContractFile).toHaveBeenCalledWith(`ws-1/form-1/${KEY}/signature.png`);
  });

  it("si la imagen no se puede subir, no se guarda la respuesta", async () => {
    const { ports, saves } = makePorts(contractForm(), { uploadContractFile: vi.fn(async () => false) });
    expect((await submitForm(ports, baseInput(signed()))).status).toBe(500);
    expect(saves).toHaveLength(0);
  });

  it("un formulario común ignora lo de la firma", async () => {
    const { ports, saves } = makePorts(makeForm([field("short_text", "nombre")]));
    await submitForm(ports, baseInput({ answers: { nombre: "Ana" }, signature: goodSignature, signature_strokes: 3, accepted: true }));
    expect(saves[0].contract).toBeNull();
    expect(ports.uploadContractFile).not.toHaveBeenCalled();
  });
});
