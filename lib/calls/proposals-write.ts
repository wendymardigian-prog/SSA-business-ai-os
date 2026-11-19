/**
 * Guardar las propuestas nuevas de una reunión reemplazando SOLO las pendientes de ese origen (el analizador o el
 * resumen). Solo servidor: lo usan los jobs `call_analyze` y `call_summary`, con el cliente de servicio.
 *
 * Con la 00450 aplicada lo hace la base con la reunión bloqueada (`call_proposals_replace_pending`): si el análisis y
 * el resumen terminan a la vez, ninguno pisa las propuestas del otro. Sin la 00450 (el código desplegado antes que la
 * migración), lee y escribe como antes. Nunca lanza.
 */
import type { Json } from "@/lib/types/database";
import { mergeOnRegenerate, readProposals, type Proposal, type ProposalType } from "./proposals";

type AnyDb = {
  from: (t: string) => unknown;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};

/** La función no existe todavía (la 00450 sin aplicar): PostgREST la busca y no la encuentra. */
export function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

export async function replacePendingProposals(
  db: AnyDb,
  input: { callId: string; types: readonly ProposalType[]; fresh: readonly Proposal[] },
): Promise<{ ok: boolean }> {
  try {
    const { error } = await db.rpc("call_proposals_replace_pending", {
      p_call_id: input.callId,
      p_types: [...input.types],
      p_fresh: input.fresh as unknown as Json,
    });
    if (!error) return { ok: true };
    if (!isMissingFunction(error)) {
      console.error("[propuestas] no pude guardarlas:", error.message);
      return { ok: false };
    }
    // Respaldo sin la 00450: leer, juntar y escribir.
    const calls = db.from("calls") as {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { proposals?: unknown } | null }> } };
      update: (v: Record<string, unknown>) => { eq: (k: string, v: string) => PromiseLike<{ error: { message: string } | null }> };
    };
    const { data } = await calls.select("proposals").eq("id", input.callId).maybeSingle();
    if (!data) return { ok: false };
    if (input.fresh.length === 0 && !readProposals(data.proposals).some((p) => p.status === "pending" && input.types.includes(p.type))) return { ok: true };
    const merged = mergeOnRegenerate(data.proposals, input.fresh, input.types);
    const { error: upError } = await calls.update({ proposals: merged as unknown as Json }).eq("id", input.callId);
    if (upError) console.error("[propuestas] no pude guardarlas:", upError.message);
    return { ok: !upError };
  } catch (error) {
    console.error("[propuestas] falló el guardado:", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
