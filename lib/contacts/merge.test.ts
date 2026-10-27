import { describe, expect, it } from "vitest";
import { CONTACT_MERGE_EXCLUSIONS, CONTACT_MERGE_TABLES, decodeMergeParam, encodeMergeParam, findMergeDrift, mergeErrorMessage, mergeNotes, summarizeMerge } from "./merge";

describe("CONTACT_MERGE_TABLES (R9)", () => {
  it("son 25 (la 00247 suma el historial de estados), sin duplicados, y ninguna esta tambien en las exclusiones", () => {
    expect(CONTACT_MERGE_TABLES).toHaveLength(25); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(CONTACT_MERGE_TABLES).toHaveLength(19);
    expect(new Set(CONTACT_MERGE_TABLES).size).toBe(CONTACT_MERGE_TABLES.length);
    for (const t of CONTACT_MERGE_TABLES) expect(Object.keys(CONTACT_MERGE_EXCLUSIONS)).not.toContain(t);
  });
  it("cada exclusion explica su motivo", () => {
    for (const [table, reason] of Object.entries(CONTACT_MERGE_EXCLUSIONS)) expect(reason.length, table).toBeGreaterThan(10);
  });
});

describe("summarizeMerge", () => {
  it("singular y plural, solo lo que no es cero, en un orden estable", () => {
    expect(summarizeMerge({ moved: { tasks: 3, bookings: 1, conversations: 1, conversations_merged: 1, sales: 1, calls: 0 } })).toBe("Se unificaron 2 conversaciones, 1 agenda, 1 venta y 3 tareas."); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    expect(summarizeMerge({ moved: { sales: 1 } })).toBe("Se unificaron 1 venta."); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(summarizeMerge({ moved: { contact_tags: 3, bookings: 1, conversations: 1, conversations_merged: 1, email_log: 0 } })).toBe("Se unificaron 2 conversaciones, 1 agenda y 3 etiquetas.");
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(summarizeMerge({ moved: { bookings: 1 } })).toBe("Se unificaron 1 agenda.");
    expect(summarizeMerge({ moved: { messages_moved: 12, contact_notes: 2 } })).toBe("Se unificaron 12 mensajes y 2 notas.");
  });
  it("el orden no depende del orden de las claves", () => {
    expect(summarizeMerge({ moved: { tasks: 1, bookings: 2 } })).toBe(summarizeMerge({ moved: { bookings: 2, tasks: 1 } }));
  });
  it("acepta el resultado entero o solo el conteo", () => {
    expect(summarizeMerge({ tasks: 2 })).toBe("Se unificaron 2 tareas."); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(summarizeMerge({ bookings: 2 })).toBe("Se unificaron 2 agendas.");
  });
  it("sin nada para mover, lo dice", () => {
    expect(summarizeMerge({ moved: {} })).toContain("no había nada más para mover");
    expect(summarizeMerge(null)).toContain("no había nada más para mover");
    expect(summarizeMerge({ moved: { tasks: -1, sales: Number.NaN, calls: "x" as unknown as number } })).toContain("no había nada más");
  });
  it("un conteo roto no se cuela", () => {
    expect(summarizeMerge({ moved: { tasks: 2.9 } })).toBe("Se unificaron 2 tareas."); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(summarizeMerge({ moved: { bookings: 2.9 } })).toBe("Se unificaron 2 agendas.");
  });
});

describe("mergeNotes", () => {
  it("cuenta lo que se cancelo o quedo aparte", () => {
    expect(mergeNotes({ moved: { sequence_enrollments_cancelled: 1, flow_sessions_cancelled: 2, tasks_detached: 1, messages_left: 3 } })).toEqual([
      "Se canceló 1 inscripción repetida a una secuencia.",
      "Se cancelaron 2 sesiones de automatización repetidas.",
      "1 tarea de seguimiento quedó como tarea normal (ya había otra para esa fecha).",
      "3 mensajes repetidos quedaron en la conversación vieja.",
    ]);
    expect(mergeNotes({ moved: {} })).toEqual([]);
  });
});

describe("el resultado viaja en la URL sin texto libre", () => {
  it("ida y vuelta de las claves conocidas", () => {
    const param = encodeMergeParam({ conversations: 2, tasks: 3, unknown_key: 9, sales: 0 }); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    expect(param).toBe("conversations.2,tasks.3"); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    expect(decodeMergeParam(param)).toEqual({ conversations: 2, tasks: 3 }); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): const param = encodeMergeParam({ conversations: 2, bookings: 3, unknown_key: 9, contact_tags: 0 });
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(param).toBe("conversations.2,bookings.3");
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(decodeMergeParam(param)).toEqual({ conversations: 2, bookings: 3 });
  });
  it("lo que no es una clave conocida o un numero se ignora", () => {
    expect(decodeMergeParam("<script>.1,tasks.abc,sales.-2,bookings.1")).toEqual({ bookings: 1 });
    expect(decodeMergeParam(undefined)).toEqual({});
    expect(decodeMergeParam(["tasks.1", "sales.2"])).toEqual({ tasks: 1 }); // @plantilla-quitar(tareas,ventas,llamadas,formularios,webhooks)
    // @plantilla-sin(tareas,ventas,llamadas,formularios,webhooks): expect(decodeMergeParam(["bookings.1", "contact_tags.2"])).toEqual({ bookings: 1 });
  });
});

describe("mergeErrorMessage", () => {
  it("traduce los codigos de la funcion de base", () => {
    expect(mergeErrorMessage("merge_same_contact")).toBe("Es el mismo contacto");
    expect(mergeErrorMessage("merge_not_found")).toContain("No encontre");
    expect(mergeErrorMessage("merge_deleted")).toContain("No encontre");
    expect(mergeErrorMessage("merge_workspace_mismatch")).toContain("mismo negocio");
    expect(mergeErrorMessage("algo raro")).toContain("No se movió nada");
  });
});

describe("la guardia de deriva (findMergeDrift)", () => {
  it("con exactamente las tablas cubiertas no hay nada que avisar", () => {
    expect(findMergeDrift(CONTACT_MERGE_TABLES)).toEqual({ missing: [], stale: [] });
  });
  it("una relacion nueva con contacts hace fallar la guardia: dice cual falta", () => {
    expect(findMergeDrift([...CONTACT_MERGE_TABLES, "invoices", "appointments"])).toEqual({ missing: ["appointments", "invoices"], stale: [] });
  });
  it("una tabla de la lista que ya no existe tambien se avisa", () => {
    expect(findMergeDrift(CONTACT_MERGE_TABLES.filter((t) => t !== "tasks"))).toEqual({ missing: [], stale: ["tasks"] }); // @plantilla-quitar(tareas)
    // @plantilla-sin(tareas): expect(findMergeDrift(CONTACT_MERGE_TABLES.filter((t) => t !== "email_log"))).toEqual({ missing: [], stale: ["email_log"] });
  });
});
