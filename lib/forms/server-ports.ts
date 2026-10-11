/**
 * Los puertos REALES del envío y del beacon: base, Vault, Turnstile y Storage.
 * SOLO servidor. `submit.ts` y `beacon.ts` no saben nada de esto: reciben estos
 * puertos, y los tests reciben unos simulados.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { checkLimit, formsKeys } from "@/lib/antispam/rate-limit";
import { hashIp } from "@/lib/scheduling/antispam";
import { verifyTurnstile } from "./turnstile";
import { validateSuccess, DEFAULT_SUCCESS } from "./success";
import { parseStoredContactConfig, isCustomTarget, customSlugOf, type CustomFieldDef } from "./contact-config";
import { verifyFormLink } from "./signed-link";
import { notifyRecipients, contactOutcome, notificationContent } from "./notify";
import { parseStoredContractConfig } from "./contract/config";
import { CONTRACTS_BUCKET } from "./contract/storage";
import { recordFormTouch } from "@/lib/contacts/touch-entry";
import { createNotification } from "@/lib/notifications/create";
import { SLUG_PATTERN } from "./list";
import type { FormField, FormType } from "./fields";
import type { BeaconPorts } from "./beacon";
import type { ExistingSubmission, LoadedForm, SaveInput, SaveResult, SubmitPorts } from "./submit";

type Db = SupabaseClient<Database>;

export const UPLOADS_BUCKET = "form-uploads";
export { CONTRACTS_BUCKET };

/** Los campos de una definición guardada (jsonb) como `FormField[]`. */
export function fieldsOf(definition: Json | null | undefined): FormField[] {
  const raw = (definition as { fields?: unknown } | null)?.fields;
  return Array.isArray(raw) ? (raw as FormField[]) : [];
}

export async function loadPublishedForm(service: Db, slug: string): Promise<LoadedForm | null> {
  if (!SLUG_PATTERN.test(slug)) return null;

  const { data: form } = await service
    .from("forms")
    .select("id, workspace_id, name, type, slug, status, success, current_version_id, contact_config, notify_enabled, notify_user_ids, contract_config")
    .ilike("slug", slug)
    .eq("status", "published")
    .not("current_version_id", "is", null)
    .maybeSingle();
  if (!form?.current_version_id) return null;

  const [{ data: version }, { data: workspace }] = await Promise.all([
    service.from("form_versions").select("id, version_number, definition").eq("id", form.current_version_id).maybeSingle(),
    service.from("workspaces").select("timezone").eq("id", form.workspace_id).maybeSingle(),
  ]);
  if (!version) return null;

  const success = validateSuccess(form.success);
  const contactConfig = parseStoredContactConfig(form.contact_config);
  return {
    id: form.id,
    workspaceId: form.workspace_id,
    name: form.name,
    type: form.type as FormType,
    slug: form.slug,
    versionId: version.id,
    versionNumber: version.version_number,
    fields: fieldsOf(version.definition),
    success: success.ok ? success.success : DEFAULT_SUCCESS,
    workspaceTimezone: workspace?.timezone ?? "UTC",
    contactConfig,
    customFields: await loadCustomFields(service, form.workspace_id, contactConfig.map.map((m) => m.target)),
    notifyEnabled: form.notify_enabled,
    notifyUserIds: form.notify_user_ids ?? [],
    contract: form.type === "contract" ? parseStoredContractConfig(form.contract_config, form.name) : null,
  };
}

/** Los campos personalizados que el mapeo nombra (si no nombra ninguno, ni se consulta). */
async function loadCustomFields(service: Db, workspaceId: string, targets: string[]): Promise<CustomFieldDef[]> {
  const slugs = targets.filter(isCustomTarget).map(customSlugOf);
  if (slugs.length === 0) return [];
  const { data } = await service.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", workspaceId).in("slug", slugs);
  return (data ?? []) as CustomFieldDef[];
}

