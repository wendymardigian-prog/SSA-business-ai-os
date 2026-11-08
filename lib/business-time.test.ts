import { describe, expect, it } from "vitest";
import { convertWallTime, convertedTimeText, sameClock, zoneLabel, zoneName } from "./business-time";

const BA = "America/Argentina/Buenos_Aires";
const MADRID = "Europe/Madrid";
const NY = "America/New_York";
const CR = "America/Costa_Rica";

describe("zoneName / zoneLabel", () => {
  it("el último tramo, sin guiones bajos", () => {
    expect(zoneName(BA)).toBe("Buenos Aires");
    expect(zoneName("America/Costa_Rica")).toBe("Costa Rica");
    expect(zoneName("UTC")).toBe("UTC");
  });
  it("con la diferencia con UTC de ese día", () => {
    expect(zoneLabel(BA, new Date("2026-11-09T12:00:00Z"))).toBe("Buenos Aires (GMT-3)");
    expect(zoneLabel("UTC")).toBe("UTC");
  });
});

describe("sameClock", () => {
  it("dos nombres de la misma hora cuentan como iguales", () => {
    expect(sameClock(BA, "America/Buenos_Aires")).toBe(true);
    expect(sameClock(BA, MADRID)).toBe(false);
  });
});

describe("convertWallTime", () => {
  it("las 9 de Buenos Aires son las 13 en Madrid en noviembre", () => {
    expect(convertWallTime("09:00", BA, MADRID, new Date("2026-11-09T12:00:00Z"))).toEqual({ time: "13:00", dayShift: 0 });
  });
  it("marca cuando cae el día siguiente o el anterior", () => {
    expect(convertWallTime("22:00", BA, MADRID, new Date("2026-11-09T12:00:00Z"))).toEqual({ time: "02:00", dayShift: 1 });
    expect(convertWallTime("01:00", MADRID, BA, new Date("2026-11-09T12:00:00Z"))).toEqual({ time: "21:00", dayShift: -1 });
  });
  it("respeta el horario de verano del día de referencia", () => {
    // Costa Rica no cambia la hora; Nueva York sí (el 1/11/2026).
    expect(convertWallTime("09:00", CR, NY, new Date("2026-10-20T15:00:00Z"))?.time).toBe("11:00");
    expect(convertWallTime("09:00", CR, NY, new Date("2026-11-20T15:00:00Z"))?.time).toBe("10:00");
  });
  it("una hora que no sirve no se convierte", () => {
    expect(convertWallTime("9", BA, MADRID)).toBeNull();
  });
});

describe("convertedTimeText", () => {
  it("dice el día cuando cambia", () => {
    expect(convertedTimeText({ time: "13:00", dayShift: 0 })).toBe("13:00");
    expect(convertedTimeText({ time: "02:00", dayShift: 1 })).toBe("02:00 (del día siguiente)");
    expect(convertedTimeText({ time: "21:00", dayShift: -1 })).toBe("21:00 (del día anterior)");
  });
});
