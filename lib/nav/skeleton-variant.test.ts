import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { skeletonVariantFor } from "./skeleton-variant";

describe("esqueleto de las pantallas sin loading propio", () => {
  it("Inicio sigue con su grilla", () => {
    expect(skeletonVariantFor("/dashboard")).toBe("home");
    expect(skeletonVariantFor("/dashboard/")).toBe("home");
    expect(skeletonVariantFor(null)).toBe("home");
  });

  it("los tableros y paneles van con tarjetas", () => {
    expect(skeletonVariantFor("/dashboard/finanzas")).toBe("cards");
    expect(skeletonVariantFor("/dashboard/portal")).toBe("cards");
    expect(skeletonVariantFor("/dashboard/dashboards")).toBe("cards");
  });

  it("los ajustes son formularios y las fichas, detalle (también con un id)", () => {
    expect(skeletonVariantFor("/dashboard/cuenta")).toBe("form");
    expect(skeletonVariantFor("/dashboard/portal/9625d853-afcc-4461-988d-1bac083fc4d0/ajustes")).toBe("form");
    expect(skeletonVariantFor("/dashboard/portal/9625d853-afcc-4461-988d-1bac083fc4d0")).toBe("detail");
    expect(skeletonVariantFor("/dashboard/disenos/d/abc")).toBe("detail");
    expect(skeletonVariantFor("/dashboard/asistente")).toBe("split");
  });

  it("lo demás es una lista", () => {
    expect(skeletonVariantFor("/dashboard/clientes")).toBe("list");
    expect(skeletonVariantFor("/dashboard/notificaciones")).toBe("list");
    expect(skeletonVariantFor("/dashboard/afiliados")).toBe("list");
    expect(skeletonVariantFor("/dashboard/una-pantalla-nueva")).toBe("list");
  });

  it("cada ruta de la lista existe de verdad (una pantalla que se mudó no deja una entrada muerta)", () => {
    const routes = [
      "dashboards", "finanzas", "portal", "disenos", "cuenta", "clientes/importar", "afiliados/reglas", "disenos/ajustes",
      "portal/ajustes", "portal/[productId]/ajustes", "eod/[formId]", "portal/[productId]", "disenos/d/[id]",
      "disenos/t/[id]", "clientes/c/[contactId]", "clientes/s/[serviceId]", "asistente",
    ];
    for (const r of routes) {
      expect(existsSync(path.join(process.cwd(), "app/(dashboard)/dashboard", r, "page.tsx")), r).toBe(true);
    }
  });
});
