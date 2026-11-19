/**
 * El correo personalizado de la copia firmada (`contract_config.copyEmail`). PURO.
 *
 * Quien firma recibe su copia en PDF con el asunto y el texto que escribió el negocio, en vez del texto de siempre.
 * Sirve, por ejemplo, para que ese mismo correo sea el «paso 2» de un onboarding con el link al formulario siguiente.
 *
 * Variables: las mismas que en los correos de las automatizaciones (`{{contact.first_name}}`, `{{contact.name}}`,
 * `{{contact.email}}`, `{{workspace.name}}`, con respaldo `{{x|y}}`), más `{{contract.title}}` y
 * `{{contract.signed_at}}`, y `{{form_link.<slug>}}`: el link personal a otro formulario, firmado con el contacto, el
 * servicio y la venta de la firma (lo resuelve `resolveFormLinkVariables`, que consulta la base: no vive acá).
 *
 * Los valores se pegan escapados en un cuerpo HTML (`interpolateHtml`) y el resultado se limpia con la lista blanca de
 * siempre (`finalizeEmailHtml`) DESPUÉS de pegar los links: el texto de la persona nunca se vuelve una etiqueta.
 */
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { firstNameOf } from "@/lib/flow-engine/variable-catalog";
import { dropDanglingComma, interpolateHtml, isHtmlTemplate } from "@/lib/email/html";
import { isPlaceholderName } from "@/lib/contacts/anonymous";
import type { ContractCopyEmail } from "@/lib/forms/defaults";

/** Las variables que ofrece el editor del correo (además del link a un formulario). */
export const COPY_EMAIL_VARIABLES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "contact.first_name", label: "Nombre de pila" },
  { key: "contact.name", label: "Nombre completo" },
  { key: "contact.email", label: "Email" },
  { key: "workspace.name", label: "Nombre del negocio" },
  { key: "contract.title", label: "Título del contrato" },
  { key: "contract.signed_at", label: "Fecha de la firma" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEFTOVER_FORM_LINK = /\{\{\s*form_link\.[a-z0-9_]+\s*\}\}/gi;

export interface CopyEmailFacts {
  /** El nombre del contacto vinculado (si hay); si es un relleno o falta, se usa el que escribió al firmar. */
  contactName: string | null;
  signerName: string | null;
  signerEmail: string;
  workspaceName: string | null;
  title: string;
  signedAtText: string;
  serviceId: string | null;
  saleId: string | null;
}

/** Las variables del correo. `service` y `sale` van anidados: de ahí los lee el link firmado (`linkIdsFromVariables`). */
export function copyEmailVariables(facts: CopyEmailFacts): Record<string, unknown> {
  const contactName = (facts.contactName ?? "").trim();
  const name = contactName && !isPlaceholderName(contactName) ? contactName : (facts.signerName ?? "").trim();
  const vars: Record<string, unknown> = {
    contact: { first_name: firstNameOf(name), name, display_name: name, email: facts.signerEmail },
    workspace: { name: facts.workspaceName ?? "" },
    contract: { title: facts.title, signed_at: facts.signedAtText },
  };
  if (facts.serviceId && UUID_RE.test(facts.serviceId)) vars.service = { id: facts.serviceId };
  if (facts.saleId && UUID_RE.test(facts.saleId)) vars.sale = { id: facts.saleId };
  return vars;
}

/** Asunto y cuerpo con las variables pegadas. Los `{{form_link.…}}` quedan para el paso que firma los links. */
export function renderCopyEmail(copy: ContractCopyEmail, variables: Record<string, unknown>): { subject: string; body: string; bodyIsHtml: boolean } {
  // Si es HTML se decide mirando la PLANTILLA: un nombre con «<b>» en un texto plano nunca se vuelve una etiqueta.
  const bodyIsHtml = isHtmlTemplate(copy.body);
  const subject = dropDanglingComma(copy.subject, interpolateVariables(copy.subject, variables)).replace(/\s+/g, " ").trim();
  const body = dropDanglingComma(copy.body, bodyIsHtml ? interpolateHtml(copy.body, variables) : interpolateVariables(copy.body, variables));
  return { subject, body, bodyIsHtml };
}

/**
 * Lo que no se pudo firmar (el formulario se despublicó, la firma no tiene contacto) se saca: mejor un correo sin ese
 * link que uno con `{{form_link.…}}` a la vista. En un `href`, el link vacío lo descarta después la lista blanca.
 */
export function stripUnresolvedFormLinks(text: string): string {
  return text.replace(LEFTOVER_FORM_LINK, "");
}

/**
 * El primer link a un formulario del correo que no sirve (el formulario no existe, no está publicado o no tiene página
 * pública), o null. `available` son los slugs publicados con página pública del negocio.
 */
export function unavailableFormLink(slugs: readonly string[], available: readonly string[]): string | null {
  const ok = new Set(available.map((s) => s.toLowerCase()));
  return slugs.find((slug) => !ok.has(slug.toLowerCase())) ?? null;
}
