import { describe, expect, it } from "vitest";
import { requestIp } from "./client-ip";

describe("requestIp", () => {
  it("gana X-Real-IP, que el borde de Railway pisa con la IP real", () => {
    const headers = new Headers({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1, 8.8.8.8" });
    expect(requestIp(headers)).toBe("8.8.8.8");
  });

  it("un X-Forwarded-For inventado no cambia la IP si está X-Real-IP", () => {
    const a = requestIp(new Headers({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" }));
    const b = requestIp(new Headers({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "2.2.2.2" }));
    expect(a).toBe(b);
  });

  it("sin X-Real-IP, el primer valor de X-Forwarded-For es el respaldo", () => {
    expect(requestIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });

  it("recorta espacios y descarta vacíos", () => {
    expect(requestIp(new Headers({ "x-real-ip": "  7.7.7.7 " }))).toBe("7.7.7.7");
    expect(requestIp(new Headers({ "x-real-ip": "   ", "x-forwarded-for": "6.6.6.6" }))).toBe("6.6.6.6");
  });

  it("sin encabezados, null", () => {
    expect(requestIp(new Headers())).toBeNull();
  });

  it("un valor absurdamente largo no se toma como IP", () => {
    expect(requestIp(new Headers({ "x-real-ip": "x".repeat(200) }))).toBeNull();
  });
});
