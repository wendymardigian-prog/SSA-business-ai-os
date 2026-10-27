/**
 * Las variables de la banca de recursos ({{contact.display_name}},
 * {{contact.email}}, {{contact.phone}}, {{workspace.name}}) en el texto de una
 * AUTOMATIZACION.
 *
 * Un texto de la banca que se inserta en el email o el mensaje de un flow trae
 * sus variables con esa sintaxis. `interpolateVariables` (flows) solo resuelve
 * lo que esta en `context.variables` y deja el resto tal cual a proposito; este
 * segundo pase resuelve lo que quedo, con los datos reales del contacto y del
 * negocio. Es ADITIVO: un `{{contact.display_name}}` que antes salia crudo
 * ahora sale con el nombre.
 *
 * Solo toca esas cuatro variables (la lista es cerrada en `interpolateTemplate`):
 * lo demas, incluidos los `{{booking.*}}` que no resolvieron, queda intacto.
 * Y solo consulta la base si el texto las trae.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { interpolateTemplate } from "@/lib/templates/interpolate";
import { appUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email/html";
import { formLinkSlugs, hasFormLinkVariables, linkIdsFromVariables, replaceFormLinks } from "@/lib/forms/link-variables"; // @plantilla-quitar(formularios)

type Db = SupabaseClient<Database>;

const BANK_TOKEN = /\{\{\s*(?:contact|workspace)\.[a-z_]+\s*\}\}/i;

/** ¿Trae alguna variable de la banca sin resolver? */
export function hasBankVariables(text: string): boolean {
  return BANK_TOKEN.test(text);
}

export async function resolveBankVariables(
  supabase: Db,
  context: {
    workspaceId: string;
    contactId: string;
    /** Las variables del flujo: de ahi salen `service.id` y `sale.id` para el link firmado. Opcional. */
    variables?: Record<string, unknown>;
    /**
     * Los valores del contacto y del negocio se pegan escapados (para un cuerpo
     * que es HTML: un nombre con `<` no puede terminar siendo una etiqueta).
     */
    escapeHtmlValues?: boolean;
  },
  texts: string[],
): Promise<string[]> {
  const needsBank = texts.some(hasBankVariables);
  const needsFormLink = texts.some(hasFormLinkVariables); // @plantilla-quitar(formularios)
  if (!needsBank && !needsFormLink) return texts; // @plantilla-quitar(formularios)
  // @plantilla-sin(formularios): if (!needsBank) return texts;

  let resolved = texts;
  if (needsBank) {
    const [{ data: contact }, { data: workspace }] = await Promise.all([
      supabase.from("contacts").select("display_name, email, phone").eq("id", context.contactId).maybeSingle(),
      supabase.from("workspaces").select("name").eq("id", context.workspaceId).maybeSingle(),
    ]);
    const esc = (value: string | null | undefined) => (context.escapeHtmlValues && value ? escapeHtml(value) : value);
    const safeContact = contact ? { display_name: esc(contact.display_name), email: esc(contact.email), phone: esc(contact.phone) } : contact;
    const safeWorkspace = workspace ? { name: esc(workspace.name) } : workspace;
    resolved = resolved.map((text) => interpolateTemplate(text, { contact: safeContact, workspace: safeWorkspace }));
  }

  // Segundo pase, solo si el texto trae `{{form_link.`: el link firmado para ESTE contacto. // @plantilla-quitar(formularios)
  if (needsFormLink) resolved = await resolveFormLinkVariables(supabase, context, resolved); // @plantilla-quitar(formularios)
  return resolved;
}

// @plantilla-desde(formularios)
/**
 * `{{form_link.<slug_con_guion_bajo>}}` → `<base>/f/<slug>?c=<token>`, firmado para
 * el contacto del flujo (con `service.id` y `sale.id` si el flujo los trae). Un
 * formulario que no existe o no esta publicado deja el token tal cual. Un fallo al
 * firmar tambien: el mensaje sale igual, nunca se cae por esto.
 */
export async function resolveFormLinkVariables(
  supabase: Db,
  context: { workspaceId: string; contactId: string; variables?: Record<string, unknown> },
  texts: string[],
): Promise<string[]> {
  const slugs = formLinkSlugs(texts);
  if (slugs.length === 0) return texts;

  const { data: forms } = await supabase
    .from("forms")
    .select("id, slug")
    .eq("workspace_id", context.workspaceId)
    .eq("status", "published")
    // Un reporte de fin de día no tiene link público (00179): no se arma su link.
    .neq("type", "eod")
    .in("slug", slugs);
  if (!forms || forms.length === 0) return texts;

  const { serviceId, saleId } = linkIdsFromVariables(context.variables);
  const links: Record<string, string> = {};
  try {
    // Import dinamico: firmar pide el Vault, y solo hace falta cuando hay un token.
    const { signFormLink } = await import("@/lib/forms/signed-link");
    for (const form of forms) {
      links[form.slug.toLowerCase()] = await signFormLink(supabase, {
        workspaceId: context.workspaceId,
        formId: form.id,
        slug: form.slug,
        contactId: context.contactId,
        serviceId,
        saleId,
        baseUrl: appUrl(),
      });
    }
  } catch (error) {
    console.error(`[forms] no pude firmar el link del formulario: ${error instanceof Error ? error.message : "error"}`);
    return texts;
  }
  return texts.map((text) => replaceFormLinks(text, links));
}
// @plantilla-hasta(formularios)
