// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { clientRecordFacts, relativeWhen } from "./client-record";

const NOW = "2026-11-10T15:00:00Z";

describe("clientRecordFacts", () => {
  it("con portal: total, portal con su último ingreso, último contacto, cliente y lead desde", () => {
    const f = clientRecordFacts(
      { paidCents: 310000, hasPortal: true, portal: { accountStatus: "active", lastLoginAt: "2026-11-10T13:00:00Z" }, lastContact: "2026-11-09T12:00:00Z", clientSince: "2026-05-02", leadSince: "2026-04-14T10:00:00Z" },
      NOW,
      "UTC",
    );
    expect(f.map((x) => x.label)).toEqual(["Total cobrado", "Portal", "Último contacto", "Cliente desde", "Lead desde"]);
    expect(f[0].value).toBe("US$3.100");
    expect(f[1]).toEqual({ label: "Portal", value: "Activo · entró hace 2 h", tone: undefined });
    expect(f[2].value).toBe("ayer");
  });
  it("sin portal no se habla del portal; sin ventas no hay total (nunca un cero inventado)", () => {
    const f = clientRecordFacts({ paidCents: null, hasPortal: false, portal: null, lastContact: null, clientSince: "2026-05-02", leadSince: null }, NOW, "UTC");
    expect(f.map((x) => x.label)).toEqual(["Cliente desde"]);
  });
  it("invitado que nunca entró, en amarillo; más de 7 días sin entrar, en rojo", () => {
    expect(clientRecordFacts({ paidCents: 0, hasPortal: true, portal: { accountStatus: "invited", lastLoginAt: null }, lastContact: null, clientSince: null, leadSince: null }, NOW, "UTC")[1]).toEqual({ label: "Portal", value: "Invitado · nunca entró", tone: "warn" });
    expect(clientRecordFacts({ paidCents: 0, hasPortal: true, portal: { accountStatus: "active", lastLoginAt: "2026-10-30T10:00:00Z" }, lastContact: null, clientSince: null, leadSince: null }, NOW, "UTC")[1]).toMatchObject({ tone: "bad" });
    expect(clientRecordFacts({ paidCents: 0, hasPortal: true, portal: null, lastContact: null, clientSince: null, leadSince: null }, NOW, "UTC")[1]).toEqual({ label: "Portal", value: "Sin invitar" });
  });
});

describe("relativeWhen", () => {
  it("hace un rato, horas, ayer, días y la fecha", () => {
    expect(relativeWhen("2026-11-10T14:30:00Z", NOW, "UTC")).toBe("hace un rato");
    expect(relativeWhen("2026-11-10T10:00:00Z", NOW, "UTC")).toBe("hace 5 h");
    expect(relativeWhen("2026-11-08T10:00:00Z", NOW, "UTC")).toBe("hace 2 días");
    expect(relativeWhen("2026-09-01T10:00:00Z", NOW, "UTC")).toContain("2026");
  });
});
