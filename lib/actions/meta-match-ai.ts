"use server";

import { generateText } from "ai";
import { getPermissionAction } from "@/lib/auth/guards";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { aiLanguageStyle } from "@/lib/ai/language-style";
import { interpolate } from "@/lib/ai-tasks/instructions";
import { loadTaskInstructionsForRun } from "@/lib/ai-tasks/store";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { createServiceClient } from "@/lib/supabase/server";
import { loadUnlinked } from "@/lib/attribution/unlinked-load";
import { metaRuleKey } from "@/lib/attribution/meta-match";
import { parseDays } from "@/lib/attribution/unlinked-view";
import {
  AI_MATCH_MAX_ADS,
  AI_MATCH_MAX_GROUPS,
  buildAiMatchPrompt,
  buildAiMatchSystemPrompt,
  parseAiMatchResponse,
  type AiMatchCatalog,
  type AiMatchExample,
  type AiMatchGroup,
  type AiMatchLevel,
} from "@/lib/attribution/ai-match";
import { resolveViewerTimezone } from "@/lib/user-timezone";

/**
 * «Proponer con IA» en «Sin vincular» (tarea `ads_matching`, 00318).
 *
 * Lee en el SERVIDOR los grupos sin resolver (nunca los que manda el navegador), el catalogo y ejemplos de lo ya
 * vinculado, y le pide al modelo una propuesta por grupo. La IA nunca vincula: devuelve propuestas validadas contra
 * el catalogo y la persona las confirma (cada confirmacion es `applyMetaRule` con `origin: "ai"`).
 *
 * Al modelo viajan solo UTMs y conteos: nunca nombres, emails ni telefonos. El costo queda en `agent_runs` y los
 * topes del negocio se respetan ANTES de llamar.
 */

export interface AiMatchSuggestion {
  key: string;
  values: Array<{ label: string; value: string }>;
  people: number;
  rule: { utmCampaign: string | null; utmContent: string | null; utmTerm: string | null };
  level: AiMatchLevel;
  /** Ids para la regla (null si «no es un anuncio»). */
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  /** «Campaña › Conjunto › Anuncio» o «No es un anuncio». */
  target: string;
  confidence: "high" | "medium" | "low";
  why: string;
}

export type AiMatchResult = { ok: true; suggestions: AiMatchSuggestion[]; analyzed: number; costUsd: number | null } | { ok: false; error: string };

const TASK_SCREEN_HINT = "Se cambia en Agentes IA → Vincular anuncios.";

