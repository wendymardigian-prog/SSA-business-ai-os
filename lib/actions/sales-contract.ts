"use server";

import { z } from "zod";
import { appUrl } from "@/lib/app-url";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { sendTransactionalEmail } from "@/lib/email/send";
import { bodyToHtml } from "@/lib/flow-engine/nodes/send-email";
import { fieldsOf } from "@/lib/forms/server-ports";
import { buildPrefillLink } from "@/lib/forms/prefill";
import { signFormLink } from "@/lib/forms/signed-link";
import { buildContractPrefill, contractMessage, type ContractPrefill } from "@/lib/sales/contract";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Enviar el contrato desde la venta (plano F26b). Pide `sales.manage` y que la persona VEA la
 * venta (la RLS decide: se lee con su sesión). Los formularios publicados de tipo contrato se
 * leen con el cliente de servicio, pero solo DESPUÉS de comprobar la venta.
 *
 * El `sale_id` viaja dentro del token FIRMADO del link (`signFormLink`), nunca como parámetro
 * suelto, y los datos de la venta se prellenan como parámetros de URL (así prellena Formularios).
 * Generar el link queda en el historial de la venta (`sale.contract_sent`, con el `form_id`):
 * de ahí sale el «Enviado sin firmar» de la ficha.
 */

export type ContractResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const uuid = z.string().uuid();
const NO_PERMISSION = "No tenés permiso para enviar contratos";
const CLOSED = ["cancelled", "refunded", "subscription_cancelled"];

export interface ContractFormOption {
  id: string;
  name: string;
  versionNumber: number;
  /** El texto de la versión publicada (recortado para la vista previa). */
  text: string;
  textTruncated: boolean;
  preview: ContractPrefill["preview"];
}

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

async function loadSale(ctx: Ctx, saleId: string) {
  const { data: sale } = await ctx.supabase
    .from("sales")
    .select("id, contact_id, status, product_snapshot, final_amount, service_starts_at")
    .eq("id", saleId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!sale) return null;
  const { data: contact } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email, phone")
    .eq("id", sale.contact_id)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  return contact ? { sale, contact } : null;
}

async function loadContractForm(ctx: Ctx, formId: string) {
  const service = await createServiceClient();
  const { data: form } = await service
    .from("forms")
    .select("id, name, slug, status, type, current_version_id")
    .eq("id", formId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!form || form.type !== "contract" || form.status !== "published" || !form.current_version_id) return null;
  const { data: version } = await service
    .from("form_versions")
    .select("id, version_number, definition, contract_text")
    .eq("id", form.current_version_id)
    .maybeSingle();
  return version ? { service, form, version } : null;
}

/** Los contratos publicados, cada uno con el texto y lo que se va a prellenar con esta venta. */
export async function listContractForms(input: { saleId: string }): Promise<ContractResult<{ forms: ContractFormOption[] }>> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(input.saleId).success) return { ok: false, error: "Los datos no son válidos" };
  const loaded = await loadSale(ctx, input.saleId);
  if (!loaded) return { ok: false, error: "No encontré esa venta" };
  if (CLOSED.includes(loaded.sale.status)) return { ok: false, error: "Esta venta ya no está activa" };

  const service = await createServiceClient();
  const { data: forms } = await service
    .from("forms")
    .select("id, name, current_version_id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("type", "contract")
    .eq("status", "published")
    .not("current_version_id", "is", null)
    .order("name");
  const versionIds = (forms ?? []).map((f) => f.current_version_id as string);
  const { data: versions } = versionIds.length
    ? await service.from("form_versions").select("id, version_number, definition, contract_text").in("id", versionIds)
    : { data: [] as Array<{ id: string; version_number: number; definition: unknown; contract_text: string | null }> };
  const byId = new Map((versions ?? []).map((v) => [v.id, v]));

  const options: ContractFormOption[] = [];
  for (const form of forms ?? []) {
    const version = byId.get(form.current_version_id as string);
    if (!version) continue;
    const text = version.contract_text ?? "";
    options.push({
      id: form.id,
      name: form.name,
      versionNumber: version.version_number,
      text: text.slice(0, 1500),
      textTruncated: text.length > 1500,
      preview: buildContractPrefill(loaded.sale, loaded.contact, fieldsOf(version.definition as never)).preview,
    });
  }
  return { ok: true, forms: options };
}

