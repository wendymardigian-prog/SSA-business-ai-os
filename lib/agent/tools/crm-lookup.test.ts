import { describe, expect, it, vi } from "vitest";
import { CRM_FIELDS, DEFAULT_CRM_FIELDS, crmLookupTool } from "./crm-lookup";
import type { AgentToolContext } from "./types";

describe("buscar_datos_del_contacto: campos por defecto", () => {
  it("lo sensible no viene prendido: email, telefono, notas y quien lo atiende", () => {
    for (const key of ["email", "phone", "notes", "assignment"]) {
      expect(DEFAULT_CRM_FIELDS).not.toContain(key);
      expect(CRM_FIELDS.find((f) => f.value === key)?.hint).toBe("sensible");
    }
  });

  it("los datos de la ficha que no son sensibles siguen por defecto", () => {
    expect(DEFAULT_CRM_FIELDS).toEqual(
      expect.arrayContaining(["display_name", "country", "instagram_username", "lead_temperature", "tags", "next_followup_date"]),
    );
  });
});

describe("buscar_datos_del_contacto: setter y vendedor", () => {
  function ctxWith(user: { email?: string; user_metadata?: Record<string, unknown> }) {
    const contact = { display_name: "Ana", setter_id: "u1", vendedor_id: null };
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      maybeSingle: async () => ({ data: contact, error: null }),
    };
    return {
      contactId: "c1",
      workspaceId: "w1",
      supabase: {
        from: () => query,
        auth: { admin: { getUserById: vi.fn(async () => ({ data: { user } })) } },
      },
    } as unknown as AgentToolContext;
  }

  it("sin nombre cargado no devuelve el email de la persona del equipo", async () => {
    const res = await crmLookupTool.execute({
      input: { campos: ["assignment"] },
      config: { fields: ["assignment"] },
      ctx: ctxWith({ email: "persona@equipo.test", user_metadata: {} }),
    });
    expect(res.forModel).toContain("Setter: una persona del equipo");
    expect(res.forModel).not.toContain("persona@equipo.test");
  });

  it("con nombre, el nombre", async () => {
    const res = await crmLookupTool.execute({
      input: { campos: ["assignment"] },
      config: { fields: ["assignment"] },
      ctx: ctxWith({ email: "persona@equipo.test", user_metadata: { full_name: "Ana Equipo" } }),
    });
    expect(res.forModel).toContain("Setter: Ana Equipo");
  });
});
