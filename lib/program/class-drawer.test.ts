import { describe, expect, it } from "vitest";
import { classHref, classSections, listTabFrom, noteToStore, parseClassRef, programClassHref, withClassRef, withListTab } from "./class-drawer";

const S = "11111111-2222-4333-8444-555555555555";

describe("listTabFrom", () => {
  it("solo «pasadas» abre Pasadas", () => {
    expect(listTabFrom("pasadas")).toBe("pasadas");
    expect(listTabFrom(null)).toBe("proximas");
    expect(listTabFrom("otra")).toBe("proximas");
  });
});

describe("parseClassRef", () => {
  it("acepta una sesión y una fecha válidas", () => {
    expect(parseClassRef(S, "2026-11-30")).toEqual({ sessionId: S, occursOn: "2026-11-30" });
  });
  it("un link roto no abre nada", () => {
    expect(parseClassRef(S, null)).toBeNull();
    expect(parseClassRef("x", "2026-11-30")).toBeNull();
    expect(parseClassRef(S, "2026-13-01")).toBeNull();
    expect(parseClassRef(S, "30/11/2026")).toBeNull();
  });
});

describe("la URL", () => {
  it("pone y saca la clase sin tocar el resto", () => {
    const q = withClassRef("tab=calendario&vista=lista", { sessionId: S, occursOn: "2026-11-30" });
    expect(new URLSearchParams(q).get("sesion")).toBe(S);
    expect(new URLSearchParams(q).get("vista")).toBe("lista");
    expect(withClassRef(q, null)).toBe("tab=calendario&vista=lista");
  });
  it("Próximas no deja parámetro", () => {
    expect(withListTab("tab=calendario&lista=pasadas", "proximas")).toBe("tab=calendario");
    expect(withListTab("tab=calendario", "pasadas")).toBe("tab=calendario&lista=pasadas");
  });
  it("los links a una clase", () => {
    expect(classHref({ sessionId: S, occursOn: "2026-11-30" })).toBe(`/dashboard/portal/clase?sesion=${S}&fecha=2026-11-30`);
    expect(programClassHref("p1", { sessionId: S, occursOn: "2026-11-30" }, true)).toBe(`/dashboard/portal/p1?tab=calendario&vista=lista&lista=pasadas&sesion=${S}&fecha=2026-11-30`);
  });
});

describe("classSections", () => {
  const base = { started: false, status: "normal" as const, canManage: true, canSeeTasks: true };
  it("una próxima: entrar, notas y tareas; sin grabación ni asistencia", () => {
    expect(classSections(base)).toEqual({ enter: true, menu: true, notes: "edit", tasks: true, recording: false, attendance: false });
  });
  it("una pasada: grabación y asistencia, sin entrar", () => {
    const s = classSections({ ...base, started: true });
    expect(s.enter).toBe(false);
    expect(s.recording && s.attendance).toBe(true);
  });
  it("una cancelada no tiene entrar, grabación ni asistencia", () => {
    const s = classSections({ ...base, started: true, status: "cancelled" });
    expect([s.enter, s.recording, s.attendance]).toEqual([false, false, false]);
    expect(classSections({ ...base, status: "cancelled" }).enter).toBe(false);
  });
  it("sin permisos: notas de lectura, sin menú ni tareas", () => {
    const s = classSections({ ...base, canManage: false, canSeeTasks: false });
    expect([s.menu, s.notes, s.tasks]).toEqual([false, "read", false]);
  });
});

describe("noteToStore", () => {
  it("unas notas vacías se guardan como null", () => {
    expect(noteToStore("<p></p>")).toBeNull();
    expect(noteToStore("<p>&nbsp;</p>")).toBeNull();
    expect(noteToStore("<p><strong>Hola</strong></p>")).toBe("<p><strong>Hola</strong></p>");
  });
});
