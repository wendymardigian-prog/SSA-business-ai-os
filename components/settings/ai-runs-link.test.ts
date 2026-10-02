import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiRunsLink } from "./ai-runs-link";
import { AI_RUNS_HREF } from "@/lib/settings/general-sections";

/**
 * S7: el link a Corridas aparece con `ai_costs.view` y no aparece sin ella.
 * `renderToStaticMarkup` (sin jsdom) alcanza porque `AiRunsLink` no usa
 * `useRouter`/`usePathname`; `SettingsView` sí (por `SettingsTabs` y
 * `SectionNav`) y no se puede renderizar fuera del árbol de Next.
 */
describe("AiRunsLink (S7)", () => {
  it("aparece cuando la persona tiene ai_costs.view", () => {
    const html = renderToStaticMarkup(createElement(AiRunsLink, { canView: true }));
    expect(html).toContain("Ver corridas de IA");
    expect(html).toContain(`href="${AI_RUNS_HREF}"`);
  });

  it("no aparece cuando no tiene el permiso", () => {
    const html = renderToStaticMarkup(createElement(AiRunsLink, { canView: false }));
    expect(html).toBe("");
  });
});
