import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import type { Database } from "@/lib/types/database";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun, recordRunOutcome } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { newNonce } from "@/lib/agent/untrusted";
import { enqueueBgTask, continuationDedupeKey, type BgTaskPayload } from "@/lib/background/enqueue";
import { resolveBackgroundSettings } from "@/lib/background/settings";
import { getProvider, isTextProvider } from "@/lib/integrations/providers";
import { selectPending, applyClassification, CLASSIFIER_BATCH, MAX_NEW_CATEGORIES, type PendingText } from "./classifier";
import { buildSystemPrompt, buildBatchPrompt, parseClassifierOutput, MAX_CORRECTIONS, type CategoryForPrompt, type CorrectionForPrompt } from "./prompt";

type Db = SupabaseClient<Database>;

/**
 * La corrida del clasificador de mensajes (F20).
 *
 * Un run por corrida, con sus tokens y su costo. La corrida procesa lotes de
 * hasta 200 hasta que se acaba el presupuesto de tiempo; si quedan pendientes,
 * encola una continuación con su propia clave. No depende de cuánto aguante la
 * ruta: el día que haya 5.000 textos, el presupuesto es lo que evita un
 * timeout silencioso a mitad de un lote.
 */

/** Cuánto puede durar una corrida antes de encolar la continuación. */
export const TIME_BUDGET_MS = 90_000;
/** Hasta dónde puede llegar el encadenado. Un tope duro contra un bucle. */
export const MAX_CONTINUATIONS = 20;
/** Mientras una dirección tenga menos categorías propias que esto, se siembra. */
export const SEEDING_THRESHOLD = 8;
/** Tope de categorías nuevas mientras se siembra el catálogo. */
export const SEEDING_MAX_NEW_CATEGORIES = 12;
/** Versión del prompt, para poder comparar corridas después. */
export const PROMPT_VERSION = 1;

const DIRECTIONS = ["inbound", "outbound"] as const;
type Direction = (typeof DIRECTIONS)[number];

export interface ClassifyDeps {
  generate?: typeof generateText;
  resolveModel?: typeof getWorkspaceModel;
  checkBudget?: typeof withinWorkspaceBudget;
  enqueue?: typeof enqueueBgTask;
  now?: () => Date;
  nonce?: () => string;
}

export interface ClassifyRunResult {
  ok: boolean;
  reason?: "spend_limit" | "budget_unreadable" | "no_pending";
  runId: string | null;
  batches: number;
  classified: number;
  byRule: number;
  newCategories: number;
  newCategoryNames: string[];
  invalid: number;
  deferred: number;
  truncated: number;
  continued: boolean;
  costUsd: number | null;
  pricingMissing: string[];
}

const empty = (): ClassifyRunResult => ({
  ok: true,
  runId: null,
  batches: 0,
  classified: 0,
  byRule: 0,
  newCategories: 0,
  newCategoryNames: [],
  invalid: 0,
  deferred: 0,
  truncated: 0,
  continued: false,
  costUsd: null,
  pricingMissing: [],
});

