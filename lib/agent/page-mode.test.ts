import { describe, expect, it } from "vitest";
import { agentsNeedDefaults, agentsPageMode } from "@/lib/agent/page-mode";

describe("pantalla de Agentes IA segun la IA conectada", () => {
  it("sin IA y sin uso previo: solo la invitacion a conectar una", () => {
    expect(agentsPageMode({ connectedProviders: [], everUsedAi: false })).toBe("empty");
  });

  it("sin IA pero se uso antes: todo a la vista, con el aviso", () => {
    expect(agentsPageMode({ connectedProviders: [], everUsedAi: true })).toBe("full-with-warning");
  });

  it("con una IA conectada: la pantalla completa, haya o no historial", () => {
    expect(agentsPageMode({ connectedProviders: ["anthropic"], everUsedAi: false })).toBe("full");
    expect(agentsPageMode({ connectedProviders: ["openai", "google_ai"], everUsedAi: true })).toBe("full");
  });
});

describe("si a los agentes les falta la configuracion inicial", () => {
  const chat = { type: "chat", provider: "anthropic", systemPrompt: "Sos el asistente…", promptVersion: 1 };
  const copy = { type: "copywriter", provider: "anthropic", systemPrompt: "Escribis contenido…", promptVersion: 1 };

  it("todo completo: no hace falta nada (ni una llamada a la base)", () => {
    expect(agentsNeedDefaults([chat, copy])).toBe(false);
  });

  it("no hay agente de chat: falta", () => {
    expect(agentsNeedDefaults([copy])).toBe(true);
    expect(agentsNeedDefaults([])).toBe(true);
  });

  it("un agente sin proveedor: falta", () => {
    expect(agentsNeedDefaults([{ ...chat, provider: null }, copy])).toBe(true);
    expect(agentsNeedDefaults([chat, { ...copy, provider: null }])).toBe(true);
  });

  it("el copywriter sin instrucciones ni versiones: falta; con una version (aunque vacia) no se toca", () => {
    expect(agentsNeedDefaults([chat, { ...copy, systemPrompt: "", promptVersion: null }])).toBe(true);
    expect(agentsNeedDefaults([chat, { ...copy, systemPrompt: "", promptVersion: 2 }])).toBe(false);
  });
});
