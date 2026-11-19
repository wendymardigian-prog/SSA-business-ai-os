import { describe, expect, it } from "vitest";
import { listTriggers } from "@/lib/flow-engine/registry/index";
import { INSTANT_TRIGGER_TYPES } from "./settings";

/**
 * «Según el disparador» (cola de WhatsApp, 00420): salen al instante los disparadores de un mensaje o un comentario del
 * contacto y los de su agenda. La lista vive en `settings.ts` (la importa el navegador, que no puede cargar el registro):
 * acá se controla que siga al registro. Un disparador nuevo de mensajes o de agenda que no esté en la lista mandaría sus
 * WhatsApp por la cola sin que nadie lo decidiera.
 */
describe("los disparadores que hacen salir un WhatsApp al instante siguen al registro", () => {
  it("son exactamente los de scope message o comment y los de origen booking", () => {
    const expected = listTriggers()
      .filter((t) => t.scope === "message" || t.scope === "comment" || t.sourceType === "booking")
      .map((t) => t.type)
      .sort();
    expect([...INSTANT_TRIGGER_TYPES].sort()).toEqual(expected);
  });
});
