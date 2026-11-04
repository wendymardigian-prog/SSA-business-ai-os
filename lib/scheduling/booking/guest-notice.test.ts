import { describe, expect, it } from "vitest";
import { confirmationSettingsPath, guestNotice, hasActiveConfirmation } from "./guest-notice";

const noEvent = { eventTypeId: null, hostUserId: "u1", categoryId: "area-1" };
const withEvent = { eventTypeId: "ev-1", hostUserId: "u1", categoryId: "area-1" };

describe("hasActiveConfirmation", () => {
  it("sin flujos prendidos, no hay confirmacion", () => {
    expect(hasActiveConfirmation([], withEvent)).toBe(false);
  });

  it("el flujo de un evento vale solo para ese evento", () => {
    const configs = [{ event_type_ids: ["ev-1"] }];
    expect(hasActiveConfirmation(configs, withEvent)).toBe(true);
    expect(hasActiveConfirmation(configs, { ...withEvent, eventTypeId: "ev-2" })).toBe(false);
    expect(hasActiveConfirmation(configs, noEvent)).toBe(false);
  });

  it("el flujo de reuniones sin evento vale solo sin evento", () => {
    const configs = [{ no_event: true }];
    expect(hasActiveConfirmation(configs, noEvent)).toBe(true);
    expect(hasActiveConfirmation(configs, withEvent)).toBe(false);
  });

  it("respeta los filtros de origen, anfitrion y area", () => {
    expect(hasActiveConfirmation([{ origins: ["public_page"] }], withEvent)).toBe(false);
    expect(hasActiveConfirmation([{ origins: ["manual"] }], withEvent)).toBe(true);
    expect(hasActiveConfirmation([{ host_user_ids: ["otro"] }], withEvent)).toBe(false);
    expect(hasActiveConfirmation([{ category_ids: ["area-2"] }], withEvent)).toBe(false);
    expect(hasActiveConfirmation([{ category_ids: ["area-1"] }], withEvent)).toBe(true);
  });
});

describe("guestNotice", () => {
  it("sin email no le llega nada, aunque todo este prendido", () => {
    expect(guestNotice({ googleAvailable: true, confirmationOn: true, hasEmail: false })).toMatchObject({ google: false, email: "no_address" });
  });

  it("cada combinacion dice lo que pasa", () => {
    expect(guestNotice({ googleAvailable: true, confirmationOn: true, hasEmail: true }).summary).toContain("invitación de Google Calendar y el email");
    expect(guestNotice({ googleAvailable: true, confirmationOn: false, hasEmail: true })).toMatchObject({ google: true, email: "off" });
    expect(guestNotice({ googleAvailable: false, confirmationOn: true, hasEmail: true })).toMatchObject({ google: false, email: "on" });
    expect(guestNotice({ googleAvailable: false, confirmationOn: false, hasEmail: true }).summary).toContain("ningún aviso");
  });
});

describe("confirmationSettingsPath", () => {
  it("lleva a los flujos del evento o a la seccion sin evento", () => {
    expect(confirmationSettingsPath("ev-1")).toBe("/dashboard/agenda/configuracion/eventos/ev-1?seccion=flows");
    expect(confirmationSettingsPath(null)).toBe("/dashboard/agenda/configuracion/sin-evento");
  });
});
