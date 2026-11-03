/**
 * Los puertos REALES de "mandame un link de baja nuevo" (`lib/email/unsubscribe-link.ts`).
 * SOLO servidor, con el cliente de SERVICIO (la ruta no tiene sesión).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { hashIp } from "@/lib/scheduling/antispam";
import { publicBaseUrl, type WorkspaceDomainSource } from "@/lib/public-url";
import { resolveBrand } from "@/lib/brand";
import { findContact } from "@/lib/contacts/find-or-create";
import { workspaceBySlug } from "@/lib/http/workspace-origins";
import { sendTransactionalEmail } from "./send";
import { unsubscribeLinkEmail } from "./templates";
import { unsubscribePageUrl } from "./unsubscribe";
import type { UnsubscribeLinkPorts } from "./unsubscribe-link";

type Db = SupabaseClient<Database>;

export function createUnsubscribeLinkPorts(service: Db): UnsubscribeLinkPorts {
  return {
    limit: (spec) => checkLimit(service, spec),
    hash: hashIp,
    findWorkspace: (slug) => workspaceBySlug(service as unknown as SupabaseClient, slug),

    async findToken(workspaceId, email) {
      // Solo a un contacto VIVO (la misma búsqueda que el resto del sistema: email principal o secundario).
      const found = await findContact(service, { workspaceId, identity: { email } });
      if (!found.contactId) return null;
      // El token lo da la misma función que usa la puerta de envío: el de ESE contacto si la dirección es suya.
      const { data, error } = await service.rpc("email_address_send_state", {
        p_workspace_id: workspaceId,
        p_email: email,
        p_contact_id: found.contactId,
      });
      if (error || !data) return null;
      const token = (data as { token?: unknown }).token;
      return typeof token === "string" && token ? { contactId: found.contactId, token } : null;
    },

    async sendLink({ workspaceId, contactId, to, token }) {
      const { data: workspace } = await service
        .from("workspaces")
        .select("brand_name, brand_logo_path, brand_color, scheduling_public_base_url")
        .eq("id", workspaceId)
        .maybeSingle();
      const content = unsubscribeLinkEmail({
        unsubscribeUrl: unsubscribePageUrl(publicBaseUrl(workspace as WorkspaceDomainSource), token),
        brand: resolveBrand(workspace as Parameters<typeof resolveBrand>[0]),
      });
      // Transaccional: lo pidió la persona. La puerta de envío igual frena una dirección que rebota.
      await sendTransactionalEmail({
        workspaceId,
        to,
        subject: content.subject,
        html: content.html,
        kind: "unsubscribe_link",
        relatedEntityType: "contact",
        relatedEntityId: contactId,
        contactId,
        category: "transactional",
        deps: { supabase: service as unknown as SupabaseClient },
      });
    },
  };
}
