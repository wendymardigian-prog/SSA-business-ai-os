import { describe, expect, it } from "vitest";
import { capJson, changedVariables, snapshotVariables, stepInput, stepOutput } from "./step-io";

describe("stepInput", () => {
  it("reemplaza las variables y saca lo del lienzo", () => {
    const input = stepInput({ label: "Mi paso", to: "{{contact.email}}", body: "Hola {{contact.first_name}}" }, { contact: { email: "a@x.com", first_name: "Ana" } });
    expect(input).toEqual({ to: "a@x.com", body: "Hola Ana" });
  });
  it("sin configuración, null", () => {
    expect(stepInput(null, {})).toBeNull();
    expect(stepInput({ label: "x" }, {})).toBeNull();
  });
});

describe("stepOutput", () => {
  it("guarda lo declarado, las variables nuevas y el contacto", () => {
    const vars: Record<string, unknown> = { webhook: { payload: { a: 1 } }, contact_result: "" };
    const before = snapshotVariables(vars);
    vars.contact_result = "created";
    vars.company = { id: "c1" };
    vars.webhook = { payload: { a: 2 } };
    const out = stepOutput({ declared: { contactId: "k1" }, before, variables: vars, contactBefore: null, contactAfter: "k1" });
    expect(out).toEqual({ result: { contactId: "k1" }, variables: { contact_result: "created", company: { id: "c1" } }, contact_id: "k1" });
  });
  it("sin cambios, null", () => {
    const vars = { a: 1 };
    expect(stepOutput({ declared: null, before: snapshotVariables(vars), variables: vars, contactBefore: "k", contactAfter: "k" })).toBeNull();
    expect(changedVariables(snapshotVariables(vars), vars)).toEqual({});
  });
});

describe("capJson", () => {
  it("recorta lo grande con la marca", () => {
    const big = { text: "á".repeat(40000) };
    const out = capJson(big, 1024)!;
    expect(out.truncated).toBe(true);
    expect(new TextEncoder().encode(String(out.preview)).length).toBeLessThanOrEqual(1024);
  });
  it("un ciclo no lanza", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(capJson(a)).toBeNull();
  });
});
