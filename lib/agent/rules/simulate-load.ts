import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildPreRuleContext, fillResponseContext } from "./context";
import type { SimulationCase } from "./simulate";

type Db = SupabaseClient<Database>;

/**
 * Arma los casos históricos para la simulación (F11), best-effort, sobre los
 * últimos 30 días. Usa los borradores del agente (tienen la respuesta redactada
 * y la ráfaga) y su contacto. Reconstruye el contexto con lo que hay guardado.
 *
 * Limitaciones (van en pantalla): la temperatura y las etiquetas se toman como
 * están HOY, no como estaban en el momento del turno; la intención no se
 * simula para turnos sin intención guardada; los entrantes sin ningún turno no
 * entran todavía (necesitan la función de episodios del Bloque 3).
 */
export async function loadSimulationCases(service: Db, workspaceId: string, sinceDays = 30): Promise<SimulationCase[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 3_600_000).toISOString();
  const { data: drafts } = await service
    .from("agent_drafts")
    .select("conversation_id, contact_id, body, sent_body, status, discard_reason, burst_last_inbound_at, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .limit(500);

  const rows = (drafts ?? []) as Array<{
    conversation_id: string;
    contact_id: string | null;
    body: string | null;
    sent_body: string | null;
    status: string;
    discard_reason: string | null;
    burst_last_inbound_at: string | null;
    created_at: string;
  }>;

  const cases: SimulationCase[] = [];
  for (const d of rows) {
    if (!d.body) continue; // sin respuesta redactada no se puede simular la etapa final
    // El último entrante de la ráfaga (el mensaje del lead).
    const { data: inbound } = await service
      .from("messages")
      .select("text, created_at")
      .eq("conversation_id", d.conversation_id)
      .eq("direction", "inbound")
      .lte("created_at", d.burst_last_inbound_at ?? d.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let tags: string[] = [];
    let temperature: string | null = null;
    if (d.contact_id) {
      const [{ data: contact }, { data: tagRows }] = await Promise.all([
        service.from("contacts").select("lead_temperature").eq("id", d.contact_id).maybeSingle(),
        service.from("contact_tags").select("tags(name)").eq("contact_id", d.contact_id),
      ]);
      temperature = (contact as { lead_temperature?: string | null } | null)?.lead_temperature ?? null;
      tags = ((tagRows ?? []) as Array<{ tags: { name: string } | { name: string }[] | null }>)
        .flatMap((r) => (Array.isArray(r.tags) ? r.tags : r.tags ? [r.tags] : []))
        .map((t) => t.name);
    }

    const leadText = (inbound as { text?: string | null } | null)?.text ?? "";
    const pre = buildPreRuleContext({
      burstText: leadText,
      burstCount: 1,
      lastInboundText: leadText,
      temperature,
      tags,
      hasPriorOutbound: true,
      hasPriorMessages: true,
      assigned: false,
      channel: "instagram",
      inBusinessHours: true,
    });
    const parts = d.body.split("\n\n");
    const ctx = fillResponseContext(pre, {
      responseText: d.body,
      parts: parts.length,
      wantsEscalate: false,
      kbMiss: false,
      usedTools: [],
      intent: null,
    });

    const realOutcome: SimulationCase["realOutcome"] =
      d.status === "sent" && d.sent_body === d.body
        ? "approved_unchanged"
        : d.status === "sent"
          ? "corrected"
          : d.status === "discarded" && !(d.discard_reason ?? "").startsWith("auto:")
            ? "discarded"
            : null;

    cases.push({ context: ctx, hasResponse: true, leadText, responseText: d.body, realOutcome });
  }
  return cases;
}
