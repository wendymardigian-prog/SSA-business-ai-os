import { describe, it, expect, vi } from "vitest";
import { findDuplicateContact } from "./dedup";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cliente falso que registra el filtro `or` con el que se lo llamo. */
function fakeClient(result: { data: unknown; error?: { message: string } | null }) {
  const calls: { or?: string; select?: string } = {};
  const chain = {
    select: (s: string) => { calls.select = s; return chain; },
    eq: () => chain,
    is: () => chain,
    or: (f: string) => { calls.or = f; return chain; },
    limit: () => chain,
    maybeSingle: async () => ({ data: result.data, error: result.error ?? null }),
  };
  const client = { from: () => chain } as unknown as SupabaseClient;
  return { client, calls };
}

describe("findDuplicateContact", () => {
  it("busca el telefono en los dos campos de telefono", async () => {
    const { client, calls } = fakeClient({ data: null });
    await findDuplicateContact({ supabase: client, workspaceId: "w", phones: ["+5491122334455"] });
    expect(calls.or).toBe("phone.eq.+5491122334455,whatsapp_phone.eq.+5491122334455");
  });

  it("y el email en los dos campos de email", async () => {
    const { client, calls } = fakeClient({ data: null });
    await findDuplicateContact({ supabase: client, workspaceId: "w", emails: ["ana@x.com"] });
    expect(calls.or).toBe("email.eq.ana@x.com,secondary_email.eq.ana@x.com");
  });

  it("combina telefonos y emails en la misma consulta", async () => {
    const { client, calls } = fakeClient({ data: null });
    await findDuplicateContact({
      supabase: client, workspaceId: "w", phones: ["+549"], emails: ["ana@x.com"],
    });
    expect(calls.or?.split(",")).toHaveLength(4);
  });

  it("ignora los valores vacios o nulos", async () => {
    const { client, calls } = fakeClient({ data: null });
    await findDuplicateContact({
      supabase: client, workspaceId: "w", phones: [null, "", "+549"], emails: [undefined],
    });
    expect(calls.or).toBe("phone.eq.+549,whatsapp_phone.eq.+549");
  });

  it("sin ningun dato fuerte no consulta y devuelve null", async () => {
    const { client, calls } = fakeClient({ data: { id: "no-deberia-verse" } });
    const r = await findDuplicateContact({ supabase: client, workspaceId: "w", phones: [null] });
    expect(r).toBeNull();
    expect(calls.or).toBeUndefined();
  });

  it("devuelve el contacto cuando lo encuentra", async () => {
    const { client } = fakeClient({ data: { id: "c1" } });
    const r = await findDuplicateContact({ supabase: client, workspaceId: "w", emails: ["ana@x.com"] });
    expect(r).toEqual({ id: "c1" });
  });

  it("trae los campos extra que se le pidan", async () => {
    const { client, calls } = fakeClient({ data: null });
    await findDuplicateContact({
      supabase: client, workspaceId: "w", emails: ["ana@x.com"], select: "id, display_name, phone",
    });
    expect(calls.select).toBe("id, display_name, phone");
  });

  it("ante un error de base devuelve null en vez de romper la importacion", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: null, error: { message: "se cayo" } });
    const r = await findDuplicateContact({ supabase: client, workspaceId: "w", emails: ["ana@x.com"] });
    expect(r).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
