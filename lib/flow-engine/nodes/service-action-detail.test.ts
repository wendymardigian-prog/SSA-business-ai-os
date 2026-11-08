// @plantilla-quitar(servicios)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serviceActionDetail, SERVICE_ACTION_LABELS, SERVICE_ACTION_TYPES } from "./service-action-detail";

describe("lo puro de las acciones de Servicios", () => {
  it("no importa nada: lo usan el lienzo y el simulador en el navegador (un import de servidor rompe el build)", () => {
    const src = readFileSync(new URL("./service-action-detail.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
  it("cada acción tiene su etiqueta y su texto", () => {
    for (const t of SERVICE_ACTION_TYPES) {
      expect(SERVICE_ACTION_LABELS[t]).toBeTruthy();
      expect(serviceActionDetail(t, {})).toBeTruthy();
    }
    expect(serviceActionDetail("svc_issue_certificate", {})).toBe("emitiría el certificado del servicio");
  });
});
