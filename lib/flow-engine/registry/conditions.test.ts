import { describe, it, expect, vi, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { matchConditionField, getConditionOperator } from "./registry";
import { CONDITION_FIELDS } from "../condition-fields";
import type { FlowExecutionContext } from "../types";

// Registrar todo el catalogo, como hace el motor al arrancar.
beforeAll(async () => {
  await import("./index");
});

const WS = "11111111-1111-1111-1111-111111111111";

const context = {
  workspaceId: WS,
  contactId: "con-1",
  channelId: "chn-1",
} as unknown as FlowExecutionContext;

/** Cliente falso que registra los filtros y devuelve las filas que se le den. */
function fakeClient(rows: unknown[]) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, value: unknown) => {
      filters[col] = value;
      return chain;
    },
    in: (col: string, value: unknown) => {
      filters[col] = value;
      return chain;
    },
    limit: async () => ({ data: rows, error: null }),
  });
  return {
    client: { from: () => chain } as unknown as SupabaseClient<Database>,
    filters,
  };
}

async function resolve(field: string, rows: unknown[]) {
  const matched = matchConditionField(field);
  if (!matched) throw new Error(`campo no registrado: ${field}`);
  const { client, filters } = fakeClient(rows);
  const value = await matched.definition.resolve({
    supabase: client,
    argument: matched.argument,
    context,
    contact: {},
  });
  return { value, filters };
}

describe("condicion de secuencia (F14)", () => {
  it("'esta' da true con una inscripcion activa", async () => {
    const { value } = await resolve("sequence:seq-1", [{ id: "e-1" }]);
    expect(value).toBe("true");
  });

  it("'esta' da false cuando ya termino: la inscripcion no esta viva", async () => {
    // La query filtra por active/paused, asi que una completada no vuelve.
    const { value, filters } = await resolve("sequence:seq-1", []);
    expect(value).toBe("false");
    expect(filters.status).toEqual(["active", "paused"]);
  });

  it("'estuvo' no filtra por estado: cuenta las terminadas y las canceladas", async () => {
    const { value, filters } = await resolve("sequence_ever:seq-1", [{ id: "e-1" }]);
    expect(value).toBe("true");
    expect(filters.status).toBeUndefined();
  });

  it("las dos filtran por workspace: un flow no puede preguntar por otro negocio", async () => {
    const enSecuencia = await resolve("sequence:seq-1", []);
    const estuvo = await resolve("sequence_ever:seq-1", []);
    expect(enSecuencia.filters["sequences.workspace_id"]).toBe(WS);
    expect(estuvo.filters["sequences.workspace_id"]).toBe(WS);
  });

  it("sin secuencia elegida devuelve undefined en vez de dar una respuesta inventada", async () => {
    const { value } = await resolve("sequence:", []);
    expect(value).toBeUndefined();
  });

  it("'sequence_ever:' se resuelve con SU campo, no con el de 'sequence:'", () => {
    expect(matchConditionField("sequence_ever:abc")?.definition.prefix).toBe("sequence_ever:");
    expect(matchConditionField("sequence_ever:abc")?.argument).toBe("abc");
  });
});

describe("catalogo del panel y registro del motor", () => {
  it("todo campo que ofrece el panel existe en el registro", () => {
    for (const field of CONDITION_FIELDS) {
      // El campo sin prefijo es el fallback de campo personalizado: lo resuelve
      // el nodo, no el registro.
      if (field.prefix === "") continue;
      const probe = field.prefix.endsWith(":") ? `${field.prefix}x` : field.prefix;
      expect(matchConditionField(probe), `falta ${field.prefix} en el registro`).toBeDefined();
    }
  });

  it("todo operador que ofrece el panel existe en el registro", () => {
    for (const operator of ["equals", "not_equals", "contains", "exists", "gt", "lt"]) {
      expect(getConditionOperator(operator), `falta ${operator}`).toBeDefined();
    }
  });
});
