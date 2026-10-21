import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CONTACT_STATUSES,
  deriveLastStatus,
  newStatusKey,
  parseLastStatusParam,
  parseStatusSettings,
  statusDraftError,
  statusItemsMoved,
  statusItemsWithArchived,
  statusItemsWithDraft,
  statusName,
  validateStatusesUpdate,
  type ContactStatus,
} from "./statuses";

describe("los estados por defecto", () => {
  // La 00245 los tiene en su funcion; la 00248, como literal del DEFAULT de la columna (un DEFAULT
  // que llama a una funcion sin permisos rompia el alta de un workspace).
  it.each(["00245_contact_statuses.sql", "00248_contact_status_settings_default.sql"])("son los mismos en el código y en %s", (file) => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
    const match = /\$defaults\$([\s\S]*?)\$defaults\$/.exec(sql);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(DEFAULT_CONTACT_STATUSES);
  });
});

describe("parseStatusSettings", () => {
  it("sin nada guardado, los estados por defecto", () => {
    expect(parseStatusSettings(null)).toEqual(DEFAULT_CONTACT_STATUSES);
    expect(parseStatusSettings({})).toEqual(DEFAULT_CONTACT_STATUSES);
  });

  it("una lista vacía a propósito se respeta", () => {
    expect(parseStatusSettings({ setter: [], closer: [] })).toEqual({ setter: [], closer: [] });
  });

  it("descarta las entradas inválidas y las claves repetidas", () => {
    const parsed = parseStatusSettings({
      setter: [
        { key: "a_1", name: "Uno", color: "#2563eb", archived_at: null },
        { key: "a_1", name: "Repetido", color: "#2563eb", archived_at: null },
        { key: "X", name: "Clave mala", color: "#2563eb", archived_at: null },
        { key: "b_2", name: "", color: "#2563eb", archived_at: null },
      ],
    });
    expect(parsed.setter.map((s) => s.key)).toEqual(["a_1"]);
    expect(parsed.closer).toEqual(DEFAULT_CONTACT_STATUSES.closer);
  });
});

describe("deriveLastStatus (gemela de set_contact_status)", () => {
  it("gana el de fecha más reciente", () => {
    expect(
      deriveLastStatus({
        setter_status: "calificado", setter_status_at: "2026-10-21T10:00:00Z",
        closer_status: "ganado", closer_status_at: "2026-10-20T10:00:00Z",
      }),
    ).toEqual({ role: "setter", status: "calificado", at: "2026-10-21T10:00:00Z" });
  });

  it("con la misma fecha, el del vendedor", () => {
    expect(
      deriveLastStatus({
        setter_status: "calificado", setter_status_at: "2026-10-21T10:00:00Z",
        closer_status: "ganado", closer_status_at: "2026-10-21T10:00:00Z",
      })?.role,
    ).toBe("closer");
  });

  it("si se quita uno, queda el otro; sin ninguno, null", () => {
    expect(deriveLastStatus({ setter_status: null, setter_status_at: null, closer_status: "ganado", closer_status_at: "2026-10-01T00:00:00Z" })?.status).toBe("ganado");
    expect(deriveLastStatus({ setter_status: null, setter_status_at: null, closer_status: null, closer_status_at: null })).toBeNull();
  });
});

const list: ContactStatus[] = [
  { key: "nuevo", name: "Nuevo", color: "#64748b", archived_at: null },
  { key: "calificado", name: "Calificado", color: "#16a34a", archived_at: null },
  { key: "viejo", name: "Viejo", color: "#78716c", archived_at: "2026-01-01T00:00:00Z" },
];

describe("la lista en Ajustes", () => {
  it("un estado no se borra: hay que archivarlo", () => {
    expect(validateStatusesUpdate(list, list.slice(0, 2)).ok).toBe(false);
  });

  it("dos activos no pueden llamarse igual; uno archivado sí", () => {
    expect(validateStatusesUpdate(list, [...list, { key: "nuevo_2", name: "nuevo", color: "#2563eb", archived_at: null }]).ok).toBe(false);
    expect(validateStatusesUpdate(list, [...list, { key: "viejo_2", name: "Viejo", color: "#2563eb", archived_at: null }]).ok).toBe(true);
  });

  it("clave nueva sin tildes y sin chocar", () => {
    expect(newStatusKey("En conversación", [])).toBe("en_conversacion");
    expect(newStatusKey("Nuevo", ["nuevo"])).toBe("nuevo_2");
  });

  it("el nombre de uno archivado lo dice; una clave desconocida se ve tal cual", () => {
    expect(statusName(list, "viejo")).toBe("Viejo (archivado)");
    expect(statusName(list, "otro")).toBe("otro");
    expect(statusName(list, null)).toBe("—");
  });

  it("los armadores de la pantalla", () => {
    expect(statusItemsWithDraft(list, { name: "Agendado", color: "#7c3aed" }).at(-1)).toEqual({ name: "Agendado", color: "#7c3aed", archived: false });
    expect(statusItemsWithDraft(list, { key: "nuevo", name: "Recién llegado", color: "#2563eb" })[0]).toMatchObject({ key: "nuevo", name: "Recién llegado" });
    expect(statusItemsWithArchived(list, "nuevo", true)[0].archived).toBe(true);
    expect(statusItemsMoved(list, "calificado", -1).map((i) => i.key)).toEqual(["calificado", "nuevo", "viejo"]);
    expect(statusItemsMoved(list, "nuevo", -1).map((i) => i.key)).toEqual(["nuevo", "calificado", "viejo"]);
  });

  it("el borrador avisa un nombre repetido antes de mandarlo", () => {
    expect(statusDraftError({ name: "calificado", color: "#2563eb" }, list)).toMatch(/Ya hay/);
    expect(statusDraftError({ key: "calificado", name: "Calificado", color: "#2563eb" }, list)).toBeNull();
    expect(statusDraftError({ name: "  ", color: "#2563eb" }, list)).toBe("Poné un nombre");
  });
});

describe("parseLastStatusParam", () => {
  it("lee rol:clave y descarta lo inventado", () => {
    expect(parseLastStatusParam("setter:calificado")).toEqual({ role: "setter", key: "calificado" });
    expect(parseLastStatusParam("dueño:calificado")).toBeNull();
    expect(parseLastStatusParam("closer:")).toBeNull();
    expect(parseLastStatusParam(null)).toBeNull();
  });
});
