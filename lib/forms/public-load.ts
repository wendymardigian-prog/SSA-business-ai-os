/**
 * Cómo la página pública lee un formulario. SOLO servidor.
 *
 * La ÚNICA puerta es `get_public_form` (lista blanca en la base): nunca un
 * `select` sobre `forms` con el cliente de servicio para armar lo que ve el
 * público. La vista previa del editor es la excepción y se lee con el cliente
 * DE LA PERSONA, así que la RLS (`can_view_forms`) decide si puede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBrand } from "@/lib/brand";
import type { Database } from "@/lib/types/database";
import { SLUG_PATTERN } from "./list";
import { fieldsOf } from "./server-ports";
import { toPublicFields } from "./public-definition";
import { verifyFormLink } from "./signed-link";
import { CONTRACTS_BUCKET } from "./contract/storage";
import { loadContractLinkContext } from "./contract/link-context";
import type { PublicFormData, PublicFormResult } from "./public-client";

type Db = SupabaseClient<Database>;

export async function loadPublicFormData(service: Db, slug: string): Promise<PublicFormResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "unavailable" };
  const { data, error } = await service.rpc("get_public_form", { p_slug: slug });
  if (error || !data || typeof data !== "object") return { status: "unavailable" };
  const result = data as unknown as PublicFormResult;
  if (result.status !== "available") return { status: "unavailable" };
  const withName = { ...result, business_name: await formBusinessName(service, slug) };
  return withSignerUrl(service, withName);
}

/**
 * El nombre del negocio dueño del formulario (00266): con dos negocios en la instalación, un contrato de uno no
 * puede decir el nombre del otro. Es la misma regla que usa el servidor al firmar (`loadPublishedForm`). Ante
 * cualquier error, el de la instalación (lo de siempre): la página nunca se cae por esto.
 */
async function formBusinessName(db: Db, slug: string): Promise<string> {
  try {
    const { data: form } = await db.from("forms").select("workspace_id").ilike("slug", slug).maybeSingle();
    if (!form) return resolveBrand(null).name;
    const { data: workspace } = await db.from("workspaces").select("brand_name").eq("id", form.workspace_id).maybeSingle();
    return resolveBrand(workspace).name;
  } catch {
    return resolveBrand(null).name;
  }
}

/**
 * La firma del negocio (modo Contrato) sale de `get_public_form` con la RUTA de su imagen en el bucket privado: acá
 * se cambia por un link temporal (1 hora) y la ruta no llega al navegador. Sin poder firmar el link, la firma se
 * muestra sin imagen (el PDF la lleva igual).
 */
async function withSignerUrl(service: Db, form: PublicFormData): Promise<PublicFormData> {
  const signer = form.contract?.business_signer as (NonNullable<NonNullable<PublicFormData["contract"]>["business_signer"]> & { signature_path?: string }) | null | undefined;
  if (!form.contract || !signer) return form;
  const { signature_path: path, ...rest } = signer;
  let url: string | null = null;
  if (typeof path === "string" && path) {
    try {
      const { data } = await service.storage.from(CONTRACTS_BUCKET).createSignedUrl(path, 60 * 60);
      url = data?.signedUrl ?? null;
    } catch {
      url = null;
    }
  }
  return { ...form, contract: { ...form.contract, business_signer: { ...rest, signature_url: url } } };
}

/**
 * Modo Contrato con un link firmado (`?c=`): los datos del contacto y de la venta para MOSTRAR las variables del paso
 * 2. El token se verifica igual que al enviar; uno inválido no da error, solo no completa nada. El texto que se firma
 * lo vuelve a armar el servidor al enviar.
 */
export async function loadPublicContractContext(service: Db, slug: string, token: string | null | undefined, verify: typeof verifyFormLink = verifyFormLink) {
  if (!token || !SLUG_PATTERN.test(slug)) return null;
  const { data: form } = await service.from("forms").select("id, workspace_id, type, status, contract_config").ilike("slug", slug).eq("status", "published").maybeSingle();
  if (!form || form.type !== "contract" || (form.contract_config as { mode?: string } | null)?.mode !== "contract") return null;
  const link = await verify(service, token, { workspaceId: form.workspace_id, formId: form.id });
  if (!link.ok) return null;
  try {
    return await loadContractLinkContext(service, form.workspace_id, link);
  } catch {
    return null;
  }
}

/** El borrador tal como lo vería quien responde. Con el cliente del usuario: la RLS decide. */
export async function loadPreviewFormData(userClient: Db, slug: string): Promise<PublicFormData | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const { data: form } = await userClient
    .from("forms")
    .select("slug, type, draft_definition, design, contract_config, survey_config")
    .ilike("slug", slug)
    .maybeSingle();
  // Un reporte de fin de día no tiene página pública: tampoco vista previa.
  if (!form || form.type === "eod") return null;

  const design = (form.design ?? {}) as PublicFormData["design"];
  const contract = form.contract_config as { title?: string; acceptLabel?: string; signatureRequired?: boolean; mode?: string; businessSigner?: { enabled?: boolean; name?: string; role?: string; signaturePath?: string | null } } | null;
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
        ? {
            text: draft?.contractText ?? "",
            version_number: 0,
            title: contract?.title ?? null,
            accept_label: contract?.acceptLabel ?? null,
            mode: contract?.mode === "contract" ? "contract" : "terms",
            business_signer:
              contract?.mode === "contract" && contract.businessSigner?.enabled && contract.businessSigner.name
                ? { name: contract.businessSigner.name, role: contract.businessSigner.role ?? null, signature_url: null }
                : null,
          }
        : null,
    signature_required: form.type === "contract" ? (contract?.signatureRequired ?? true) : false,
    survey: form.type === "survey" ? { scoreFieldKey: (form.survey_config as { scoreFieldKey?: string } | null)?.scoreFieldKey ?? null } : null,
    business_name: await formBusinessName(userClient, slug),
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
