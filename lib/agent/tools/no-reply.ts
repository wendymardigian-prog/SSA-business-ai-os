import { z } from "zod";
import type { AgentToolDefinition } from "./types";

/**
 * no_hace_falta_responder: el agente decide que el ultimo mensaje del lead no
 * pide respuesta (agradece, confirma, se despide, manda un emoji o un sticker).
 *
 * Termina el turno sin escribir nada y, en vez de dejar un borrador "¡De nada!"
 * para aprobar, marca la conversacion como "no necesita respuesta" (00259): sale
 * de "Esperando respuesta" hasta que el lead vuelva a escribir, y en la bandeja
 * queda el cartel con quien lo decidio y "Sí necesita respuesta" para deshacerlo.
 *
 * La herramienta solo ANOTA la decision en la memoria del turno. La marca la
 * pone el runner, y solo si la tanda pasa la compuerta (`canSkipReply`): un
 * mensaje con una pregunta, un audio o una foto nunca se da por cerrado aunque
 * el modelo lo pida. Tampoco se ofrece cuando una persona pidio la respuesta
 * ("Sugerir respuesta" o regenerar un borrador): ahi siempre hay borrador.
 *
 * Obligatoria (siempre esta): es la otra mitad de "no inventes, deriva". Sin
 * ella, ante un "gracias" el agente solo puede contestar algo.
 */

export const NO_REPLY_TOOL = "no_hace_falta_responder";
export const NO_REPLY_MEMO_KEY = "no_reply_needed";

export interface NoReplyMemo {
  motivo: string;
}

const inputSchema = z.object({
  motivo: z
    .string()
    .min(3)
    .max(160)
    .describe("Por que no hace falta responder, en una frase corta (ej.: el lead solo agradecio)."),
});

const configSchema = z.object({});

const DESCRIPTION =
  "Termina tu turno SIN responder, cuando el ultimo mensaje del lead cierra la charla y no pide nada: agradece, confirma que recibio algo, se despide o manda solo un emoji o un sticker. La conversacion queda marcada como que no necesita respuesta, y una persona lo puede deshacer. NO la uses si el lead pregunta algo, pide algo, manda un audio o una foto, si le prometimos algo que todavia no le mandamos (un link, una guia, un precio), o si tenes la menor duda: en esos casos responde (o deriva).";

export const noReplyTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: NO_REPLY_TOOL,
  label: "No responder cuando no hace falta",
  description: DESCRIPTION,
  descriptionInDraft: `${DESCRIPTION} En este canal tus respuestas las revisa una persona: si la usas, no queda ningun borrador para aprobar.`,
  inputSchema,
  configSchema,
  configFields: [],
  required: true,
  async execute({ input, ctx }) {
    ctx.turn?.memo.set(NO_REPLY_MEMO_KEY, { motivo: input.motivo } satisfies NoReplyMemo);
    return {
      ok: true,
      forModel: "Anotado: no hace falta responder. No escribas nada mas.",
      detail: { motivo: input.motivo },
      endsTurn: true,
    };
  },
};
