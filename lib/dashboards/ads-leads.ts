/**
 * Leads por campaña, cruzando con los contactos (F60).
 *
 * Meta dice cuantos leads generó una campaña; el CRM dice quienes son. El
 * cruce es `contacts.attribution`, un jsonb con `campaign_id` y `ad_id` que
 * se completa cuando el contacto llega por un anuncio.
 *
 * Los dos numeros casi nunca coinciden, y eso NO es un error: Meta cuenta
 * eventos y el CRM cuenta personas. Una persona que completa el formulario
 * dos veces son dos eventos y un contacto. La pantalla muestra los dos y
 * dice por que difieren.
 */

export interface AttributedContact {
  contactId: string;
  createdAt: string;
  campaignId: string | null;
  adId: string | null;
}

/** Lee la atribucion de un contacto, sin romperse con lo que sea que haya. */
export function parseAttribution(value: unknown): { campaignId: string | null; adId: string | null } {
  if (!value || typeof value !== "object") return { campaignId: null, adId: null };
  const record = value as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    campaignId: text(record.campaign_id) ?? text(record.campaignId),
    adId: text(record.ad_id) ?? text(record.adId),
  };
}

export interface CampaignLeads {
  campaignId: string;
  campaignName: string | null;
  /** Lo que dice Meta. */
  reportedLeads: number | null;
  /** Los contactos que entraron con ese campaign_id. */
  contacts: number;
  /** Que decir cuando los dos numeros no coinciden. */
  note: string | null;
}

/**
 * Cuantos contactos entraron por cada campaña.
 *
 * Solo las campañas que ya estan sincronizadas: un `campaign_id` de una
 * campaña que no conocemos no tiene nombre ni gasto, y una fila con un id
 * numerico suelto no le sirve a nadie.
 */
export function leadsByCampaign(params: {
  campaigns: Array<{ objectId: string; objectName: string | null; leads: number | null }>;
  contacts: AttributedContact[];
}): CampaignLeads[] {
  const byCampaign = new Map<string, number>();
  for (const contact of params.contacts) {
    if (!contact.campaignId) continue;
    byCampaign.set(contact.campaignId, (byCampaign.get(contact.campaignId) ?? 0) + 1);
  }

  return params.campaigns.map((campaign) => {
    const contacts = byCampaign.get(campaign.objectId) ?? 0;
    const reported = campaign.leads;

    let note: string | null = null;
    if (reported !== null && contacts > 0 && reported !== contacts) {
      note =
        reported > contacts
          ? "Meta cuenta eventos y el CRM cuenta personas: alguien pudo completar el formulario mas de una vez."
          : "Hay mas contactos que leads informados: pueden haber llegado por otro lado y traer la atribucion igual.";
    } else if (reported !== null && reported > 0 && contacts === 0) {
      note = "Meta informa leads pero ninguno llego al CRM. Revisa la integracion del formulario.";
    }

    return {
      campaignId: campaign.objectId,
      campaignName: campaign.objectName,
      reportedLeads: reported,
      contacts,
      note,
    };
  });
}

/** Los contactos que llegaron por anuncios y no tienen campaña conocida. */
export function orphanAttributions(params: {
  knownCampaignIds: string[];
  contacts: AttributedContact[];
}): number {
  const known = new Set(params.knownCampaignIds);
  return params.contacts.filter((c) => c.campaignId && !known.has(c.campaignId)).length;
}
