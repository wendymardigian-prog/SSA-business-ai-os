import { describe, expect, it } from "vitest";
import { fathomCardView, pickConnection, shouldNudgeToConnect, type FathomConnectionInfo } from "./connection-state";

const conn = (over: Partial<FathomConnectionInfo> = {}): FathomConnectionInfo => ({
  status: "active", account_label: "ana@negocio.io", last_synced_at: "2026-10-10T18:00:00Z", last_error: null, sync_last_error: null, ...over,
});
const base = { hasApp: true, connection: null, isCloser: true, callsLast7d: 0 };

describe("fathomCardView: los 5 estados", () => {
  it("falta la app: nada que hacer, se le pide a un admin", () => {
    const v = fathomCardView({ ...base, hasApp: false });
    expect(v.state).toBe("missing_app");
    expect(v.message).toContain("admin");
    expect(v.actions).toEqual({ connect: false, reconnect: false, syncNow: false, disconnect: false });
  });

  it("sin conectar: ofrece conectar", () => {
    const v = fathomCardView(base);
    expect(v.state).toBe("not_connected");
    expect(v.actions.connect).toBe(true);
    expect(v.actions.syncNow).toBe(false);
  });

  it("conectado: dice como quien, ofrece sincronizar y desconectar", () => {
    const v = fathomCardView({ ...base, connection: conn(), callsLast7d: 4 });
    expect(v.state).toBe("connected");
    expect(v.title).toBe("Conectado como ana@negocio.io");
    expect(v.callsLast7d).toBe(4);
    expect(v.actions).toEqual({ connect: false, reconnect: false, syncNow: true, disconnect: true });
  });

  it("con error: motivo en palabras y Reconectar; no ofrece sincronizar", () => {
    const v = fathomCardView({ ...base, connection: conn({ status: "error", last_error: "Fathom cortó el acceso: hay que reconectar" }) });
    expect(v.state).toBe("error");
    expect(v.message).toContain("reconectar");
    expect(v.actions).toEqual({ connect: false, reconnect: true, syncNow: false, disconnect: true });
  });

  it("no sos closer: puede conectar y se le avisa que sus llamadas no entran todavia", () => {
    const v = fathomCardView({ ...base, isCloser: false });
    expect(v.state).toBe("not_closer");
    expect(v.message).toContain("Equipo");
    expect(v.actions.connect).toBe(true);
  });

  it("no sos closer pero ya conectaste: sigue el aviso, y puede sincronizar o desconectar", () => {
    const v = fathomCardView({ ...base, isCloser: false, connection: conn() });
    expect(v.state).toBe("not_closer");
    expect(v.connected).toBe(true);
    expect(v.actions).toMatchObject({ connect: false, syncNow: true, disconnect: true });
  });

  it("la falta de la app gana sobre todo lo demas", () => {
    expect(fathomCardView({ ...base, hasApp: false, isCloser: false, connection: conn({ status: "error" }) }).state).toBe("missing_app");
  });

  it("una conexion revocada es como no tener ninguna", () => {
    expect(fathomCardView({ ...base, connection: conn({ status: "revoked" }) }).state).toBe("not_connected");
  });

  it("un problema de la ultima consulta (429) se muestra sin tumbar el estado", () => {
    const v = fathomCardView({ ...base, connection: conn({ sync_last_error: "Fathom pidió esperar" }) });
    expect(v.state).toBe("connected");
    expect(v.syncWarning).toBe("Fathom pidió esperar");
  });
});

describe("pickConnection / shouldNudgeToConnect", () => {
  it("elige la viva; si no hay, la que cayo; revocadas no cuentan", () => {
    expect(pickConnection([conn({ status: "revoked" }), conn({ account_label: "viva" })])?.account_label).toBe("viva");
    expect(pickConnection([conn({ status: "revoked" }), conn({ status: "error", account_label: "caida" })])?.account_label).toBe("caida");
    expect(pickConnection([conn({ status: "revoked" })])).toBeNull();
  });
  it("avisa solo a un closer sin conexion viva y con la app cargada", () => {
    expect(shouldNudgeToConnect({ isCloser: true, hasLiveConnection: false, hasApp: true })).toBe(true);
    expect(shouldNudgeToConnect({ isCloser: true, hasLiveConnection: true, hasApp: true })).toBe(false);
    expect(shouldNudgeToConnect({ isCloser: false, hasLiveConnection: false, hasApp: true })).toBe(false);
    expect(shouldNudgeToConnect({ isCloser: true, hasLiveConnection: false, hasApp: false })).toBe(false);
  });
});
