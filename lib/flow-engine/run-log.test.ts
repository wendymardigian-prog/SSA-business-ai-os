import { describe, expect, it, vi } from "vitest";
import { finalStepStatus, mergeStepNote, noteSessionEnd, noteSessionVersion, recordStep, sanitizeRunText, stepExitLabel, stepLabel } from "./run-log";

describe("sanitizeRunText: lo que se guarda de un motivo o un error", () => {
  it("no guarda una direccion de email", () => {
    expect(sanitizeRunText("No se pudo mandar a juana.perez+vip@empresa.com.ar")).toBe("No se pudo mandar a [email]");
  });

  it("de una URL queda solo el dominio: el camino y los parametros pueden llevar tokens", () => {
    const clean = sanitizeRunText("fallo https://api.ejemplo.com/v1/hook/abc123?token=secreto&mail=a@b.com#x");
    expect(clean).toBe("fallo https://api.ejemplo.com");
  });

  it("no guarda un telefono ni un token Bearer", () => {
    expect(sanitizeRunText("El numero +54 9 11 2233-4455 no existe")).toBe("El numero [número] no existe");
    expect(sanitizeRunText("Header Bearer abcdef123456 rechazado")).toBe("Header Bearer [oculto] rechazado");
  });

  it("acepta un Error y corta a 300 caracteres", () => {
    expect(sanitizeRunText(new Error("se rompio"))).toBe("se rompio");
    const long = sanitizeRunText("x".repeat(1000));
    expect(long).toHaveLength(300);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("nada que decir es null, no un texto vacio", () => {
    expect(sanitizeRunText(null)).toBeNull();
    expect(sanitizeRunText(undefined)).toBeNull();
    expect(sanitizeRunText("   ")).toBeNull();
  });
});

describe("lo que avisa un paso", () => {
  it("gana lo mas grave, sin importar el orden", () => {
    const failed = { status: "failed", reason: "rechazado" } as const;
    const skipped = { status: "skipped", reason: "baja" } as const;
    expect(mergeStepNote(mergeStepNote(null, skipped), failed).status).toBe("failed");
    expect(mergeStepNote(mergeStepNote(null, failed), skipped).status).toBe("failed");
    expect(mergeStepNote(mergeStepNote(null, failed), skipped).reason).toBe("rechazado");
  });

  it("sin aviso: bien, o en espera si el paso pauso", () => {
    expect(finalStepStatus(null, undefined)).toBe("ok");
    expect(finalStepStatus(null, "handle:true")).toBe("ok");
    expect(finalStepStatus(null, "pause")).toBe("waiting");
  });

  it("un paso que pausa pero avisa que salio bien (paso a una persona) no queda en espera", () => {
    expect(finalStepStatus({ status: "ok", reason: "Pasó a una persona." }, "pause")).toBe("ok");
  });
});

describe("el nombre y el camino del paso", () => {
  it("el nombre lleva el tipo y lo que la persona escribio", () => {
    expect(stepLabel({}, "Enviar email")).toBe("Enviar email");
    expect(stepLabel({ subject: "Confirmación" }, "Enviar email")).toBe("Enviar email · Confirmación");
    expect(stepLabel({ label: "Bienvenida", subject: "Hola" }, "Enviar email")).toBe("Enviar email · Bienvenida");
    expect(stepLabel({ label: "Enviar email" }, "Enviar email")).toBe("Enviar email");
    expect(stepLabel({ label: "y".repeat(500) }, "Paso").length).toBeLessThanOrEqual(120);
  });

  it("el camino de una condicion, de un reparto por caminos y de un A/B", () => {
    expect(stepExitLabel({}, "handle:true")).toBe("Sí");
    expect(stepExitLabel({}, "handle:false")).toBe("No");
    expect(stepExitLabel({ paths: [{ id: "p_abc", label: "Clientes" }] }, "handle:p_abc")).toBe("Clientes");
    expect(stepExitLabel({ paths: [{ id: "p_abc", label: "Clientes" }] }, "handle:else")).toBe("Si no");
    expect(stepExitLabel({ paths: [{ name: "A" }, { name: "B" }] }, "handle:split-1")).toBe("B");
  });

  it("un paso sin salida elegida no tiene camino", () => {
    expect(stepExitLabel({}, undefined)).toBeNull();
    expect(stepExitLabel({}, "pause")).toBeNull();
    expect(stepExitLabel({ paths: [] }, "handle:p_borrado")).toBeNull();
  });
});

describe("anotar nunca frena un flujo", () => {
  const stepArgs = { sessionId: "s", flowId: "f", nodeId: "n", nodeType: "tag", label: "Etiqueta", status: "failed", startedAt: "2026-11-04T00:00:00Z" } as const;

  it.each([
    ["la base devuelve un error (por ejemplo, sin la migracion)", () => ({ insert: async () => ({ error: { code: "42P01" } }), update: () => ({ eq: async () => ({ error: { code: "42703" } }), }) })],
    ["la tabla revienta", () => { throw new Error("se cayo la red"); }],
  ])("recordStep no lanza si %s", async (_name, from) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordStep({ from } as never, stepArgs)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("noteSessionEnd y noteSessionVersion no lanzan", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { from: () => { throw new Error("se cayo la red"); } } as never;
    await expect(noteSessionEnd(broken, "s", "step_failed", new Error("x"))).resolves.toBeUndefined();
    await expect(noteSessionVersion(broken, "s", 3)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("los logs no llevan el texto del error: solo el codigo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { from: () => { throw new Error("mail secreto a@b.com"); } } as never;
    await recordStep(client, stepArgs);
    await noteSessionEnd(client, "s", "step_failed");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("a@b.com");
    spy.mockRestore();
  });
});
