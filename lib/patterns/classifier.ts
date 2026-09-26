import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { z } from "zod";

type Db = SupabaseClient<Database>;

/** Ítem que devuelve el modelo por cada texto a clasificar (F20). */
export const classifierItemSchema = z.object({
  text_id: z.string(),
  category_id: z.string().nullish(),
  new_category: z.object({ name: z.string().min(1), description: z.string().nullish() }).nullish(),
  confidence: z.number().min(0).max(1),
});
export const classifierOutputSchema = z.object({ items: z.array(classifierItemSchema) });
export type ClassifierItem = z.infer<typeof classifierItemSchema>;

export const CLASSIFIER_BATCH = 200;
export const MAX_NEW_CATEGORIES = 3;

export interface PendingText {
  id: string;
  normalized_text: string;
  sample_text: string;
}

/** Textos sin clasificar: category_id IS NULL AND source IS NULL. */
export async function selectPending(client: Db, workspaceId: string, direction: "inbound" | "outbound", limit = CLASSIFIER_BATCH): Promise<PendingText[]> {
  const { data, error } = await client
    .from("message_texts")
    .select("id, normalized_text, sample_text")
    .eq("workspace_id", workspaceId)
    .eq("direction", direction)
    .is("category_id", null)
    .is("source", null)
    .limit(limit);
  if (error) {
    console.error("[classifier] no pude leer los pendientes:", error.message);
    return [];
  }
  return (data ?? []) as PendingText[];
}

export interface ApplyResult {
  classified: number;
  newCategories: number;
  invalid: number;
  toFallback: number;
}

/**
 * Aplica lo que devolvió el modelo (F20). Reglas:
 *  - máximo 3 categorías nuevas por corrida; las que sobren van a "Otro".
 *  - nunca toca filas con source 'human' o 'rule' (no están entre los pendientes).
 *  - un ítem inválido (sin categoría ni nueva, o id inexistente) queda sin
 *    clasificar y se cuenta como inválido.
 */
export async function applyClassification(
  client: Db,
  args: {
    workspaceId: string;
    direction: "inbound" | "outbound";
    items: unknown;
    pendingIds: Set<string>;
    existingCategoryIds: Set<string>;
    fallbackCategoryId: string;
    runId: string | null;
    promptVersion: number;
    createCategory: (name: string, description: string | null) => Promise<string | null>;
    now?: Date;
  },
): Promise<ApplyResult> {
  const parsed = classifierOutputSchema.safeParse(args.items);
  const result: ApplyResult = { classified: 0, newCategories: 0, invalid: 0, toFallback: 0 };
  if (!parsed.success) return { ...result, invalid: args.pendingIds.size };

  const now = (args.now ?? new Date()).toISOString();
  let newCats = 0;

  for (const item of parsed.data.items) {
    if (!args.pendingIds.has(item.text_id)) {
      result.invalid += 1;
      continue;
    }
    let categoryId: string | null = null;

    if (item.category_id && args.existingCategoryIds.has(item.category_id)) {
      categoryId = item.category_id;
    } else if (item.new_category) {
      if (newCats < MAX_NEW_CATEGORIES) {
        const created = await args.createCategory(item.new_category.name, item.new_category.description ?? null);
        if (created) {
          categoryId = created;
          args.existingCategoryIds.add(created);
          newCats += 1;
          result.newCategories += 1;
        }
      }
      if (!categoryId) {
        // Se pasó del tope de 3 nuevas: va a "Otro".
        categoryId = args.fallbackCategoryId;
        result.toFallback += 1;
      }
    } else {
      result.invalid += 1;
      continue;
    }

    const { error } = await client
      .from("message_texts")
      .update({ category_id: categoryId, source: "model", confidence: item.confidence, prompt_version: args.promptVersion, run_id: args.runId, classified_at: now })
      .eq("id", item.text_id)
      .is("source", null); // nunca pisa human/rule
    if (error) result.invalid += 1;
    else result.classified += 1;
  }

  return result;
}
