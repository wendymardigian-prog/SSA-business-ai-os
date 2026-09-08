"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit, diffFields } from "@/lib/audit";

/**
 * Frases de opt-out del workspace (F18).
 *
 * Son la lista con la que apply_opt_out_check (migracion 00027) decide si un
 * mensaje entrante marca al contacto como "no contactar". Editarlas cambia el
 * comportamiento del sistema sobre leads reales, asi que es de Owner/Admin y
 * queda registrado en el audit log.
 *
 * Se guardan normalizadas (minusculas, sin espacios de mas) porque asi las
 * compara la base: guardarlas con mayusculas no rompe nada, pero hace que la
 * lista que se ve no sea la que se aplica.
 */

const MIN_PHRASE = 2;
const MAX_PHRASE = 60;
const MAX_PHRASES = 50;

export type OptOutActionResult = { ok: true } | { ok: false; error: string };

export async function updateOptOutPhrases(phrases: string[]): Promise<OptOutActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden cambiar las frases de no contactar" };
  }

  const { workspace, supabase, user } = ctx;

  if (!Array.isArray(phrases)) return { ok: false, error: "Formato invalido" };
  if (phrases.length > MAX_PHRASES) {
    return { ok: false, error: `Son demasiadas frases (maximo ${MAX_PHRASES})` };
  }

  const clean: string[] = [];
  for (const raw of phrases) {
    if (typeof raw !== "string") continue;
    const phrase = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!phrase) continue;

    if (phrase.length < MIN_PHRASE) {
      return {
        ok: false,
        error: `"${phrase}" es muy corta. Una frase de una o dos letras marca leads por error.`,
      };
    }
    if (phrase.length > MAX_PHRASE) {
      return { ok: false, error: `"${phrase.slice(0, 20)}..." es muy larga (maximo ${MAX_PHRASE} caracteres)` };
    }
    if (!clean.includes(phrase)) clean.push(phrase);
  }

  const { data: before } = await supabase
    .from("workspaces")
    .select("opt_out_phrases")
    .eq("id", workspace.id)
    .single();

  const { error } = await supabase
    .from("workspaces")
    .update({ opt_out_phrases: clean })
    .eq("id", workspace.id);

  if (error) {
    console.error("[opt-out] no pude guardar las frases:", error.message);
    return { ok: false, error: `No pude guardar las frases: ${error.message}` };
  }

  const changes = diffFields(
    { opt_out_phrases: (before?.opt_out_phrases ?? []).join(", ") },
    { opt_out_phrases: clean.join(", ") },
  );

  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
      action: "update", changes, metadata: { section: "opt_out_phrases" }, performedBy: user.id,
    });
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/**
 * Cual de las frases atraparia este mensaje, con la MISMA funcion que corre el
 * receptor (text_matches_phrase, migracion 00027). Existe para que quien
 * configura vea el efecto antes de guardar: "baja" parece razonable hasta que
 * se ve que marca a quien escribe "mi hermana trabaja con ustedes".
 *
 * Prueba la lista entera de un saque y devuelve la primera que matchea. Una
 * llamada por frase seria mas simple de escribir, pero son doce viajes al
 * servidor para responder una sola pregunta.
 *
 * Usa la service key porque la funcion es de sistema, pero no lee ni escribe
 * ningun dato: solo compara los textos que le mandan.
 */
export async function findMatchingOptOutPhrase(
  text: string,
  phrases: string[],
): Promise<{ phrase: string | null }> {
  const ctx = await getAdminContext();
  if (!ctx) return { phrase: null };

  const message = (text ?? "").trim();
  if (!message || !Array.isArray(phrases) || phrases.length === 0) return { phrase: null };

  const service = await createServiceClient();

  for (const phrase of phrases.slice(0, MAX_PHRASES)) {
    if (typeof phrase !== "string" || !phrase.trim()) continue;

    const { data, error } = await service.rpc("text_matches_phrase", {
      p_text: message,
      p_phrase: phrase,
    });

    if (error) {
      console.error("[opt-out] no pude probar la frase:", error.message);
      return { phrase: null };
    }
    if (data) return { phrase };
  }

  return { phrase: null };
}