export async function runMessageClassification(
  supabase: Db,
  args: { workspaceId: string; window: string; dedupeKey: string; part?: number; backgroundSettings?: unknown },
  deps: ClassifyDeps = {},
): Promise<ClassifyRunResult> {
  const generate = deps.generate ?? generateText;
  const resolveModel = deps.resolveModel ?? getWorkspaceModel;
  const checkBudget = deps.checkBudget ?? withinWorkspaceBudget;
  const enqueue = deps.enqueue ?? enqueueBgTask;
  const clock = deps.now ?? (() => new Date());
  const makeNonce = deps.nonce ?? newNonce;

  const out = empty();
  const started = clock();
  const deadline = started.getTime() + TIME_BUDGET_MS;

  // 1. El tope de gasto, antes de cualquier otra cosa. Un tope en NULL no se
  //    evalúa (withinWorkspaceBudget ni consulta), así que "sin tope" es
  //    explícito y no una comparación contra NULL.
  const budget = await checkBudget(supabase, args.workspaceId, started);
  if (!budget.allowed) {
    const unreadable = budget.message?.includes("No pude verificar") ?? false;
    const detail = unreadable ? "spend:unreadable" : "spend:workspace";
    // Queda registrado que NO arrancó, y por qué. Sin llamar al proveedor.
    out.runId = await recordRunOutcome(supabase, {
      workspaceId: args.workspaceId,
      source: "message_classification",
      trigger: "job",
      status: "blocked_guardrail",
      statusDetail: detail,
      error: budget.message ?? null,
    });
    return { ...out, ok: false, reason: unreadable ? "budget_unreadable" : "spend_limit" };
  }

  // 2. ¿Hay algo que hacer? Si no, no se abre run ni se llama a nadie.
  const pendingByDirection = new Map<Direction, PendingText[]>();
  for (const direction of DIRECTIONS) {
    pendingByDirection.set(direction, await selectPending(supabase, args.workspaceId, direction));
  }
  if ([...pendingByDirection.values()].every((rows) => rows.length === 0)) {
    return { ...out, reason: "no_pending" };
  }

  // 3. El modelo. Si el proveedor no está, se LANZA: la cola reintenta con
  //    backoff, que es lo correcto para una caída pasajera.
  const settings = resolveBackgroundSettings(args.backgroundSettings);
  const wanted = settings.message_classification.model;
  // F20: el modelo por defecto es EL MAS BARATO del proveedor configurado, no
  // el default del catalogo. Clasificar 543 textos cortos no necesita el
  // modelo grande, y la diferencia es el doble de precio por token.
  const preference = wanted
    ? { modelId: wanted }
    : ((await cheapestConfiguredModel(supabase, args.workspaceId)) ?? {});
  const resolved = await resolveModel(args.workspaceId, preference);
  if (!resolved.ok || !resolved.model) {
    throw new Error(`[clasificador] no hay proveedor de IA disponible: ${resolved.problem ?? "desconocido"}`);
  }

  const run = await openAiRun(supabase, {
    workspaceId: args.workspaceId,
    source: "message_classification",
    trigger: "job",
    provider: resolved.provider ?? null,
    model: resolved.modelId ?? null,
    promptVersion: PROMPT_VERSION,
  });
  out.runId = run.runId;

  let failure: string | null = null;

  try {
    for (const direction of DIRECTIONS) {
      // Un texto viaja al modelo una sola vez por corrida. Sin esto, los que
      // quedan diferidos por el tope de categorias vuelven a entrar en la
      // vuelta siguiente y se pagan dos veces por el mismo resultado.
      const yaIntentados = new Set<string>();
      let pending = (pendingByDirection.get(direction) ?? []).filter((t) => !yaIntentados.has(t.id));
      while (pending.length > 0) {
        if (clock().getTime() >= deadline) break;
        for (const t of pending.slice(0, CLASSIFIER_BATCH)) yaIntentados.add(t.id);

        const applied = await classifyBatch(supabase, {
          workspaceId: args.workspaceId,
          direction,
          pending,
          run,
          generate,
          model: resolved.model,
          nonce: makeNonce(),
          now: clock,
        });

        out.batches += 1;
        out.classified += applied.classified;
        out.byRule += applied.byRule;
        out.newCategories += applied.newCategories;
        out.newCategoryNames.push(...applied.newCategoryNames);
        out.invalid += applied.invalid;
        out.deferred += applied.deferred;
        if (applied.truncated) out.truncated += 1;

        // Si no avanzó nada, seguir pidiendo el mismo lote es un bucle.
        if (applied.classified + applied.byRule === 0) break;
        pending = (await selectPending(supabase, args.workspaceId, direction)).filter((t) => !yaIntentados.has(t.id));
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : "error desconocido";
  }

  // 4. ¿Quedó trabajo? Se encola la continuación, con su propia clave.
  const remaining = await countPending(supabase, args.workspaceId);
  const part = (args.part ?? 0) + 1;
  if (!failure && remaining > 0 && out.classified + out.byRule > 0 && part <= MAX_CONTINUATIONS) {
    const payload: BgTaskPayload = {
      workspaceId: args.workspaceId,
      task: "message_classification",
      window: args.window,
      part,
    };
    const queued = await enqueue(supabase, {
      dedupeKey: continuationDedupeKey(baseKeyOf(args.dedupeKey), part),
      payload,
      runAt: clock(),
    });
    out.continued = queued === "created";
  }

  const closed = await run.close({
    status: failure ? "error" : "completed",
    statusDetail: resumen(out, remaining),
    error: failure,
  });
  out.costUsd = closed.costUsd;
  out.pricingMissing = closed.pricingMissing;
  if (closed.pricingMissing.length > 0) {
    console.warn(
      `[clasificador] sin precio en model_pricing para ${closed.pricingMissing.join(", ")}: el run queda con costo desconocido.`,
    );
  }
  if (failure) throw new Error(failure);
  return out;
}

/** La clave de la ventana, sin el sufijo de continuación. */
function baseKeyOf(dedupeKey: string): string {
  const idx = dedupeKey.indexOf(":cont:");
  return idx < 0 ? dedupeKey : dedupeKey.slice(0, idx);
}

function resumen(out: ClassifyRunResult, remaining: number): string {
  return `lotes:${out.batches} clasificados:${out.classified} regla:${out.byRule} nuevas:${out.newCategories} invalidos:${out.invalid} diferidos:${out.deferred} pendientes:${remaining}`;
}

// ---------------------------------------------------------------------------
// Un lote
// ---------------------------------------------------------------------------

interface BatchOutcome {
  classified: number;
  byRule: number;
  newCategories: number;
  newCategoryNames: string[];
  invalid: number;
  deferred: number;
  truncated: boolean;
}

async function classifyBatch(
  supabase: Db,
  args: {
    workspaceId: string;
    direction: Direction;
    pending: PendingText[];
    run: Awaited<ReturnType<typeof openAiRun>>;
    generate: typeof generateText;
    model: NonNullable<Awaited<ReturnType<typeof getWorkspaceModel>>["model"]>;
    nonce: string;
    now: () => Date;
  },
): Promise<BatchOutcome> {
  const out: BatchOutcome = { classified: 0, byRule: 0, newCategories: 0, newCategoryNames: [], invalid: 0, deferred: 0, truncated: false };
  const lote = args.pending.slice(0, CLASSIFIER_BATCH);

  const categories = await loadCategories(supabase, args.workspaceId, args.direction);
  const emojiCategory = categories.find((c) => c.name === "Solo emoji o adjunto") ?? null;

  // Un texto que normaliza a vacío es solo emoji o adjunto: no hay nada que
  // interpretar, así que no viaja al modelo. El trigger de la 00079 ya los
  // atrapa al insertar; esto es la red por si alguno se coló.
  const vacios = lote.filter((t) => t.normalized_text.trim() === "");
  const aClasificar = lote.filter((t) => t.normalized_text.trim() !== "");
  if (vacios.length > 0 && emojiCategory) {
    const { error } = await supabase
      .from("message_texts")
      .update({ category_id: emojiCategory.id, source: "rule", classified_at: args.now().toISOString() })
      .in("id", vacios.map((t) => t.id))
      .is("source", null);
    if (!error) out.byRule += vacios.length;
  }
  if (aClasificar.length === 0) return out;

  const forPrompt: CategoryForPrompt[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    examples: c.examples,
  }));
  const request = {
    direction: args.direction,
    categories: forPrompt,
    corrections: await loadCorrections(supabase, args.workspaceId, args.direction),
    texts: aClasificar.map((t) => ({ id: t.id, text: t.sample_text })),
    maxNewCategories: maxNewFor(categories),
    nonce: args.nonce,
  };

  await args.run.step({
    kind: "model_call",
    name: `clasificar:${args.direction}`,
    input: { direction: args.direction, textos: aClasificar.length, categorias: categories.length, topeNuevas: request.maxNewCategories },
  });

  const result = await args.generate({
    model: args.model,
    system: buildSystemPrompt(request),
    prompt: buildBatchPrompt(request),
    temperature: 0,
    maxOutputTokens: 8_000,
  });
  args.run.addStepUsage(result.totalUsage);

  const parsed = parseClassifierOutput(result.text ?? "", request);
  out.truncated = parsed.truncated;
  out.invalid += parsed.invalid;

  const applied = await applyClassification(supabase, {
    workspaceId: args.workspaceId,
    direction: args.direction,
    items: { items: parsed.items },
    pendingIds: new Set(aClasificar.map((t) => t.id)),
    existingCategoryIds: new Set(categories.map((c) => c.id)),
    runId: args.run.runId,
    promptVersion: PROMPT_VERSION,
    maxNewCategories: request.maxNewCategories,
    createCategory: (name, description) => createModelCategory(supabase, args.workspaceId, args.direction, name, description),
    now: args.now(),
  });

  out.classified += applied.classified;
  out.newCategories += applied.newCategories;
  out.newCategoryNames.push(...applied.newCategoryNames);
  out.invalid += applied.invalid;
  out.deferred += applied.deferred;

  // Lo que el modelo no devolvió queda pendiente para la corrida siguiente.
  const sinRespuesta = aClasificar.length - parsed.items.length;
  if (sinRespuesta > 0) out.deferred += sinRespuesta;
  return out;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  examples: string[];
  isFallback: boolean;
  isSystem: boolean;
}