export function createSubmitPorts(service: Db, options: { fetchImpl?: typeof fetch } = {}): SubmitPorts {
  return {
    limit: (spec) => checkLimit(service, spec),
    limitKeys: { submit: formsKeys.submit, submitForm: formsKeys.submitForm },
    hashIp,
    loadForm: (slug) => loadPublishedForm(service, slug),

    async findSubmission(formId, idempotencyKey): Promise<ExistingSubmission | null> {
      const { data } = await service
        .from("form_submissions")
        .select("id, status, answers, attribution")
        .eq("form_id", formId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        answers: (data.answers ?? {}) as ExistingSubmission["answers"],
        attribution: (data.attribution ?? {}) as Record<string, unknown>,
      };
    },

    async turnstileSecret(workspaceId) {
      try {
        return await readSecret(service, workspaceId, SECRET_NAMES.turnstileSecretKey);
      } catch {
        // Una falla de Vault no puede dejar pasar un envio sin verificar: se trata como "no disponible".
        return null;
      }
    },

    verifyTurnstile: (input) => verifyTurnstile({ ...input, fetchImpl: options.fetchImpl }),

    async recordRejected({ workspaceId, formId, versionId, reason }) {
      // Sin datos personales: ni IP, ni user agent, ni nada de lo que escribio la persona.
      const { error } = await service.from("analytics_events").insert({
        workspace_id: workspaceId,
        event_type: "form_rejected",
        contact_id: null,
        flow_id: null,
        metadata: { form_id: formId, version_id: versionId, reason },
      });
      if (error) console.error("[forms] no pude registrar el rechazo:", error.message);
    },

    async upload(path, bytes, mime) {
      const { error } = await service.storage.from(UPLOADS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (error) console.error("[forms] no pude subir un archivo:", error.message);
      return !error;
    },

    async uploadContractFile(path, bytes, mime) {
      const { error } = await service.storage.from(CONTRACTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (error) console.error("[forms] no pude subir la firma:", error.message);
      return !error;
    },

    async discardContractFile(path) {
      const { error } = await service.storage.from(CONTRACTS_BUCKET).remove([path]);
      if (error) console.error("[forms] no pude borrar una firma que quedo sin respuesta:", error.message);
    },

    async save(input: SaveInput): Promise<SaveResult> {
      const { data, error } = await service.rpc("submit_form_response", {
        p_form_id: input.form.id,
        p_version_id: input.form.versionId,
        p_idempotency_key: input.idempotencyKey,
        p_answers: input.answers as unknown as Json,
        p_attribution: input.attribution as unknown as Json,
        p_meta: input.meta as unknown as Json,
        p_contact_hint: input.contactHint as unknown as Json,
        p_extra: {
          ...(input.uploadPrefix ? { upload_prefix: input.uploadPrefix } : {}),
          // Contrato: lo que `record_contract_signature` guarda. El texto NO viaja: la base usa el de la version.
          ...(input.contract
            ? {
                signature_path: input.contract.signaturePath,
                legal: input.contract.legal,
                signer_name: input.contract.signerName,
                signer_email: input.contract.signerEmail,
              }
            : {}),
        } as unknown as Json,
      });
      if (error) {
        if (error.code === "23505" && /uq_form_submissions_once/.test(error.message)) {
          return { ok: false, error: "already_answered" };
        }
        // Solo el codigo: el mensaje puede traer datos de la fila.
        console.error(`[forms] submit_form_response fallo (form=${input.form.id}, code=${error.code ?? "?"})`);
        return { ok: false, error: "failed" };
      }
      if (!data || data.ok !== true) return { ok: false, error: data?.error === "already_answered" ? "already_answered" : "failed" };
      return {
        ok: true,
        duplicate: data.duplicate === true,
        submissionId: data.submission_id,
        status: data.status,
        contactId: data.contact_id ?? null,
        contactCreated: data.contact_created === true,
        matchedBy: data.matched_by ?? null,
        conflictContactId: data.conflict_contact_id ?? null,
        signatureId: data.signature_id ?? null,
      };
    },

    async verifyLink(form, token) {
      const result = await verifyFormLink(service, token, { workspaceId: form.workspaceId, formId: form.id });
      return result.ok ? { contactId: result.contactId, serviceId: result.serviceId, saleId: result.saleId } : null;
    },

    async recordTouch({ form, submissionId, contactId, attribution }) {
      await recordFormTouch(service, {
        workspaceId: form.workspaceId,
        contactId,
        submissionId,
        formId: form.id,
        formName: form.name,
        attribution,
      });
    },

    async notify({ form, submissionId, contactId, contactCreated }) {
      const { title, body } = notificationContent({ formName: form.name, type: form.type, outcome: contactOutcome({ contactId, contactCreated }) });
      for (const recipientId of notifyRecipients({ notifyEnabled: form.notifyEnabled, notifyUserIds: form.notifyUserIds })) {
        await createNotification({
          supabase: service,
          workspaceId: form.workspaceId,
          type: "form_submitted",
          title,
          body,
          entityType: "form_submission",
          entityId: submissionId,
          recipientId,
          metadata: { form_id: form.id },
        });
      }
    },

    newId: () => randomUUID(),
  };
}

export function createBeaconPorts(service: Db): BeaconPorts {
  return {
    limit: (spec) => checkLimit(service, spec),
    limitKeys: { beacon: formsKeys.beacon, session: formsKeys.session },
    async loadPublishedForm(slug) {
      const form = await loadPublishedForm(service, slug);
      return form ? { id: form.id, workspaceId: form.workspaceId, versionId: form.versionId } : null;
    },
    async insertEvent({ workspaceId, eventType, metadata }) {
      const { error } = await service.from("analytics_events").insert({
        workspace_id: workspaceId,
        event_type: eventType,
        contact_id: null,
        flow_id: null,
        metadata,
      });
      if (error) console.error("[forms] no pude registrar la vista:", error.message);
    },
  };
}

/** ¿Hay Turnstile listo para publicar? Site key guardada y secret key en Vault. */
export async function isTurnstileConfigured(service: Db, workspaceId: string): Promise<boolean> {
  const { data } = await service
    .from("integration_configs")
    .select("config, is_active")
    .eq("workspace_id", workspaceId)
    .eq("type", "captcha")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const siteKey = (data?.config as { site_key?: string } | null)?.site_key;
  if (!siteKey) return false;
  try {
    const secret = await readSecret(service, workspaceId, SECRET_NAMES.turnstileSecretKey);
    return !!secret;
  } catch {
    return false;
  }
}
