import { describe, it, expect } from "vitest";
import { defaultDashboard } from "./default";

const todo = () => true;
const nada = () => false;
const solo = (...keys: string[]) => (p: string) => keys.includes(p);

describe("el dashboard que se abre por defecto", () => {
  it("con Meta Ads conectado, abre Meta Ads", () => {
    expect(defaultDashboard({ can: todo, adsConnected: true })).toBe("/dashboard/dashboards/ads");
  });

  it("sin Meta Ads conectado, abre Chat", () => {
    expect(defaultDashboard({ can: todo, adsConnected: false })).toBe("/dashboard/dashboards/chat");
  });

  it("conectado pero sin permiso de anuncios, abre Chat", () => {
    expect(defaultDashboard({ can: solo("dashboards.chat.view"), adsConnected: true })).toBe("/dashboard/dashboards/chat");
  });

  it("conectado y solo con permiso de anuncios, abre Meta Ads", () => {
    expect(defaultDashboard({ can: solo("dashboards.ads.view"), adsConnected: true })).toBe("/dashboard/dashboards/ads");
  });

  it("sin permiso de Chat ni conexion, abre el primero que pueda ver", () => {
    expect(defaultDashboard({ can: solo("dashboards.agenda.view"), adsConnected: false })).toBe("/dashboard/dashboards/agenda");
    // Anuncios sin conexion tampoco es Chat: es lo unico que ve.
    expect(defaultDashboard({ can: solo("dashboards.ads.view"), adsConnected: false })).toBe("/dashboard/dashboards/ads");
  });

  it("sin ningun dashboard, cae en Mi cuenta (nunca en /dashboard, que redirige aca)", () => {
    expect(defaultDashboard({ can: nada, adsConnected: true })).toBe("/dashboard/cuenta");
    expect(defaultDashboard({ can: nada, adsConnected: false })).toBe("/dashboard/cuenta");
  });
});
