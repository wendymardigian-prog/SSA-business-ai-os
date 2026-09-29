import { describe, expect, it } from "vitest";
import { buildTeamRows, filterValueFor, initialsOf, timeTone, type TeamSqlRow } from "./team-rows";

const SOFIA = "11111111-1111-4111-8111-111111111111";
const WENDY = "22222222-2222-4222-8222-222222222222";

function row(author: string, over: Partial<TeamSqlRow> = {}): TeamSqlRow {
  return {
    author,
    conversations: 5,
    messages_out: 10,
    first_response_median_seconds: 600,
    reply_median_seconds: 420,
    replies_under_1h_pct: 91,
    escalations_received: null,
    drafts_approved: null,
    drafts_approved_unedited_pct: null,
    ...over,
  };
}

const members = [
  { id: SOFIA, label: "Sofía Ramírez", role: "Setter" },
  { id: WENDY, label: "Wendy Mardigian", role: "Owner" },
];

describe("buildTeamRows", () => {
  it("Automatizaciones es UNA fila y filtra por un valor que el SQL reconoce", () => {
    const rows = buildTeamRows([row("automations", { messages_out: 430 })], members);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Automatizaciones");
    expect(filterValueFor(rows[0])).toBe("automations");
  });

  it("el agente va primero aunque no sea el que mas mando", () => {
    const rows = buildTeamRows([row(SOFIA, { messages_out: 400 }), row("agent", { messages_out: 10 })], members);
    expect(rows[0].author).toBe("agent");
  });

  it("a una persona le pone su nombre y su rol", () => {
    const rows = buildTeamRows([row(SOFIA)], members);
    expect(rows[0]).toMatchObject({ label: "Sofía Ramírez", sublabel: "Setter", initials: "SR", isPerson: true });
  });

  it("marca la fila propia con (vos)", () => {
    const rows = buildTeamRows([row(WENDY)], members, WENDY);
    expect(rows[0].label).toBe("Wendy Mardigian (vos)");
  });

  it("un Member no conoce al equipo: la fila ajena queda sin nombre pero filtrable", () => {
    const rows = buildTeamRows([row(SOFIA)], [], WENDY);
    expect(rows[0].label).toBe("Alguien del equipo");
    expect(filterValueFor(rows[0])).toBe(SOFIA);
  });

  it("las automatizaciones responden en el acto: el tiempo no se muestra igual", () => {
    expect(buildTeamRows([row("automations")], members)[0].instant).toBe(true);
    expect(buildTeamRows([row("agent")], members)[0].instant).toBe(false);
  });

  it("los numeros nulos siguen nulos (no se vuelven cero)", () => {
    const rows = buildTeamRows([row("external", { reply_median_seconds: null, replies_under_1h_pct: null })], members);
    expect(rows[0].replyMedianSeconds).toBeNull();
    expect(rows[0].repliesUnder1hPct).toBeNull();
  });

  it("derivaciones y borradores solo para personas", () => {
    const person = buildTeamRows([row(SOFIA, { escalations_received: 38, drafts_approved: 142, drafts_approved_unedited_pct: 78 })], members)[0];
    expect(person.escalationsReceived).toBe(38);
    expect(person.draftsApprovedUneditedPct).toBe(78);
    const agent = buildTeamRows([row("agent")], members)[0];
    expect(agent.escalationsReceived).toBeNull();
  });
});

describe("filterValueFor", () => {
  it("un autor desconocido no se manda a la URL", () => {
    const rows = buildTeamRows([row("flow")], members);
    // 'flow' no lo reconoce chat_author_match: filtrar por eso dejaba el
    // dashboard en blanco.
    expect(filterValueFor(rows[0])).toBeNull();
  });
});

describe("initialsOf", () => {
  it("toma la primera y la ultima", () => {
    expect(initialsOf("Sofía Ramírez")).toBe("SR");
    expect(initialsOf("Wendy")).toBe("WE");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("timeTone", () => {
  it("mas de 1 h ambar, mas de 4 h rojo", () => {
    expect(timeTone(600)).toBe("ok");
    expect(timeTone(3600)).toBe("warn");
    expect(timeTone(5 * 3600)).toBe("bad");
  });
  it("sin dato no se pinta", () => {
    expect(timeTone(null)).toBe("ok");
  });
});
