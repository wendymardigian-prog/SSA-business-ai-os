import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caracterizacion del Realtime de la lista de conversaciones (Bloque I, I6).
 *
 * El Bloque I saca el buscador y los filtros de `conversation-list.tsx`, y la
 * regla es que el Realtime quede IDENTICO: mismo canal, mismo respiro de
 * 800 ms, mismo merge en el cliente cuando la fila sigue cumpliendo el filtro.
 *
 * Vitest corre en `node` y el proyecto no tiene tests de componentes, asi que
 * esto caracteriza el codigo fuente: el bloque entero se compara contra la
 * copia literal tomada antes de tocar el archivo
 * (`__fixtures__/conversation-list-realtime.txt`). Si alguien lo edita, aunque
 * sea un espacio, este test lo dice. Cambiarlo a proposito es actualizar la
 * copia en el mismo commit, a la vista.
 */

const ROOT = resolve(__dirname, "../..");
const SOURCE = readFileSync(resolve(ROOT, "components/inbox/conversation-list.tsx"), "utf8");
const FIXTURE = readFileSync(
  resolve(__dirname, "__fixtures__/conversation-list-realtime.txt"),
  "utf8",
);

const START = "  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);";
const END = "  }, [workspaceId, filters, dateRange, router]);";

function realtimeBlock(source: string): string | null {
  const from = source.indexOf(START);
  if (from === -1) return null;
  const to = source.indexOf(END, from);
  if (to === -1) return null;
  return source.slice(from, to + END.length) + "\n";
}

describe("Realtime de la bandeja (caracterizacion, I6)", () => {
  it("el bloque del Realtime es identico al de antes del Bloque I", () => {
    expect(realtimeBlock(SOURCE)).toBe(FIXTURE);
  });

  it("el respiro antes de volver a preguntar al servidor sigue siendo 800 ms", () => {
    expect(SOURCE).toContain("const REFRESH_DEBOUNCE_MS = 800;");
  });

  it("escucha el mismo canal, la misma tabla y solo el workspace", () => {
    expect(FIXTURE).toContain('.channel("conversations-updates")');
    expect(FIXTURE).toContain('table: "conversations"');
    expect(FIXTURE).toContain("filter: `workspace_id=eq.${workspaceId}`");
  });

  it("decide con las mismas reglas puras de lib/inbox/filters", () => {
    expect(FIXTURE).toContain("needsServerToFilter(filters)");
    expect(FIXTURE).toContain("matchesInboxRow(merged, filters, dateRange)");
    expect(SOURCE).toMatch(/import \{[^}]*matchesInboxRow[^}]*needsServerToFilter[^}]*\} from "@\/lib\/inbox\/filters"/);
  });

  it("reordena por ultimo mensaje y, si no hay, por creacion", () => {
    expect(FIXTURE).toContain("a.last_message_at ?? a.created_at");
  });

  it("la lista se sigue re-sembrando con lo que trae el servidor", () => {
    expect(SOURCE).toContain(
      "useEffect(() => {\n    setConversations(initialConversations);\n  }, [initialConversations]);",
    );
  });
});