export async function proposeMetaMatchesWithAi(input: { days?: string | number }): Promise<AiMatchResult> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: "No tenés permiso para vincular anuncios. Pedile a un Admin que lo haga." };

  const days = parseDays(String(input.days ?? ""));
  const timeZone = await resolveViewerTimezone(ctx.workspace.timezone);

  // Los grupos, con la misma carga que la pantalla (y la RLS de quien mira): primero lo que no tiene nada, despues lo
  // que tiene campaña pero no anuncio. Solo los que traen UTMs: sin UTMs no hay regla que crear.
  const [unmatched, noAd] = await Promise.all([
    loadUnlinked(ctx.supabase, { workspaceId: ctx.workspace.id, view: "sin-vincular", days, page: 1, timeZone }),
    loadUnlinked(ctx.supabase, { workspaceId: ctx.workspace.id, view: "sin-anuncio", days, page: 1, timeZone }),
  ]);
  const groups = [...unmatched.groups, ...noAd.groups].filter((g) => g.rule).slice(0, AI_MATCH_MAX_GROUPS);
  if (groups.length === 0) return { ok: false, error: "No hay grupos con UTMs para analizar: lo que queda se vincula a mano." };

  const budget = await withinWorkspaceBudget(ctx.supabase, ctx.workspace.id);
  if (!budget.allowed) return { ok: false, error: budget.message ?? "Tope de gasto de IA alcanzado" };

  const service = await createServiceClient();
  const [model, instructions, catalog, examples] = await Promise.all([
    resolveTaskModel(service, ctx.workspace.id, "ads_matching"),
    loadTaskInstructionsForRun(service, ctx.workspace.id, "ads_matching"),
    loadCatalog(service, ctx.workspace.id),
    loadExamples(service, ctx.workspace.id),
  ]);
  if (!model.ok || !model.model) {
    const base = model.message ?? "No hay un proveedor de IA conectado. Conectalo en Ajustes → Integraciones.";
    return { ok: false, error: model.chosen ? `${base} ${TASK_SCREEN_HINT}` : base };
  }
  if (catalog.ads.length === 0 && catalog.campaigns.length === 0) {
    return { ok: false, error: "El catálogo de Meta está vacío: sincronizá la cuenta publicitaria y probá de nuevo." };
  }

  const aiGroups: AiMatchGroup[] = groups.map((g) => ({
    key: g.key,
    utmSource: g.utmSource,
    utmMedium: g.utmMedium,
    utmCampaign: g.rule?.utmCampaign ?? null,
    utmContent: g.rule?.utmContent ?? null,
    utmTerm: g.rule?.utmTerm ?? null,
    people: g.peopleCount,
  }));

  const run = await openAiRun(ctx.supabase, {
    workspaceId: ctx.workspace.id,
    source: "ads_matching",
    trigger: "manual",
    promptVersion: instructions.version,
  });
  run.setModel(model.provider!, model.modelId!);
  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: model.model,
      system: buildAiMatchSystemPrompt(interpolate(instructions.text, { estilo: aiLanguageStyle() })),
      prompt: buildAiMatchPrompt({ groups: aiGroups, catalog, examples }),
    });
    run.setFinalUsage(result.usage);

    const proposals = parseAiMatchResponse(result.text, { groupKeys: aiGroups.map((g) => g.key), catalog });
    await run.step({
      kind: "model_call",
      name: `${model.provider}/${model.modelId}`,
      // Metadatos, no el texto: las propuestas se le devuelven a quien las pidio.
      output: { groups: aiGroups.length, proposals: proposals.length },
      durationMs: Date.now() - startedAt,
    });
    const closed = await run.close({ status: "responded" });

    const byKey = new Map(groups.map((g) => [g.key, g]));
    const suggestions: AiMatchSuggestion[] = [];
    for (const p of proposals) {
      const group = byKey.get(p.key);
      if (!group?.rule) continue;
      // Una propuesta que repite lo que el grupo ya tiene no agrega nada.
      if (p.level !== "not_ad" && group.linkedIds && (group.linkedIds.adId === p.id || (!group.linkedIds.adId && p.level !== "ad" && (group.linkedIds.adsetId === p.id || group.linkedIds.campaignId === p.id)))) continue;
      const ids = chain(catalog, p.level, p.id);
      suggestions.push({
        key: group.key,
        values: group.values,
        people: group.peopleCount,
        rule: group.rule,
        level: p.level,
        ...ids,
        target: p.level === "not_ad" ? "No es un anuncio" : targetLabel(catalog, ids),
        confidence: p.confidence,
        why: p.why,
      });
    }
    return { ok: true, suggestions, analyzed: aiGroups.length, costUsd: closed.costUsd };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    console.error("[meta-match] fallo la propuesta con IA:", detail);
    await run.close({ status: "error", statusDetail: "generation_failed", error: detail });
    return { ok: false, error: "No pude analizar los grupos. Revisá que la API key del proveedor siga válida y que el modelo elegido exista." };
  }
}

type Service = Awaited<ReturnType<typeof createServiceClient>>;

/** El catalogo para el modelo: primero lo activo y lo mas nuevo, con tope. */
async function loadCatalog(service: Service, workspaceId: string): Promise<AiMatchCatalog> {
  const [campaigns, adsets, ads] = await Promise.all([
    service.from("meta_campaigns").select("campaign_id, name, effective_status, created_time").eq("workspace_id", workspaceId).order("created_time", { ascending: false, nullsFirst: false }).limit(200),
    service.from("meta_adsets").select("adset_id, campaign_id, name").eq("workspace_id", workspaceId).limit(1000),
    service.from("meta_ads").select("ad_id, adset_id, campaign_id, name, effective_status, created_time").eq("workspace_id", workspaceId).order("created_time", { ascending: false, nullsFirst: false }).limit(1000),
  ]);
  const active = (s: string | null) => (s === "ACTIVE" ? 0 : 1);
  const adRows = ((ads.data ?? []) as Array<{ ad_id: string; adset_id: string | null; campaign_id: string | null; name: string | null; effective_status: string | null }>)
    .sort((a, b) => active(a.effective_status) - active(b.effective_status))
    .slice(0, AI_MATCH_MAX_ADS);
  return {
    campaigns: ((campaigns.data ?? []) as Array<{ campaign_id: string; name: string | null; effective_status: string | null }>).map((c) => ({ id: c.campaign_id, name: c.name, status: c.effective_status })),
    adsets: ((adsets.data ?? []) as Array<{ adset_id: string; campaign_id: string | null; name: string | null }>).map((s) => ({ id: s.adset_id, campaignId: s.campaign_id, name: s.name })),
    ads: adRows.map((a) => ({ id: a.ad_id, adsetId: a.adset_id, campaignId: a.campaign_id, name: a.name, status: a.effective_status })),
  };
}

