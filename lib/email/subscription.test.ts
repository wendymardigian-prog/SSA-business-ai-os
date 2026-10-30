import { describe, it, expect, vi } from "vitest";
import cases from "./subscription-transitions.cases.json";
import {
  canSendEmailTo,
  decideEmailStatus,
  decideSend,
  emailStatusRank,
  emailStatusSourceLabel,
  EmailStatusError,
  mapUnsubscribeSource,
  maskEmailAddress,
  normalizeEmailAddress,
  parseImportSubscription,
  setEmailStatus,
  setEmailStatusByAddress,
  worstEmailStatus,
} from "./subscription";

describe("la tabla de transiciones (gemela de private.email_status_decide)", () => {
  for (const c of cases.cases as Array<{ from: string; to: string; mode: string; reason?: string; expect: string }>) {
    it(`${c.mode}: ${c.from} → ${c.to}${c.reason !== undefined ? ` (motivo "${c.reason}")` : ""} = ${c.expect}`, () => {
      expect(decideEmailStatus(c.from, c.to, c.mode, c.reason)).toBe(c.expect);
    });
  }

  it("un proceso automatico NUNCA vuelve a suscribir, venga de donde venga", () => {
    for (const from of ["unsubscribed", "bounced", "complained"]) {
      expect(decideEmailStatus(from, "subscribed", "system")).toBe("kept");
    }
  });
});

describe("gravedad", () => {
  it("complained > bounced > unsubscribed > subscribed", () => {
    expect(emailStatusRank("complained")).toBeGreaterThan(emailStatusRank("bounced"));
    expect(emailStatusRank("bounced")).toBeGreaterThan(emailStatusRank("unsubscribed"));
    expect(emailStatusRank("unsubscribed")).toBeGreaterThan(emailStatusRank("subscribed"));
    expect(emailStatusRank("cualquiera")).toBe(0);
  });

  it("el peor de varios; sin ninguno, suscripto", () => {
    expect(worstEmailStatus(["subscribed", "bounced", "unsubscribed"])).toBe("bounced");
    expect(worstEmailStatus([])).toBe("subscribed");
    expect(worstEmailStatus([null, "otro"])).toBe("subscribed");
  });
});