/**
 * El modelo de texto más barato entre los proveedores conectados, según
 * `model_pricing`.
 *
 * `getWorkspaceModel` sin preferencia cae al `default_model` del catálogo de
 * proveedores, que para Anthropic es Sonnet: el doble de precio por token que
 * Haiku, para decidir a cuál de cinco cajones va un "dale, mandámelo". El
 * criterio es la suma de entrada y salida, que es lo que se paga.
 *
 * Si no hay precios cargados devuelve null y se usa el default de siempre: un
 * catálogo de precios incompleto no puede dejar al clasificador sin modelo.
 */
async function cheapestConfiguredModel(
  supabase: Db,
  workspaceId: string,
): Promise<{ preferredProvider: string; modelId: string } | null> {
  const { data: configs } = await supabase
    .from("integration_configs")
    .select("provider")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("is_active", true);

  const textProviders = (configs ?? [])
    .map((c) => c.provider as string)
    .filter((id) => {
      const definition = getProvider(id);
      return definition ? isTextProvider(definition) : false;
    });
  if (textProviders.length === 0) return null;

  const { data: prices, error } = await supabase
    .from("model_pricing")
    .select("provider, model, input_per_mtok, output_per_mtok")
    .eq("workspace_id", workspaceId)
    .in("provider", textProviders)
    .lte("valid_from", new Date().toISOString());
  if (error || !prices || prices.length === 0) return null;

  let best: { preferredProvider: string; modelId: string; cost: number } | null = null;
  for (const row of prices) {
    const cost = Number(row.input_per_mtok ?? 0) + Number(row.output_per_mtok ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    if (!best || cost < best.cost) {
      best = { preferredProvider: row.provider as string, modelId: row.model as string, cost };
    }
  }
  return best ? { preferredProvider: best.preferredProvider, modelId: best.modelId } : null;
}

async function loadCategories(supabase: Db, workspaceId: string, direction: Direction): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("message_categories")
    .select("id, name, description, examples, is_fallback, created_by")
    .eq("workspace_id", workspaceId)
    .eq("direction", direction)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[clasificador] no pude leer las categorías:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    examples: (r.examples as string[] | null) ?? [],
    isFallback: Boolean(r.is_fallback),
    isSystem: r.created_by === "system",
  }));
}

