import { describe, it, expect } from "vitest";
import { activityActionLabel } from "./activity";

describe("activityActionLabel", () => {
  it("las tres acciones que de verdad escribe saveIntegration/disconnectIntegration", () => {
    expect(activityActionLabel("create")).toBe("Se conecto");
    expect(activityActionLabel("update")).toBe("Se actualizaron las credenciales");
    expect(activityActionLabel("delete")).toBe("Se desconecto");
  });

  it("una accion sin mapeo no rompe: devuelve el texto crudo", () => {
    expect(activityActionLabel("restore")).toBe("restore");
  });
});
