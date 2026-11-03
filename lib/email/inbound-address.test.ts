import { describe, it, expect } from "vitest";
import { domainOf, inboundRecipients, inboundToLabel, pickOurAddress, replyFromAddress, resolveInboundChannel } from "./inbound-address";

describe("domainOf / inboundRecipients", () => {
  it("el dominio en minusculas, con o sin nombre", () => {
    expect(domainOf("Ana <Ana@Negocio.Test>")).toBe("negocio.test");
    expect(domainOf("sin-arroba")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });

  it("para, copia y copia oculta, sin repetir", () => {
    expect(inboundRecipients({ to: ["A <a@x.test>", "b@x.test"], cc: ["A@X.test"], receivedFor: ["c@x.test"] })).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
  });
});

describe("resolveInboundChannel", () => {
  const ch = (id: string, ws: string, address: string) => ({ id, workspace_id: ws, email_address: address });

  it("la direccion exacta gana", () => {
    const r = resolveInboundChannel(["ventas@d.test"], [ch("1", "w1", "hola@d.test"), ch("2", "w2", "ventas@d.test")]);
    expect(r).toMatchObject({ kind: "found", channel: { id: "2" }, address: "ventas@d.test" });
  });

  it("si no, el dominio (cualquier direccion)", () => {
    expect(resolveInboundChannel(["soporte@d.test"], [ch("1", "w1", "hola@d.test")])).toMatchObject({ kind: "found", channel: { id: "1" }, address: "soporte@d.test" });
  });

  it("dos negocios con el mismo dominio: ambiguous", () => {
    expect(resolveInboundChannel(["soporte@d.test"], [ch("1", "w1", "hola@d.test"), ch("2", "w2", "info@d.test")])).toEqual({ kind: "ambiguous", workspaceIds: ["w1", "w2"] });
  });

  it("un subdominio no es el dominio", () => {
    expect(resolveInboundChannel(["x@mail.d.test"], [ch("1", "w1", "hola@d.test")])).toEqual({ kind: "unknown" });
  });
});

describe("replyFromAddress: desde donde se responde", () => {
  it("desde la direccion a la que escribio la persona, si es del dominio del canal", () => {
    expect(replyFromAddress({ to: ["Soporte <soporte@negocio.test>"] }, "hola@negocio.test")).toBe("soporte@negocio.test");
    expect(replyFromAddress({ to: ["otra@cliente.test"], cc: ["ventas@negocio.test"] }, "hola@negocio.test")).toBe("ventas@negocio.test");
  });

  it("nunca desde otro dominio: cae a la principal", () => {
    expect(replyFromAddress({ to: ["alguien@otro.test"] }, "hola@negocio.test")).toBe("hola@negocio.test");
  });

  it("sin entrante previo (escribir primero): la principal", () => {
    expect(replyFromAddress(null, "hola@negocio.test")).toBe("hola@negocio.test");
  });
});

describe("pickOurAddress / inboundToLabel", () => {
  it("la primera del dominio", () => {
    expect(pickOurAddress(["a@x.test", "b@negocio.test"], "negocio.test")).toBe("b@negocio.test");
    expect(pickOurAddress(["a@x.test"], null)).toBeNull();
  });

  it("la etiqueta 'para:' de la bandeja", () => {
    expect(inboundToLabel(["Soporte <soporte@negocio.test>"], "hola@negocio.test")).toBe("soporte@negocio.test");
    expect(inboundToLabel(null, "hola@negocio.test")).toBeNull();
    expect(inboundToLabel(["a@x.test"], null)).toBe("a@x.test");
  });
});
