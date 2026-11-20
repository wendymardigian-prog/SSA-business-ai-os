// @plantilla-quitar(servicios)
/**
 * El link del botón «Firmar el contrato» / «Completar el formulario» de un paso del camino (00503). SOLO servidor.
 *
 * El portal manda la sesión del estudiante y el id del paso; la base (`app_servicio.portal_item_form_link`) decide si
 * el paso es de esa persona, sigue pendiente y tiene un formulario publicado, y devuelve los ids. Acá se firma el link
 * con el paso adentro, así al enviar se completa ESE paso (aunque su fase ya esté cerrada). El link nunca se loguea.
 */
import { portalDenied } from "./denied";
import type { SvcResult } from "@/lib/services/db";

export interface FormLinkGrant {
  workspace_id: string;
  form_id: string;
  slug: string;
  contact_id: string;
  service_id: string;
  sale_id: string | null;
  item_id: string;
}

export interface FormLinkDeps {
  grant(session: string, itemId: string): Promise<SvcResult<FormLinkGrant>>;
  baseUrl(workspaceId: string): Promise<string>;
  sign(input: {
    workspaceId: string;
    slug: string;
    baseUrl: string;
    formId: string;
    contactId: string;
    serviceId: string;
    saleId: string | null;
    itemId: string;
  }): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^[0-9a-f]{64}$/;

export type FormLinkResult =
  | { status: 200; body: { ok: true; url: string } }
  | { status: 400 | 403 | 500; body: { ok: false; code?: string | null; message?: string } };

export async function resolveFormLink(input: { session?: unknown; item_id?: unknown }, deps: FormLinkDeps): Promise<FormLinkResult> {
  if (typeof input.session !== "string" || !SESSION.test(input.session) || typeof input.item_id !== "string" || !UUID.test(input.item_id)) {
    return { status: 400, body: { ok: false } };
  }
  const grant = await deps.grant(input.session, input.item_id);
  if (!grant.ok) return { status: 403, body: portalDenied(grant.error) };
  const g = grant.data;
  try {
    const url = await deps.sign({
      workspaceId: g.workspace_id,
      slug: g.slug,
      baseUrl: await deps.baseUrl(g.workspace_id),
      formId: g.form_id,
      contactId: g.contact_id,
      serviceId: g.service_id,
      saleId: g.sale_id,
      itemId: g.item_id,
    });
    return { status: 200, body: { ok: true, url } };
  } catch {
    // Vault sin responder: nunca se arma un link sin firma.
    console.error("[portal form-link] no pude firmar el link");
    return { status: 500, body: { ok: false } };
  }
}
