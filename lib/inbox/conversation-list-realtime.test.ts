import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * El tiempo real de la lista de la bandeja (27/11/2026).
 *
 * Antes cualquier cambio que no fuera una fila a la vista volvia a pedir la
 * PAGINA ENTERA (unas diez consultas) en cada pestaña abierta. Ahora se pregunta
 * por id, en tandas. Vitest corre en `node` y el proyecto no tiene tests de
 * componentes, asi que esto fija el contrato leyendo el codigo; las reglas en si
 * (que entra, que sale, en que orden) estan probadas en `list-merge.test.ts` y
 * `list-cursor.test.ts`.
 */

const ROOT = resolve(__dirname, "../..");
const HOOK = readFileSync(resolve(ROOT, "components/inbox/use-inbox-list.ts"), "utf8");
const LIST = readFileSync(resolve(ROOT, "components/inbox/conversation-list.tsx"), "utf8");

describe("tiempo real de la bandeja", () => {
  it("escucha el mismo canal, la misma tabla y solo el workspace", () => {
    expect(HOOK).toContain('.channel("conversations-updates")');
    expect(HOOK).toContain('table: "conversations"');
    expect(HOOK).toContain("filter: `workspace_id=eq.${workspaceId}`");
  });

  it("junta los cambios 800 ms y pregunta por id, no por la pagina entera", () => {
    expect(HOOK).toContain("export const LIVE_BATCH_MS = 800;");
    expect(HOOK).toContain("loadConversationsByIds(query, ids)");
  });

  it("solo vuelve a pedir la pagina si falla la pregunta por id, tras un corte o tras un rato en segundo plano", () => {
    const refreshes = HOOK.match(/router\.refresh\(\)/g) ?? [];
    expect(refreshes.length).toBe(4);
    expect(LIST).not.toMatch(/scheduleRefresh|REFRESH_DEBOUNCE_MS/);
  });

  it("decide con las mismas reglas puras de lib/inbox/filters y la misma regla de orden", () => {
    expect(HOOK).toContain("matchesInboxRow(merged, currentFilters, rangeRef.current)");
    expect(HOOK).toContain("needsServerToFilter(currentFilters)");
    expect(HOOK).toContain("mergeVisibleUpdate(state.rows, merged)");
  });

  it("lo que cae mas abajo de lo cargado no se pregunta", () => {
    expect(HOOK).toContain("isAfterCursor(");
  });

  it("la lista ya no tiene paginas", () => {
    expect(LIST).not.toMatch(/Página \{page\}|onPageChange|PageButton/);
    expect(LIST).toContain("IntersectionObserver");
  });
});
