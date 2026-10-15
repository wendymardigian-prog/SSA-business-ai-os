import { describe, expect, it } from "vitest";
import { suggestSaleTouch, type SuggestTouchInput } from "./suggest-touch";

const t = (id: string, occurred_at: string, channel: string | null, extra: Partial<SuggestTouchInput> = {}): SuggestTouchInput => ({ id, occurred_at, channel, ...extra });

describe("suggestSaleTouch (los casos del plano F46)", () => {
  it("[organico A (1/10), directo (5/10)]: sugiere A, motivo last_is_direct", () => {
    expect(suggestSaleTouch([t("A", "2026-10-01T10:00:00Z", "organic"), t("D", "2026-10-05T10:00:00Z", "direct")])).toEqual({ touchId: "A", reason: "last_is_direct" });
  });

  it("[directo]: sugiere el ultimo (no hay otro), motivo only_touch", () => {
    expect(suggestSaleTouch([t("D", "2026-10-05T10:00:00Z", "direct")])).toEqual({ touchId: "D", reason: "only_touch" });
  });

  it("[pauta B (2/10), organico A (1/10)]: sugiere B, motivo last_touch", () => {
    expect(suggestSaleTouch([t("A", "2026-10-01T10:00:00Z", "organic"), t("B", "2026-10-02T10:00:00Z", "paid")])).toEqual({ touchId: "B", reason: "last_touch" });
  });
});

describe("suggestSaleTouch (otros casos)", () => {
  it("sin toques: null", () => {
    expect(suggestSaleTouch([])).toBeNull();
    expect(suggestSaleTouch(null)).toBeNull();
    expect(suggestSaleTouch(undefined)).toBeNull();
  });

  it("un solo toque con origen tambien es only_touch", () => {
    expect(suggestSaleTouch([t("A", "2026-10-01T10:00:00Z", "organic")])).toEqual({ touchId: "A", reason: "only_touch" });
  });

  it("varios directos y ninguno con origen: el ultimo, last_touch", () => {
    expect(suggestSaleTouch([t("D1", "2026-10-01T10:00:00Z", "direct"), t("D2", "2026-10-03T10:00:00Z", "direct")])).toEqual({ touchId: "D2", reason: "last_touch" });
  });

  it("directo al final: sugiere el ULTIMO con origen, no el primero", () => {
    const touches = [
      t("A", "2026-10-01T10:00:00Z", "organic"),
      t("R", "2026-10-03T10:00:00Z", "referral"),
      t("D1", "2026-10-04T10:00:00Z", "direct"),
      t("D2", "2026-10-06T10:00:00Z", "direct"),
    ];
    expect(suggestSaleTouch(touches)).toEqual({ touchId: "R", reason: "last_is_direct" });
  });

  it("un referido tambien cuenta como origen", () => {
    expect(suggestSaleTouch([t("R", "2026-10-01T10:00:00Z", "referral"), t("D", "2026-10-02T10:00:00Z", "direct")])).toEqual({ touchId: "R", reason: "last_is_direct" });
  });

  it("no depende del orden en que llegan", () => {
    const a = t("A", "2026-10-01T10:00:00Z", "organic");
    const d = t("D", "2026-10-05T10:00:00Z", "direct");
    expect(suggestSaleTouch([d, a])).toEqual(suggestSaleTouch([a, d]));
  });

  it("desempata por created_at y por id como record_contact_touch", () => {
    const same = "2026-10-01T10:00:00Z";
    const first = t("a", same, "direct", { created_at: "2026-10-01T10:00:01Z" });
    const second = t("b", same, "organic", { created_at: "2026-10-01T10:00:09Z" });
    expect(suggestSaleTouch([first, second])).toEqual({ touchId: "b", reason: "last_touch" });
    const x = t("x", same, "direct", { created_at: same });
    const y = t("y", same, "organic", { created_at: same });
    expect(suggestSaleTouch([x, y])).toEqual({ touchId: "y", reason: "last_touch" });
  });

  it("si el toque no trae canal, lo calcula", () => {
    const organico = t("A", "2026-10-01T10:00:00Z", null, { origin: "comment", medium: "comment" });
    const directo = t("D", "2026-10-05T10:00:00Z", null, { origin: "form" });
    expect(suggestSaleTouch([organico, directo])).toEqual({ touchId: "A", reason: "last_is_direct" });
    const pauta = t("P", "2026-10-06T10:00:00Z", "no-es-canal", { gclid: "x" });
    expect(suggestSaleTouch([organico, directo, pauta])).toEqual({ touchId: "P", reason: "last_touch" });
  });
});
