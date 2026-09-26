import { describe, it, expect } from "vitest";
import { editorActions, emptyNetworksHint, summarizeNetwork, type EditorPermissions } from "./editor";

const member: EditorPermissions = { create: true, approve: false, publish: false, ai: false, isAuthor: true };
const admin: EditorPermissions = { create: true, approve: true, publish: true, ai: true, isAuthor: false };

const actions = (over: Partial<Parameters<typeof editorActions>[0]> = {}) =>
  editorActions({
    status: "draft",
    perms: admin,
    hasDates: true,
    aiAvailable: true,
    schedulable: 2,
    ...over,
  }).map((b) => b.action);

describe("los botones del editor (F24)", () => {
  it("un Member NO ve programar, publicar ni generar", () => {
    // No deshabilitados: no estan. Lo que no se puede hacer nunca no ocupa
    // lugar en la barra.
    const suyos = actions({ perms: member, status: "approved" });

    expect(suyos).not.toContain("schedule");
    expect(suyos).not.toContain("publish_now");
    expect(suyos).not.toContain("generate_copy");
  });

  it("un Member si puede guardar version y enviar a revision", () => {
    expect(actions({ perms: member })).toEqual(["save_version", "send_to_review"]);
  });

  it("sin proveedor de IA, el boton aparece deshabilitado con el motivo", () => {
    // Esconderlo no enseña que la funcion existe.
    const boton = editorActions({
      status: "draft", perms: admin, hasDates: true, aiAvailable: false, schedulable: 0,
    }).find((b) => b.action === "generate_copy");

    expect(boton?.disabledReason).toContain("Integraciones");
  });

  it("aprobar y devolver aparecen solo en revision", () => {
    expect(actions({ status: "in_review" })).toContain("approve");
    expect(actions({ status: "in_review" })).toContain("return_to_draft");
    expect(actions({ status: "draft" })).not.toContain("approve");
  });

  it("programar aparece recien con la pieza aprobada", () => {
    expect(actions({ status: "draft" })).not.toContain("schedule");
    expect(actions({ status: "approved" })).toContain("schedule");
  });

  it("sin fechas, programar esta deshabilitado y dice que falta", () => {
    const boton = editorActions({
      status: "approved", perms: admin, hasDates: false, aiAvailable: true, schedulable: 0,
    }).find((b) => b.action === "schedule");

    expect(boton?.disabledReason).toContain("fecha");
  });

  it("con fechas pero todas invalidas, el motivo es otro", () => {
    const boton = editorActions({
      status: "approved", perms: admin, hasDates: true, aiAvailable: true, schedulable: 0,
    }).find((b) => b.action === "schedule");

    expect(boton?.disabledReason).toContain("avisos");
  });

  it("el boton dice cuantas redes se van a programar", () => {
    const boton = editorActions({
      status: "approved", perms: admin, hasDates: true, aiAvailable: true, schedulable: 3,
    }).find((b) => b.action === "schedule");

    expect(boton?.label).toContain("3 redes");
  });

  it("una pieza publicada no se archiva desde el editor", () => {
    expect(actions({ status: "published" })).not.toContain("archive");
  });

  it("una pieza publicada no ofrece guardar version ni generar", () => {
    const publicada = actions({ status: "published" });
    expect(publicada).not.toContain("save_version");
    expect(publicada).not.toContain("generate_copy");
  });
});

describe("el resumen de una red cerrada", () => {
  const TZ = "America/Costa_Rica";

  it("dice el estado y la fecha, en la zona del negocio", () => {
    const summary = summarizeNetwork({
      network: { platform: "instagram", planned_at: "2026-10-01T21:00:00Z" },
      publication: undefined,
      timeZone: TZ,
      errors: 0,
      warnings: 0,
    });

    expect(summary.state).toContain("Fecha tentativa");
    expect(summary.state).toContain("15:00");
  });

  it("distingue lo tentativo de lo programado", () => {
    const summary = summarizeNetwork({
      network: { platform: "instagram", planned_at: "2026-10-01T21:00:00Z" },
      publication: { platform: "instagram", status: "scheduled", scheduledAt: "2026-10-01T21:00:00Z" },
      timeZone: TZ,
      errors: 0,
      warnings: 0,
    });

    expect(summary.stateKind).toBe("scheduled");
    expect(summary.state).toContain("Programado");
  });

  it("dice si la red usa contenido propio o el de la pieza", () => {
    expect(
      summarizeNetwork({
        network: { platform: "instagram" },
        publication: undefined, timeZone: TZ, errors: 0, warnings: 0,
      }).uses,
    ).toContain("de la pieza");

    expect(
      summarizeNetwork({
        network: { platform: "linkedin", caption: "Otro texto" },
        publication: undefined, timeZone: TZ, errors: 0, warnings: 0,
      }).uses,
    ).toBe("caption propio");
  });

  it("muestra el CTA y su palabra", () => {
    const summary = summarizeNetwork({
      network: { platform: "instagram", cta: { type: "comment", keyword: "SISTEMA" } },
      publication: undefined, timeZone: TZ, errors: 0, warnings: 0,
    });

    expect(summary.cta).toContain("SISTEMA");
  });

  it("avisa que hay algo para revisar sin abrir la fila", () => {
    // Si hay que abrir las cinco filas para saber que falta, no sirve.
    expect(
      summarizeNetwork({
        network: { platform: "instagram" },
        publication: undefined, timeZone: TZ, errors: 1, warnings: 0,
      }).hasIssues,
    ).toBe(true);
  });
});

describe("el estado vacio", () => {
  it("sin ninguna red conectada, se dice y se indica donde", () => {
    expect(emptyNetworksHint([])).toContain("Integraciones");
    expect(emptyNetworksHint(["instagram"])).toBeNull();
  });
});
