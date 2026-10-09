import { describe, it, expect } from "vitest";
import { readWorkspaceSpendSettings } from "./spend-settings";

describe("readWorkspaceSpendSettings", () => {
  it("una fila sin los datos nuevos (o sin fila) deja todo como antes: corta, sin aviso previo", () => {
    expect(readWorkspaceSpendSettings(null)).toEqual({
      dailyUsd: null, dailyAction: "disable", monthlyUsd: null, monthlyAction: "disable", alertPct: null,
    });
    expect(readWorkspaceSpendSettings({ ai_daily_cost_limit_usd: 10, ai_monthly_cost_limit_usd: 200 })).toEqual({
      dailyUsd: 10, dailyAction: "disable", monthlyUsd: 200, monthlyAction: "disable", alertPct: null,
    });
  });

  it("los numeric de la base llegan como string: se convierten", () => {
    expect(readWorkspaceSpendSettings({ ai_daily_cost_limit_usd: "10.50", ai_monthly_cost_limit_usd: "" }))
      .toMatchObject({ dailyUsd: 10.5, monthlyUsd: null });
  });

  it("'notify' expreso solo avisa; cualquier otra cosa corta", () => {
    expect(readWorkspaceSpendSettings({ ai_daily_limit_action: "notify", ai_monthly_limit_action: "raro" }))
      .toMatchObject({ dailyAction: "notify", monthlyAction: "disable" });
  });

  it("el porcentaje de aviso solo vale de 1 a 99", () => {
    expect(readWorkspaceSpendSettings({ ai_spend_alert_pct: 80 }).alertPct).toBe(80);
    expect(readWorkspaceSpendSettings({ ai_spend_alert_pct: 100 }).alertPct).toBeNull();
    expect(readWorkspaceSpendSettings({ ai_spend_alert_pct: 0 }).alertPct).toBeNull();
  });
});
