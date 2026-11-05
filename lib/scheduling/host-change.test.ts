import { describe, expect, it } from "vitest";
import { canPickHost, hostCandidates, hostChangeBlocker, hostChangeError, hostChangeMessage, hostOptionLabel } from "./host-change";

const member = (userId: string, name: string, email = `${userId}@ejemplo.com`) => ({ userId, name, email });

describe("a quien se le puede pasar un evento", () => {
  const candidates = hostCandidates(
    [member("u3", "Zoe"), member("u1", "Ana"), member("u2", "", "beto@ejemplo.com"), member("u4", "Dani")],
    [
      { user_id: "u1", username: "ana", is_active: true },
      { user_id: "u2", username: "beto", is_active: true },
      { user_id: "u3", username: "zoe", is_active: false },
    ],
    ["u1"],
  );

  it("ordena por nombre y usa el email si no hay nombre", () => {
    expect(candidates.map((c) => c.label)).toEqual(["Ana", "beto@ejemplo.com", "Dani", "Zoe"]);
  });

  it("sin perfil de agenda no se puede elegir", () => {
    const dani = candidates.find((c) => c.userId === "u4")!;
    expect(canPickHost(dani)).toBe(false);
    expect(hostOptionLabel(dani)).toBe("Dani (sin perfil de agenda)");
  });

  it("la opcion avisa lo que le falta a cada persona", () => {
    expect(hostOptionLabel(candidates.find((c) => c.userId === "u1")!)).toBe("Ana");
    expect(hostOptionLabel(candidates.find((c) => c.userId === "u2")!)).toBe("beto@ejemplo.com (sin Google Calendar)");
    expect(hostOptionLabel(candidates.find((c) => c.userId === "u3")!)).toBe("Zoe (agenda desactivada)");
  });
});

describe("que frena el cambio", () => {
  const ready: Parameters<typeof hostChangeBlocker>[0]["checklist"] = [
    { key: "details", required: true, ok: true },
    { key: "schedule", required: true, ok: true },
    { key: "calendar", required: false, ok: false },
  ];
  const input = { hostName: "Ana", eventStatus: "active", notBookable: null, checklist: ready };

  it("un evento sin calendario se puede pasar: queda solo en el sistema", () => {
    expect(hostChangeBlocker(input)).toBeNull();
  });

  it("un evento inactivo pasa siempre, aunque a la persona le falte todo", () => {
    expect(hostChangeBlocker({ ...input, eventStatus: "inactive", notBookable: "profile_inactive", checklist: [{ key: "schedule", required: true, ok: false }] })).toBeNull();
  });

  it("un evento activo u oculto no se le pasa a quien no puede recibir reuniones", () => {
    expect(hostChangeBlocker({ ...input, notBookable: "profile_inactive" })).toContain("agenda desactivada");
    expect(hostChangeBlocker({ ...input, eventStatus: "hidden", notBookable: "calendar_disconnected" })).toContain("desconectado");
    expect(hostChangeBlocker({ ...input, checklist: [{ key: "schedule", required: true, ok: false }] })).toContain("horario por defecto");
    expect(hostChangeBlocker({ ...input, checklist: [{ key: "calendar", required: true, ok: false }] })).toContain("Google Meet");
  });

  it("un problema que no depende de la persona no lo frena", () => {
    expect(hostChangeBlocker({ ...input, checklist: [{ key: "details", required: true, ok: false }] })).toBeNull();
  });
});

describe("el aviso antes de confirmar", () => {
  const input = { eventTitle: "Llamada", hostName: "Ana", hasGoogle: true, futureBookings: 0, newLink: "https://x.com/calendario/ana/llamada" };

  it("dice el link nuevo y que el anterior sigue funcionando", () => {
    const message = hostChangeMessage(input);
    expect(message).toContain("https://x.com/calendario/ana/llamada");
    expect(message).toContain("El anterior sigue funcionando");
    expect(message).not.toContain("agendada");
  });

  it("cuenta las reuniones que se quedan con quien las tiene", () => {
    expect(hostChangeMessage({ ...input, futureBookings: 1 })).toContain("La reunión que ya está agendada se queda");
    expect(hostChangeMessage({ ...input, futureBookings: 3 })).toContain("Las 3 reuniones");
  });

  it("avisa si la persona no tiene Google Calendar", () => {
    expect(hostChangeMessage({ ...input, hasGoogle: false })).toContain("solo en el sistema");
  });
});

describe("los errores de la base", () => {
  it("el link repetido dice que hacer", () => {
    expect(hostChangeError("slug_taken", "Ana", "llamada")).toContain("Cambiale el link");
  });

  it("un estado desconocido no deja a la persona sin mensaje", () => {
    expect(hostChangeError("otra-cosa", "Ana", "llamada")).toContain("No pude cambiar");
  });
});