describe("normalizacion", () => {
  it("igual que normalize_email: sin espacios y en minusculas", () => {
    expect(normalizeEmailAddress("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(normalizeEmailAddress("   ")).toBeNull();
    expect(normalizeEmailAddress(null)).toBeNull();
  });
});

describe("valores de una importacion", () => {
  it("acepta si/no, true/false, 1/0 y los nombres de cada estado, sin acentos ni mayusculas", () => {
    expect(parseImportSubscription("TRUE")).toBe("subscribed");
    expect(parseImportSubscription("Sí")).toBe("subscribed");
    expect(parseImportSubscription("si")).toBe("subscribed");
    expect(parseImportSubscription("1")).toBe("subscribed");
    expect(parseImportSubscription("yes")).toBe("subscribed");
    expect(parseImportSubscription("Suscripto")).toBe("subscribed");
    expect(parseImportSubscription("suscrito")).toBe("subscribed");
    expect(parseImportSubscription("false")).toBe("unsubscribed");
    expect(parseImportSubscription("No")).toBe("unsubscribed");
    expect(parseImportSubscription("0")).toBe("unsubscribed");
    expect(parseImportSubscription("Dado de baja")).toBe("unsubscribed");
    expect(parseImportSubscription("unsubscribed")).toBe("unsubscribed");
    expect(parseImportSubscription("bounced")).toBe("bounced");
    expect(parseImportSubscription("Rebota")).toBe("bounced");
    expect(parseImportSubscription("complained")).toBe("complained");
    expect(parseImportSubscription("SPAM")).toBe("complained");
  });

  it("vacio o no reconocido = null (la fila da error)", () => {
    expect(parseImportSubscription("")).toBeNull();
    expect(parseImportSubscription("  ")).toBeNull();
    expect(parseImportSubscription("quizás")).toBeNull();
  });

  it("el motivo de la baja de otro sistema: bounce, complaint y el resto es baja comun", () => {
    expect(mapUnsubscribeSource("bounce")).toEqual({ status: "bounced", original: "bounce" });
    expect(mapUnsubscribeSource("complaint")).toEqual({ status: "complained", original: "complaint" });
    expect(mapUnsubscribeSource("email_footer")).toEqual({ status: "unsubscribed", original: "email_footer" });
    expect(mapUnsubscribeSource("one_click_header")).toEqual({ status: "unsubscribed", original: "one_click_header" });
    expect(mapUnsubscribeSource("admin_manual")).toEqual({ status: "unsubscribed", original: "admin_manual" });
    expect(mapUnsubscribeSource("")).toBeNull();
  });
});

describe("lo que se muestra", () => {
  it("enmascara la direccion: solo la primera letra y el dominio", () => {
    expect(maskEmailAddress("wendy@gmail.com")).toBe("w***@gmail.com");
    expect(maskEmailAddress("sinarroba")).toBe("***");
  });

  it("el origen se lee en palabras; una importacion lleva su etiqueta", () => {
    expect(emailStatusSourceLabel("import:wendymardigian")).toBe("importación (wendymardigian)");
    expect(emailStatusSourceLabel("one_click")).toContain("un clic");
    expect(emailStatusSourceLabel(null)).toBe("alta del contacto");
  });
});

describe("la regla de envio", () => {
  const base = { doNotContact: false, honorDoNotContact: true };
  it("un rebote frena todo, tambien lo transaccional", () => {
    expect(decideSend({ ...base, status: "bounced", category: "marketing" })).toBe("bounced");
    expect(decideSend({ ...base, status: "bounced", category: "transactional" })).toBe("bounced");
  });
  it("baja y queja frenan el marketing, no lo transaccional", () => {
    expect(decideSend({ ...base, status: "unsubscribed", category: "marketing" })).toBe("unsubscribed");
    expect(decideSend({ ...base, status: "complained", category: "marketing" })).toBe("complained");
    expect(decideSend({ ...base, status: "unsubscribed", category: "transactional" })).toBeNull();
    expect(decideSend({ ...base, status: "complained", category: "transactional" })).toBeNull();
  });
  it("'no contactar' frena solo si quien llama lo respeta", () => {
    expect(decideSend({ status: "subscribed", category: "transactional", doNotContact: true, honorDoNotContact: true })).toBe("do_not_contact");
    expect(decideSend({ status: "subscribed", category: "transactional", doNotContact: true, honorDoNotContact: false })).toBeNull();
  });
  it("suscripto pasa", () => {
    expect(decideSend({ ...base, status: "subscribed", category: "marketing" })).toBeNull();
  });
});

describe("canSendEmailTo", () => {
  const rpc = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

  it("pregunta por la direccion normalizada y el contacto", async () => {
    const svc = rpc({ status: "subscribed", do_not_contact: false, token: "tok", matched: true });
    const gate = await canSendEmailTo(svc as never, { workspaceId: "ws", address: " Ana@X.com ", category: "marketing", contactId: "c1" });
    expect(gate).toEqual({ ok: true, status: "subscribed", matched: true, token: "tok" });
    expect(svc.rpc).toHaveBeenCalledWith("email_address_send_state", { p_workspace_id: "ws", p_email: "ana@x.com", p_contact_id: "c1" });
  });

  it("dado de baja: frena marketing con el motivo", async () => {
    const gate = await canSendEmailTo(rpc({ status: "unsubscribed", do_not_contact: false, token: null, matched: true }) as never, {
      workspaceId: "ws", address: "a@x.com", category: "marketing",
    });
    expect(gate).toMatchObject({ ok: false, reason: "unsubscribed" });
  });

  it("si la base no contesta: marketing no sale, transaccional si", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = rpc(null, { message: "boom", code: "XX000" });
    expect(await canSendEmailTo(failing as never, { workspaceId: "ws", address: "a@x.com", category: "marketing" })).toMatchObject({ ok: false, reason: "unverifiable" });
    expect(await canSendEmailTo(failing as never, { workspaceId: "ws", address: "a@x.com", category: "transactional" })).toMatchObject({ ok: true });
  });

  it("sin direccion no hay nada que mirar", async () => {
    const svc = rpc(null);
    expect(await canSendEmailTo(svc as never, { workspaceId: "ws", address: "  ", category: "marketing" })).toMatchObject({ ok: true });
    expect(svc.rpc).not.toHaveBeenCalled();
  });
});

describe("setEmailStatus / setEmailStatusByAddress", () => {
  it("pasan los parametros a la funcion de la base y traducen el resultado", async () => {
    const svc = { rpc: vi.fn(async () => ({ data: { status: "unsubscribed", previous_status: "subscribed", changed: true, kept_existing: false, contacts_changed: 2, enrollments_paused: 1 }, error: null })) };
    const r = await setEmailStatus(svc as never, "c1", { status: "unsubscribed", source: "admin", mode: "admin", performedBy: "u1" });
    expect(r).toEqual({ status: "unsubscribed", previousStatus: "subscribed", changed: true, keptExisting: false, contactsChanged: 2, enrollmentsPaused: 1, notFound: false });
    expect(svc.rpc).toHaveBeenCalledWith("set_email_status", expect.objectContaining({ p_contact_id: "c1", p_status: "unsubscribed", p_mode: "admin", p_performed_by: "u1" }));
  });

  it("un error de la base sale con su codigo (EM002 = falta el motivo)", async () => {
    const svc = { rpc: vi.fn(async () => ({ data: null, error: { message: "motivo", code: "EM002" } })) };
    await expect(setEmailStatusByAddress(svc as never, "ws", "a@x.com", { status: "subscribed", source: "admin", mode: "admin" })).rejects.toMatchObject({ code: "EM002" });
    await expect(setEmailStatusByAddress(svc as never, "ws", "a@x.com", { status: "subscribed", source: "admin", mode: "admin" })).rejects.toBeInstanceOf(EmailStatusError);
  });
});
