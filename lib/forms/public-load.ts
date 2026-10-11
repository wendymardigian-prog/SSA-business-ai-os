/**
 * Cómo la página pública lee un formulario. SOLO servidor.
 *
 * La ÚNICA puerta es `get_public_form` (lista blanca en la base): nunca un
 * `select` sobre `forms` con el cliente de servicio para armar lo que ve el
 * público. La vista previa del editor es la excepción y se lee con el cliente
 * DE LA PERSONA, así que la RLS (`can_view_forms`) decide si puede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { SLUG_PATTERN } from "./list";
import { fieldsOf } from "./server-ports";
import { toPublicFields } from "./public-definition";
import { verifyFormLink } from "./signed-link";
import type { PublicFormData, PublicFormResult } from "./public-client";

type Db = SupabaseClient<Database>;

export async function loadPublicFormData(service: Db, slug: string): Promise<PublicFormResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "unavailable" };
  const { data, error } = await service.rpc("get_public_form", { p_slug: slug });
  if (error || !data || typeof data !== "object") return { status: "unavailable" };
  const result = data as unknown as PublicFormResult;
  return result.status === "available" ? result : { status: "unavailable" };
}

/** El borrador tal como lo vería quien responde. Con el cliente del usuario: la RLS decide. */
export async function loadPreviewFormData(userClient: Db, slug: string): Promise<PublicFormData | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const { data: form } = await userClient
    .from("forms")
    .select("slug, type, draft_definition, design, contract_config, survey_config")
    .ilike("slug", slug)
    .maybeSingle();
  if (!form) return null;

  const design = (form.design ?? {}) as PublicFormData["design"];
  const contract = form.contract_config as { title?: string; acceptLabel?: string; signatureRequired?: boolean } | null;
  const draft = form.draft_definition as { contractText?: string } | null;

  return {
    status: "available",
    slug: form.slug,
    type: form.type as PublicFormData["type"],
    version_id: "preview",
    design: {
      title: design.title,
      intro: design.intro,
      submitLabel: design.submitLabel,
      showLogo: design.showLogo,
    },
    fields: toPublicFields(fieldsOf(form.draft_definition)),
    contract:
      form.type === "contract"
        ? { text: draft?.contractText ?? "", version_number: 0, title: contract?.title ?? null, accept_label: contract?.acceptLabel ?? null }
        : null,
    signature_required: form.type === "contract" ? (contract?.signatureRequired ?? true) : false,
    survey: form.type === "survey" ? { scoreFieldKey: (form.survey_config as { scoreFieldKey?: string } | null)?.scoreFieldKey ?? null } : null,
    turnstile_site_key: null,
  };
}

/**
 * "Ya respondiste" ANTES de mostrar la encuesta (F22): con un link firmado válido
 * (`?c=`) de una encuesta con "una vez por contacto", si ese contacto ya respondió
 * (y la respuesta no es spam), la página lo dice sin armar el formulario.
 *
 * Con el cliente de servicio: la persona no tiene sesión. Un token inválido, vencido o
 * de otro formulario se ignora y la página funciona como si no hubiera `c`: nunca da error.
 */
export async function isAlreadyAnswered(
  service: Db,
  slug: string,
  token: string | null | undefined,
  verify: typeof verifyFormLink = verifyFormLink,
): Promise<boolean> {
  if (!token || !SLUG_PATTERN.test(slug)) return false;

  const { data: form } = await service
    .from("forms")
    .select("id, workspace_id, type, status, survey_config")
    .ilike("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!form || form.type !== "survey") return false;
  if ((form.survey_config as { oncePerContact?: boolean } | null)?.oncePerContact !== true) return false;

  const link = await verify(service, token, { workspaceId: form.workspace_id, formId: form.id });
  if (!link.ok) return false;

  const { data: existing } = await service
    .from("form_submissions")
    .select("id")
    .eq("form_id", form.id)
    .eq("once_key", `contact:${link.contactId}`)
    .neq("status", "spam")
    .limit(1)
    .maybeSingle();
  return !!existing;
}
