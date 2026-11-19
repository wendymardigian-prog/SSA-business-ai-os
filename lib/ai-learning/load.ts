import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { PromptLearning } from "@/lib/agent/prompt";
import { examplesText, pickExamples, type OutcomeForExamples } from "./examples";
import { loadActiveLearnedRules } from "./rules-run";
import type { LearningSettings } from "./settings";

/**
 * Lo aprendido que entra al prompt de un turno: las reglas activas y, con el interruptor encendido, los ejemplos del
 * mismo canal y tipo. Nunca lanza: ante cualquier error, el prompt de siempre.
 */
export async function loadPromptLearning(
  service: SupabaseClient<Database>,
  agent: { id: string; learning: LearningSettings },
  scope: { channelId: string | null; kind?: string },
): Promise<PromptLearning> {
  const rules = await loadActiveLearnedRules(service, agent.id);
  if (!agent.learning.examples) return { rules };
  try {
    const { data, error } = await service
      .from("ai_outcomes")
      .select("outcome, proposed_text, final_text, decided_at, channel_id, kind")
      .eq("agent_id", agent.id)
      .eq("kind", scope.kind ?? "message")
      .in("outcome", ["approved", "approved_edited"])
      .order("decided_at", { ascending: false })
      .limit(50);
    if (error || !data) return { rules };
    const outcomes: OutcomeForExamples[] = data.map((r) => ({
      outcome: r.outcome,
      proposedText: r.proposed_text,
      finalText: r.final_text,
      decidedAt: r.decided_at,
      channelId: r.channel_id,
      kind: r.kind,
    }));
    const picked = pickExamples(outcomes, {
      channelId: scope.channelId,
      kind: scope.kind ?? "message",
      approved: agent.learning.approvedExamples,
      edits: agent.learning.editExamples,
    });
    return { rules, examples: examplesText(picked) };
  } catch (err) {
    console.error("[ai-learning] no pude leer los ejemplos:", err instanceof Error ? err.message : String(err));
    return { rules };
  }
}