export interface ContractLink {
  url: string;
  message: string;
  contactName: string;
  hasEmail: boolean;
  /** Las conversaciones del contacto (WhatsApp / Instagram) que esta persona puede abrir. */
  conversations: Array<{ id: string; platform: string }>;
}

async function buildLink(ctx: Ctx, saleId: string, formId: string): Promise<ContractResult<{ link: ContractLink; contactId: string; formName: string }>> {
  if (!uuid.safeParse(saleId).success || !uuid.safeParse(formId).success) return { ok: false, error: "Los datos no son válidos" };
  const loaded = await loadSale(ctx, saleId);
  if (!loaded) return { ok: false, error: "No encontré esa venta" };
  if (CLOSED.includes(loaded.sale.status)) return { ok: false, error: "Esta venta ya no está activa" };
  const form = await loadContractForm(ctx, formId);
  if (!form) return { ok: false, error: "Ese contrato no está publicado" };

  try {
    const prefill = buildContractPrefill(loaded.sale, loaded.contact, fieldsOf(form.version.definition as never));
    const signed = await signFormLink(form.service, {
      workspaceId: ctx.workspace.id,
      formId: form.form.id,
      slug: form.form.slug,
      contactId: loaded.contact.id,
      saleId: loaded.sale.id,
      baseUrl: appUrl(),
    });
    const url = buildPrefillLink(signed, prefill.params);
    const { data: conversations } = await ctx.supabase
      .from("conversations")
      .select("id, platform")
      .eq("contact_id", loaded.contact.id)
      .eq("workspace_id", ctx.workspace.id)
      .in("platform", ["whatsapp", "instagram"])
      .order("last_message_at", { ascending: false, nullsFirst: false });
    return {
      ok: true,
      contactId: loaded.contact.id,
      formName: form.form.name,
      link: {
        url,
        message: contractMessage({ contactName: loaded.contact.display_name, formName: form.form.name, url }),
        contactName: loaded.contact.display_name || loaded.contact.email || "Contacto",
        hasEmail: !!loaded.contact.email?.trim(),
        conversations: conversations ?? [],
      },
    };
  } catch (error) {
    console.error("[sales] no pude armar el link del contrato:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos armar el link. Probá de nuevo." };
  }
}

/** Genera el link firmado (con el `sale_id` adentro del token) y deja el envío en el historial. */
export async function generateContractLink(input: { saleId: string; formId: string }): Promise<ContractResult<{ link: ContractLink }>> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const built = await buildLink(ctx, input.saleId, input.formId);
  if (!built.ok) return built;
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "sale",
    entityId: input.saleId,
    action: "sale.contract_sent",
    metadata: { form_id: input.formId, form_name: built.formName, channel: "link" },
    performedBy: ctx.user.id,
  });
  return { ok: true, link: built.link };
}

/**
 * Manda el link por email al contacto (Resend, el envío transaccional de siempre). El link se
 * arma de nuevo en el servidor: nunca se acepta una URL del navegador para mandar por email.
 */
export async function emailContractLink(input: { saleId: string; formId: string }): Promise<ContractResult<{ message: string }>> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const built = await buildLink(ctx, input.saleId, input.formId);
  if (!built.ok) return built;
  const loaded = await loadSale(ctx, input.saleId);
  const to = loaded?.contact.email?.trim();
  if (!to) return { ok: false, error: "Este contacto no tiene email" };

  const result = await sendTransactionalEmail({
    workspaceId: ctx.workspace.id,
    to,
    subject: `Firmá ${built.formName}`,
    html: bodyToHtml(built.link.message),
    kind: "sale_contract_link",
    relatedEntityType: "sale",
    relatedEntityId: input.saleId,
    contactId: built.contactId,
    createdBy: ctx.user.id,
  });
  if (!result.ok) {
    return { ok: false, error: result.reason === "not_configured" ? "Todavía no conectaste Resend: no se puede mandar por email." : "No se pudo mandar el email. Probá de nuevo." };
  }
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "sale",
    entityId: input.saleId,
    action: "sale.contract_sent",
    metadata: { form_id: input.formId, form_name: built.formName, channel: "email" },
    performedBy: ctx.user.id,
  });
  return { ok: true, message: "Le mandamos el contrato por email." };
}