/** Grupos que ya quedaron vinculados a un anuncio con UTMs de texto: muestran como nombra este negocio sus UTMs. */
async function loadExamples(service: Service, workspaceId: string): Promise<AiMatchExample[]> {
  const { data } = await service
    .from("contact_touches")
    .select("campaign, content_label, term, meta_ad_id, meta_campaign_id")
    .eq("workspace_id", workspaceId)
    .in("meta_match_status", ["matched", "manual"])
    .not("meta_ad_id", "is", null)
    .not("content_label", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as Array<{ campaign: string | null; content_label: string | null; term: string | null; meta_ad_id: string; meta_campaign_id: string | null }>;
  const seen = new Set<string>();
  const picked = rows.filter((r) => {
    if (/^\d+$/.test((r.content_label ?? "").trim())) return false; // un id no enseña ningun patron
    const key = [metaRuleKey(r.campaign), metaRuleKey(r.content_label), metaRuleKey(r.term)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
  if (picked.length === 0) return [];

  const [ads, campaigns] = await Promise.all([
    service.from("meta_ads").select("ad_id, name").eq("workspace_id", workspaceId).in("ad_id", [...new Set(picked.map((r) => r.meta_ad_id))]),
    service.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", workspaceId).in("campaign_id", [...new Set(picked.map((r) => r.meta_campaign_id).filter((v): v is string => !!v))]),
  ]);
  const adName = new Map(((ads.data ?? []) as Array<{ ad_id: string; name: string | null }>).map((a) => [a.ad_id, a.name]));
  const campaignName = new Map(((campaigns.data ?? []) as Array<{ campaign_id: string; name: string | null }>).map((c) => [c.campaign_id, c.name]));
  return picked.map((r) => ({
    utmCampaign: r.campaign,
    utmContent: r.content_label,
    utmTerm: r.term,
    adName: adName.get(r.meta_ad_id) ?? null,
    campaignName: r.meta_campaign_id ? (campaignName.get(r.meta_campaign_id) ?? null) : null,
  }));
}

/** Un anuncio completa su conjunto y su campaña; un conjunto, su campaña. */
function chain(catalog: AiMatchCatalog, level: AiMatchLevel, id: string | null): { adId: string | null; adsetId: string | null; campaignId: string | null } {
  if (level === "ad" && id) {
    const ad = catalog.ads.find((a) => a.id === id);
    return { adId: id, adsetId: ad?.adsetId ?? null, campaignId: ad?.campaignId ?? null };
  }
  if (level === "adset" && id) {
    const adset = catalog.adsets.find((s) => s.id === id);
    return { adId: null, adsetId: id, campaignId: adset?.campaignId ?? null };
  }
  if (level === "campaign" && id) return { adId: null, adsetId: null, campaignId: id };
  return { adId: null, adsetId: null, campaignId: null };
}

function targetLabel(catalog: AiMatchCatalog, ids: { adId: string | null; adsetId: string | null; campaignId: string | null }): string {
  const campaign = ids.campaignId ? (catalog.campaigns.find((c) => c.id === ids.campaignId)?.name ?? `Campaña ${ids.campaignId}`) : null;
  const adset = ids.adsetId ? (catalog.adsets.find((s) => s.id === ids.adsetId)?.name ?? `Conjunto ${ids.adsetId}`) : null;
  const ad = ids.adId ? (catalog.ads.find((a) => a.id === ids.adId)?.name ?? `Anuncio ${ids.adId}`) : null;
  return [campaign, adset, ad].filter(Boolean).join(" › ") || "—";
}
