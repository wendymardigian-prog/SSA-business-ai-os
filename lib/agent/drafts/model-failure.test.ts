import { describe, expect, it } from "vitest";
import { modelFailureNotice } from "./model-failure";

describe("modelFailureNotice", () => {
  it("no dice nada cuando el borrador esta vacio por otro motivo", () => {
    expect(modelFailureNotice("guardrail:blocked_topic", null)).toBeNull();
    expect(modelFailureNotice("escalate", null)).toBeNull();
    expect(modelFailureNotice(null, null)).toBeNull();
  });

  it("con una key revocada, manda a la integracion y dice que pasa", () => {
    const notice = modelFailureNotice(
      "error:provider_unavailable",
      "primary anthropic/claude-sonnet-5: api_401:authentication_error; fallback anthropic/claude-haiku-4-5: skipped_same_provider_auth",
    );
    expect(notice?.headline).toBe("El modelo no respondió — revisá la integración de IA");
    expect(notice?.hint).toContain("no es valida o fue revocada");
    // La pista no arrastra el texto tecnico: eso va al detalle.
    expect(notice?.hint).not.toContain("api_401");
    expect(notice?.technical).toContain("api_401");
    expect(notice?.href).toBe("/dashboard/settings/integrations");
  });

  it("un timeout tiene su propio titular", () => {
    const notice = modelFailureNotice("error:model_timeout", "primary openai/gpt-5: timeout");
    expect(notice?.headline).toBe("El modelo no respondió a tiempo");
    expect(notice?.hint).toContain("timeout");
  });

  it("sin texto tecnico igual da el titular", () => {
    const notice = modelFailureNotice("error:provider_unavailable", null);
    expect(notice?.headline).toContain("revisá la integración de IA");
    expect(notice?.hint).toBeNull();
    expect(notice?.technical).toBeNull();
  });

  it("una salida invalida no culpa a la integracion", () => {
    const notice = modelFailureNotice("error:output_too_long", "too long");
    expect(notice?.href).toBeNull();
    expect(notice?.headline).toContain("no se pudo usar");
  });
});