/**
 * El tope de categorías nuevas del lote.
 *
 * F20 fija 3, pensando en el régimen diario. Con el catálogo recién nacido ese
 * número deja el backlog entero en "Otro": las 5 categorías que trae la 00079
 * son de sistema y no dicen nada del negocio. Mientras la dirección tenga
 * menos de 8 categorías propias, el tope sube; después vuelve a 3 solo.
 */
export function maxNewFor(categories: Array<{ isFallback: boolean; isSystem: boolean }>): number {
  const propias = categories.filter((c) => !c.isFallback && !c.isSystem).length;
  return propias < SEEDING_THRESHOLD ? SEEDING_MAX_NEW_CATEGORIES : MAX_NEW_CATEGORIES;
}

/** Las correcciones que hizo una persona: criterio que vale más que el del modelo. */
async function loadCorrections(supabase: Db, workspaceId: string, direction: Direction): Promise<CorrectionForPrompt[]> {
  const { data, error } = await supabase
    .from("message_texts")
    .select("sample_text, reviewed_at, message_categories(name)")
    .eq("workspace_id", workspaceId)
    .eq("direction", direction)
    .eq("source", "human")
    .not("category_id", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(MAX_CORRECTIONS);
  if (error) {
    console.error("[clasificador] no pude leer las correcciones:", error.message);
    return [];
  }
  const out: CorrectionForPrompt[] = [];
  for (const row of data ?? []) {
    const joined = (row as { message_categories?: { name?: string } | Array<{ name?: string }> }).message_categories;
    const name = Array.isArray(joined) ? joined[0]?.name : joined?.name;
    if (name) out.push({ text: row.sample_text as string, categoryName: name });
  }
  return out;
}

async function countPending(supabase: Db, workspaceId: string): Promise<number> {
  const { count, error } = await supabase
    .from("message_texts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("category_id", null)
    .is("source", null);
  if (error) {
    console.error("[clasificador] no pude contar los pendientes:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Crea una categoría propuesta por el modelo. Si el nombre ya existe (el único
 * parcial `uq_message_categories_name` es por nombre en minúsculas), se reusa
 * la que hay: dos corridas no tienen por qué inventar sinónimos.
 */
async function createModelCategory(
  supabase: Db,
  workspaceId: string,
  direction: Direction,
  name: string,
  description: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("message_categories")
    .insert({ workspace_id: workspaceId, direction, name, description, created_by: "model" })
    .select("id")
    .single();
  if (!error && data) return data.id as string;

  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("message_categories")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("direction", direction)
      .ilike("name", name)
      .is("archived_at", null)
      .maybeSingle();
    return (existing?.id as string | undefined) ?? null;
  }
  console.error("[clasificador] no pude crear la categoría propuesta:", error?.message ?? "sin detalle");
  return null;
}
