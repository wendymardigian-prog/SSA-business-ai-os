import { z } from "zod";
import { guardrailsSchema, outputFormatSchema, firstIssue } from "./schemas";

/**
 * Validacion de la configuracion del agente. La usan la pantalla (feedback
 * rapido) y el servidor (porque el cliente se puede saltear), con las mismas
 * reglas. Mismo patron que lib/knowledge/validate.ts.
 *
 * Lo que depende de la base (que el proveedor este conectado, que los canales
 * existan y sean del workspace, que los tags existan) se valida en la Server
 * Action, que es quien puede consultarla.
 */

/** maxDuration de /api/cron/agent-bursts. */
export const TURN_MAX_DURATION_SECONDS = 300;
/** Margen para la espera a que cierre la ventana (<= 15 s), el envio y el cierre del run. */
export const TURN_TIME_MARGIN_SECONDS = 30;

export const agentConfigInputSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre no puede quedar vacio.").max(80, "El nombre es demasiado largo."),
    provider: z.string().trim().min(1, "Elegi un proveedor.").nullable(),
    model: z.string().trim().min(1, "Elegi un modelo.").max(120).nullable(),
    fallbackProvider: z.string().trim().min(1).nullable(),
    fallbackModel: z.string().trim().min(1).max(120).nullable(),
    temperature: z.number().min(0, "La temperatura va de 0 a 2.").max(2, "La temperatura va de 0 a 2.").nullable(),
    maxOutputTokens: z.number().int().min(16, "Minimo 16 tokens.").max(16000, "Maximo 16000 tokens.").nullable(),
    modelTimeoutSeconds: z.number().int().min(10, "El timeout minimo es 10 s.").max(240, "El timeout maximo es 240 s."),
    bundleWindowSeconds: z.number().int().min(15, "La ventana minima es 15 s.").max(3600, "La ventana maxima es 1 hora."),
    responseDelaySeconds: z.number().int().min(0).max(180, "La demora maxima es 180 s."),
    maxWaitSeconds: z.number().int().min(15).max(7200).nullable(),
    maxRepliesPerConversation: z.number().int().min(1).max(500),
    burstMaxAgeHours: z.number().int().min(1, "Minimo 1 hora.").max(720, "Maximo 720 horas (30 dias)."),
    closeAfterInactiveHours: z.number().int().min(1, "Minimo 1 hora.").max(720, "Maximo 720 horas (30 dias)."),
    summaryOnClose: z.boolean(),
    classifyOnClose: z.boolean(),
    outputFormat: outputFormatSchema,
    guardrails: guardrailsSchema,
    dailyCostLimitUsd: z.number().min(0).max(100000).nullable(),
    dailyCostLimitAction: z.enum(["notify", "disable"]),
    monthlyCostLimitUsd: z.number().min(0).max(1000000).nullable(),
    monthlyCostLimitAction: z.enum(["notify", "disable"]),
  })
  .superRefine((value, ctx) => {
    // La espera al objetivo suma la demora y el timeout dentro de la misma
    // invocacion: los dos juntos tienen que entrar en maxDuration.
    if (value.responseDelaySeconds + value.modelTimeoutSeconds + TURN_TIME_MARGIN_SECONDS >= TURN_MAX_DURATION_SECONDS) {
      ctx.addIssue({
        code: "custom",
        path: ["modelTimeoutSeconds"],
        message: `La demora (${value.responseDelaySeconds} s) mas el timeout (${value.modelTimeoutSeconds} s) tienen que sumar menos de ${TURN_MAX_DURATION_SECONDS - TURN_TIME_MARGIN_SECONDS} s.`,
      });
    }
    if (value.maxWaitSeconds !== null && value.maxWaitSeconds < value.bundleWindowSeconds) {
      ctx.addIssue({
        code: "custom",
        path: ["maxWaitSeconds"],
        message: "El tope de espera no puede ser menor que la ventana de silencio.",
      });
    }
    if ((value.provider === null) !== (value.model === null)) {
      ctx.addIssue({ code: "custom", path: ["model"], message: "Elegi proveedor y modelo." });
    }
    if ((value.fallbackProvider === null) !== (value.fallbackModel === null)) {
      ctx.addIssue({ code: "custom", path: ["fallbackModel"], message: "El respaldo necesita proveedor y modelo." });
    }
    if (
      value.fallbackProvider &&
      value.fallbackProvider === value.provider &&
      value.fallbackModel === value.model
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["fallbackModel"],
        message: "El modelo de respaldo tiene que ser distinto del principal.",
      });
    }
  });

export type AgentConfigInput = z.infer<typeof agentConfigInputSchema>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateAgentConfig(input: unknown): ValidationResult<AgentConfigInput> {
  const parsed = agentConfigInputSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error) };
}

export const MAX_PROMPT_CHARS = 20_000;

export function validateSystemPrompt(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string") return { ok: false, error: "El prompt tiene que ser texto." };
  const value = raw.replace(/\r\n/g, "\n").trim();
  if (value.length < 20) return { ok: false, error: "El prompt es demasiado corto: explicale al agente que hacer." };
  if (value.length > MAX_PROMPT_CHARS) return { ok: false, error: `El prompt no puede superar ${MAX_PROMPT_CHARS} caracteres.` };
  return { ok: true, value };
}

/**
 * Tiempo total que va a tardar el agente en responder, para mostrarlo en la
 * pantalla: la ventana desde el ultimo mensaje mas la demora deliberada.
 */
export function expectedResponseSeconds(bundleWindowSeconds: number, responseDelaySeconds: number): number {
  return bundleWindowSeconds + responseDelaySeconds;
}
