import { describe, expect, it } from "vitest";
import { cleanAssistantInput, historyForModel, parseAssistantResult, proposalIdsOf, proposalNote, proposalPhase, type ProposalState, type StoredMessage } from "./steps";
import { assistantSystemPrompt, assistantUnavailable } from "./turn";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const writeStep = (id: string) => ({ tool: "crear_tarea", label: "Crear una tarea", access: "write" as const, ok: true, message: "Queda propuesto", proposal_id: id });
const readStep = { tool: "ver_clientes", label: "Ver clientes", access: "read" as const, ok: true, message: "3 clientes", output: [{ nombre: "Ana" }] };

describe("asistente: pasos e historial", () => {
  it("lee los pasos guardados y tira lo que no tiene la forma", () => {
    expect(parseAssistantResult({ steps: [readStep], run_id: null }).steps).toHaveLength(1);
    expect(parseAssistantResult({ algo: 1 }).steps).toEqual([]);
    expect(parseAssistantResult(null).steps).toEqual([]);
  });

  it("el estado de una propuesta: aprobada (también editada), rechazada, fallida, caducada o pendiente", () => {
    expect(proposalPhase("approved_edited")).toBe("approved");
    expect(proposalPhase("approving")).toBe("pending");
    expect(proposalPhase("rejected")).toBe("rejected");
    expect(proposalPhase("expired")).toBe("expired");
  });

  it("si la rechazaron, el motivo vuelve al modelo para que se adapte", () => {
    const p: ProposalState = { id: P1, status: "rejected", label: "Crear la tarea «Llamar a Ana»", reject_reason: "wrong_data", reject_note: "Es Ana López" };
    const note = proposalNote(p);
    expect(note).toContain("rechazó");
    expect(note).toContain("Es Ana López");
    expect(note).toContain("No lo vuelvas a proponer igual");
  });

  it("el historial: empieza por la persona, junta seguidos, suma el estado de lo propuesto y no reenvía datos consultados", () => {
    const messages: StoredMessage[] = [
      { role: "assistant", content: "Hola", result: null },
      { role: "user", content: "Busca a Ana", result: null },
      { role: "assistant", content: "Encontré a Ana y te propongo una tarea.", result: { steps: [readStep, writeStep(P1)] } },
      { role: "user", content: "Gracias", result: null },
      { role: "user", content: "¿Y la otra?", result: null },
    ];
    const proposals = new Map<string, ProposalState>([[P1, { id: P1, status: "approved", label: "Crear la tarea", reject_reason: null, reject_note: null }]]);
    const h = historyForModel(messages, proposals);
    expect(h[0].role).toBe("user");
    expect(h).toHaveLength(3);
    expect(h[1].content).toContain("aprobó «Crear la tarea»");
    expect(h[1].content).not.toContain("nombre");
    expect(h[2].content).toBe("Gracias\n\n¿Y la otra?");
  });

  it("los ids de propuesta de la conversación, sin repetir", () => {
    const messages: StoredMessage[] = [
      { role: "assistant", content: "a", result: { steps: [writeStep(P1), writeStep(P2)] } },
      { role: "assistant", content: "b", result: { steps: [writeStep(P1)] } },
    ];
    expect(proposalIdsOf(messages).sort()).toEqual([P1, P2]);
  });

  it("el texto de la persona: limpio, recortado y vacío si no es texto", () => {
    expect(cleanAssistantInput("  hola  ")).toBe("hola");
    expect(cleanAssistantInput(42)).toBe("");
    expect(cleanAssistantInput("x".repeat(5000))).toHaveLength(4000);
  });

  it("disponible solo con «Usar el asistente» y el agente preparado y encendido", () => {
    const yes = () => true;
    const no = () => false;
    expect(assistantUnavailable(no, { is_enabled: true })).toContain("Usar el asistente");
    expect(assistantUnavailable(yes, null)).toContain("no está preparado");
    expect(assistantUnavailable(yes, { is_enabled: false })).toContain("apagado");
    expect(assistantUnavailable(yes, { is_enabled: true })).toBeNull();
  });

  it("las instrucciones llevan siempre las reglas que no se pueden quitar, quién habla y la hora local", () => {
    const s = assistantSystemPrompt({ system_prompt: "Sé breve." }, { name: "Marta", now: new Date("2026-11-17T09:00:00Z"), timeZone: "Europe/Madrid" });
    expect(s.startsWith("Sé breve.")).toBe(true);
    expect(s).toContain("queda propuesto");
    expect(s).toContain("Marta");
    expect(s).toContain("10:00");
  });
});
