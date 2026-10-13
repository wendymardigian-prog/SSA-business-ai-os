import { describe, expect, it } from "vitest";
import { dateInputToIso } from "@/lib/dates";
import { buildFollowupTask, findFollowupTask, followupDateOf, followupRef, isFollowupRef } from "./followup";
import { makeTask, taskId } from "./fixtures";

describe("seguimiento (R2)", () => {
  it("followupRef arma la clave de origen", () => {
    expect(followupRef("2026-10-20")).toBe("followup:2026-10-20");
    expect(isFollowupRef("followup:2026-10-20")).toBe(true);
    expect(isFollowupRef("followup:20-10-2026")).toBe(false);
    expect(isFollowupRef("payment:abc")).toBe(false);
    expect(isFollowupRef(null)).toBe(false);
  });

  it.each(["America/Costa_Rica", "America/Argentina/Buenos_Aires", "Asia/Tokyo"])(
    "followupDateOf devuelve el dia que se eligio para un valor guardado a las 12:00 en %s",
    (zone) => {
      const stored = dateInputToIso("2026-10-20", zone); // mediodia de esa zona
      expect(stored).not.toBeNull();
      expect(followupDateOf(stored, zone)).toBe("2026-10-20");
    },
  );

  it("el dia del workspace es el mismo para todos aunque cambie la zona de quien mira", () => {
    // Guardado en Costa Rica (18:00 UTC); el workspace esta en Buenos Aires: sigue siendo el 20.
    const stored = dateInputToIso("2026-10-20", "America/Costa_Rica");
    expect(followupDateOf(stored, "America/Argentina/Buenos_Aires")).toBe("2026-10-20");
  });

  it("sin fecha o con una fecha invalida no hay dia", () => {
    expect(followupDateOf(null, "UTC")).toBeNull();
    expect(followupDateOf("", "UTC")).toBeNull();
    expect(followupDateOf("no es una fecha", "UTC")).toBeNull();
  });

  describe("findFollowupTask", () => {
    const cid = "c-1";
    const mine = makeTask({ id: taskId(1), contact_id: cid, source_ref: "followup:2026-10-20", created_at: "2026-10-01T10:00:00Z" });

    it("encuentra la tarea que coincide", () => {
      expect(findFollowupTask([mine], cid, "2026-10-20")?.id).toBe(mine.id);
    });

    it("ignora las borradas, las de otro contacto y las de otra fecha", () => {
      const deleted = makeTask({ id: taskId(2), contact_id: cid, source_ref: "followup:2026-10-20", deleted_at: "2026-10-02T00:00:00Z" });
      const other = makeTask({ id: taskId(3), contact_id: "c-2", source_ref: "followup:2026-10-20" });
      expect(findFollowupTask([deleted, other], cid, "2026-10-20")).toBeNull();
      expect(findFollowupTask([mine], cid, "2026-10-21")).toBeNull();
    });

    it("si la fecha cambio devuelve null y NO toca la tarea anterior", () => {
      const before = JSON.stringify(mine);
      expect(findFollowupTask([mine], cid, "2026-11-02")).toBeNull();
      expect(JSON.stringify(mine)).toBe(before);
    });

    it("sin fecha no hay tarea", () => {
      expect(findFollowupTask([mine], cid, null)).toBeNull();
    });

    it("con mas de una (borde), la mas reciente", () => {
      const newer = makeTask({ id: taskId(4), contact_id: cid, source_ref: "followup:2026-10-20", created_at: "2026-10-05T10:00:00Z" });
      expect(findFollowupTask([mine, newer], cid, "2026-10-20")?.id).toBe(newer.id);
    });

    it("las completadas tambien cuentan (el indice unico las incluye)", () => {
      const done = makeTask({ id: taskId(5), contact_id: cid, source_ref: "followup:2026-10-20", status: "completed" });
      expect(findFollowupTask([done], cid, "2026-10-20")?.id).toBe(done.id);
    });
  });

  it("buildFollowupTask arma titulo, fecha, responsable y clave de origen", () => {
    expect(buildFollowupTask({ id: "c-1", display_name: "Ana  Pérez" }, "2026-10-20", "u-1")).toEqual({
      title: "Seguimiento a Ana Pérez",
      due_date: "2026-10-20",
      owner_id: "u-1",
      contact_id: "c-1",
      source: "manual",
      source_ref: "followup:2026-10-20",
    });
  });

  it("buildFollowupTask usa el email o un nombre generico, y respeta el largo maximo del titulo", () => {
    expect(buildFollowupTask({ id: "c", display_name: null, email: "ana@x.com" }, "2026-10-20", "u").title).toBe("Seguimiento a ana@x.com");
    expect(buildFollowupTask({ id: "c" }, "2026-10-20", "u").title).toBe("Seguimiento a este contacto");
    expect(buildFollowupTask({ id: "c", display_name: "x".repeat(500) }, "2026-10-20", "u").title).toHaveLength(200);
  });
});
