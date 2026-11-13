import { describe, expect, it } from "vitest";
import { taskServiceSummary } from "./service-summary";

describe("la franja del servicio en la tarea (A4, F154)", () => {
  it("sin servicio no hay franja", () => {
    expect(taskServiceSummary(null)).toBeNull();
  });
  it("arma el título y el detalle", () => {
    expect(
      taskServiceSummary({ id: "s", productName: "Programa", variantName: "Anual", status: "active", light: "yellow", phaseName: "Arranque", progressPct: 33.4, ownerName: "Ana" }),
    ).toEqual({ id: "s", title: "Programa › Anual", detail: "Activo · fase «Arranque» · 33 % · a cargo de Ana", light: "yellow" });
  });
  it("un servicio terminado no muestra la fase y un semáforo raro es gris", () => {
    expect(taskServiceSummary({ id: "s", productName: "P", variantName: "", status: "completed", light: null, phaseName: "X", progressPct: 100, ownerName: null })).toEqual({
      id: "s",
      title: "P",
      detail: "Completado · 100 %",
      light: "gray",
    });
  });
});
