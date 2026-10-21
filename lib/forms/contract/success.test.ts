import { describe, it, expect } from "vitest";
import { contractSuccess, isDefaultSuccess } from "./success";
import { DEFAULT_SUCCESS } from "@/lib/forms/success";

describe("contractSuccess", () => {
  it("con el mensaje por defecto, avisa de la copia por email", () => {
    expect(contractSuccess(DEFAULT_SUCCESS, "ana@x.com")).toEqual({ mode: "message", title: "Listo", body: "Te mandamos la copia firmada a ana@x.com en unos minutos." });
  });
  it("sin email conocido no inventa una dirección", () => {
    expect(contractSuccess(DEFAULT_SUCCESS, " ")).toMatchObject({ body: "Te mandamos la copia firmada por email en unos minutos." });
  });
  it("el mensaje vacío que trae un formulario nuevo de la base también cuenta como el de siempre", () => {
    expect(contractSuccess({ mode: "message" }, "ana@x.com")).toMatchObject({ title: "Listo", body: "Te mandamos la copia firmada a ana@x.com en unos minutos." });
    expect(isDefaultSuccess({ mode: "message", title: "  ", body: "" })).toBe(true);
  });
  it("el botón Descargar contrato se conserva con el mensaje de siempre y con uno propio", () => {
    expect(contractSuccess({ mode: "message", downloadContract: true }, "ana@x.com")).toMatchObject({ title: "Listo", downloadContract: true });
    expect(contractSuccess({ mode: "message" }, "ana@x.com")).not.toHaveProperty("downloadContract");
    const own = { mode: "message", title: "Gracias", downloadContract: true } as const;
    expect(contractSuccess(own, "ana@x.com")).toBe(own);
  });
  it("un mensaje propio o una redirección mandan", () => {
    const own = { mode: "message", title: "Gracias por firmar", body: "Nos vemos" } as const;
    expect(contractSuccess(own, "ana@x.com")).toBe(own);
    const redirect = { mode: "redirect", url: "https://x.com", passParams: false } as const;
    expect(contractSuccess(redirect, "ana@x.com")).toBe(redirect);
    expect(isDefaultSuccess(own)).toBe(false);
  });
});
