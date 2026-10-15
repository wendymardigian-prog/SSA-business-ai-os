import { describe, expect, it } from "vitest";
import { findActiveVendorByName, selectableVendors, vendorInputSchema, vendorLabel } from "./vendors";

const vendors = [
  { id: "1", name: "Agencia de diseño", archived_at: null },
  { id: "2", name: "Vieja SA", archived_at: "2026-01-01T00:00:00Z" },
];

describe("vendorInputSchema", () => {
  it("acepta un proveedor mínimo y normaliza los vacíos", () => {
    const p = vendorInputSchema.parse({ name: "  Google Workspace ", country: "", email: "", paymentDetails: "" });
    expect(p).toMatchObject({ name: "Google Workspace", country: null, email: null, paymentDetails: null });
  });
  it("país en mayúsculas de dos letras, email válido, largos máximos", () => {
    expect(vendorInputSchema.parse({ name: "x", country: "cr" }).country).toBe("CR");
    expect(vendorInputSchema.safeParse({ name: "x", country: "Costa Rica" }).success).toBe(false);
    expect(vendorInputSchema.safeParse({ name: "x", email: "no-es-email" }).success).toBe(false);
    expect(vendorInputSchema.safeParse({ name: "x", paymentDetails: "a".repeat(1001) }).success).toBe(false);
    expect(vendorInputSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("nombres y selección", () => {
  it("el nombre de otro ACTIVO choca, sin importar mayúsculas; el de un archivado no", () => {
    expect(findActiveVendorByName(vendors, "AGENCIA DE DISEÑO")?.id).toBe("1");
    expect(findActiveVendorByName(vendors, "vieja sa")).toBeNull();
    expect(findActiveVendorByName(vendors, "Agencia de diseño", "1")).toBeNull();
  });
  it("un archivado no se ofrece, salvo el que ya tiene el gasto", () => {
    expect(selectableVendors(vendors).map((v) => v.id)).toEqual(["1"]);
    expect(selectableVendors(vendors, "2").map((v) => v.id)).toEqual(["1", "2"]);
  });
  it("etiquetas", () => {
    expect(vendorLabel(vendors, "2")).toBe("Vieja SA (archivado)");
    expect(vendorLabel(vendors, null)).toBe("Sin proveedor");
  });
});
