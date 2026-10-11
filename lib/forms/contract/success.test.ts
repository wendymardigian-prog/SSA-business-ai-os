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
  it("un mensaje propio o una redirección mandan", () => {
    const own = { mode: "message", title: "Gracias por firmar", body: "Nos vemos" } as const;
    expect(contractSuccess(own, "ana@x.com")).toBe(own);
    const redirect = { mode: "redirect", url: "https://x.com", passParams: false } as const;
    expect(contractSuccess(redirect, "ana@x.com")).toBe(redirect);
    expect(isDefaultSuccess(own)).toBe(false);
  });
});
