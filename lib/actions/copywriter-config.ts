"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/**
 * La configuracion del copywriter (E3).
 *
 * Aparte de `updateAgentConfig`, que valida la forma del agente de
 * conversacion (ventanas de respuesta, derivacion, horarios). Nada de eso
 * significa algo para un agente que escribe borradores, y mezclarlos
 * obligaria a que cada campo nuevo de uno pasara por el esquema del otro.
 */

const AGENTS_PATH = "/dashboard/agents";

const lineas = z
  .string()
  .max(4000)
  .transform((v) =>
    v
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );

const schema = z.object({
  agentId: z.string().uuid(),
  brand: z.object({
    voice: z.string().max(2000).optional(),
    audience: z.string().max(1000).optional(),
    avoid: z.string().max(1000).optional(),
    /** Ejemplos de posts que funcionaron, uno por linea. */
    examples: lineas.optional(),
  }),
  guardrails: z.object({
    bannedPhrases: lineas,
    bannedClaims: lineas,
    maxLength: z.number().int().positive().max(5000).nullable(),
  }),
  /** Etiquetas de la base de conocimiento que puede leer. */
  knowledgeTags: z.array(z.string().max(60)).max(20),
  /** Producir el copy al aprobar una idea. Apagado por defecto. */
  autoOnApprove: z.boolean(),
  dailyCostLimitUsd: z.number().nonnegative().max(1000).nullable(),
  monthlyCostLimitUsd: z.number().nonnegative().max(10000).nullable(),
});

export type CopywriterConfigInput = z.input<typeof schema>;

export type ConfigResult = { ok: true } | { ok: false; error: string };

export async function updateCopywriterConfig(input: unknown): Promise<ConfigResult> {
  const { workspace, user, supabase, can } = await getPermissionContext();
  if (!can("agents.edit")) return { ok: false, error: "Configurar el agente necesita permiso." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Hay algo mal cargado." };
  }
  const v = parsed.data;

  const { data: agent } = await supabase
    .from("agents")
    .select("id, type")
    .eq("id", v.agentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!agent || agent.type !== "copywriter") {
    return { ok: false, error: "Ese no es el copywriter de este negocio." };
  }

  const service = await createServiceClient();
  const { error } = await service
    .from("agents")
    .update({
      config: {
        brand: v.brand,
        guardrails: v.guardrails,
        auto_on_approve: v.autoOnApprove,
      } as never,
      knowledge_tags: v.knowledgeTags,
      knowledge_enabled: v.knowledgeTags.length > 0,
      daily_cost_limit_usd: v.dailyCostLimitUsd,
      monthly_cost_limit_usd: v.monthlyCostLimitUsd,
    })
    .eq("id", v.agentId);

  if (error) {
    console.error("[copywriter] no pude guardar la configuracion:", error.message);
    return { ok: false, error: "No pude guardar la configuracion." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: v.agentId,
    action: "update",
    metadata: { kind: "copywriter_config", auto_on_approve: v.autoOnApprove },
    performedBy: user.id,
  });

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}
