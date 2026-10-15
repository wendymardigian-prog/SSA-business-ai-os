/**
 * El borrador del selector "Cargar a mano" de dos pasos (Extra I, F47): lo que la persona va eligiendo en pantalla
 * y como se convierte en la eleccion que viaja al servidor (`ManualChoiceInput`, validada despues con
 * `parseManualChoice`).
 *
 * El componente solo compone estas funciones: no decide nada. Modulo PURO.
 */
import {
  MANUAL_CHANNELS,
  ORGANIC_NETWORK_LABELS,
  parseManualChoice,
  type ManualChannelKind,
  type ManualChoiceInput,
  type OrganicNetwork,
  type PaidNetwork,
} from "./manual-channel";

export type DraftKind = ManualChannelKind | "utm";

export interface DraftPiece {
  contentPostId: string;
  title: string;
}

export interface DraftAd {
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  /** "Campaña › Conjunto › Anuncio", para mostrar lo elegido. */
  label: string;
}

export interface DraftReferrer {
  type: "contact" | "member";
  id: string;
  name: string;
}

export interface ManualDraft {
  kind: DraftKind | null;
  organicNetwork: OrganicNetwork | "";
  piece: DraftPiece | null;
  unknownPiece: boolean;
  paidNetwork: PaidNetwork | "";
  ad: DraftAd | null;
  unknownAd: boolean;
  /** Si se busca a un contacto o se elige a alguien del equipo (arranca en el contacto). */
  referrerMode: "contact" | "member";
  referrer: DraftReferrer | null;
  eventName: string;
  otherNote: string;
  utm: { source: string; medium: string; campaign: string; content: string; term: string };
}

export const EMPTY_DRAFT: ManualDraft = {
  kind: null,
  organicNetwork: "",
  piece: null,
  unknownPiece: false,
  paidNetwork: "",
  ad: null,
  unknownAd: false,
  referrerMode: "contact",
  referrer: null,
  eventName: "",
  otherNote: "",
  utm: { source: "", medium: "", campaign: "", content: "", term: "" },
};

/** El nombre del canal, tal como se le muestra a la persona en el primer paso. */
export function draftKindLabel(kind: DraftKind): string {
  if (kind === "utm") return "Avanzado (UTM)";
  return MANUAL_CHANNELS.find((c) => c.kind === kind)?.label ?? kind;
}

export type DraftResult = { ready: true; choice: ManualChoiceInput; label: string } | { ready: false; hint: string };

const PAID_NETWORK_LABELS: Record<PaidNetwork, string> = { facebook: "Facebook", instagram: "Instagram" };

/**
 * ¿Ya se puede usar el borrador? Si si, la eleccion lista para mandar y un resumen corto ("Contenido orgánico ·
 * Instagram · Reel…"); si no, que falta, en palabras. Lo valida de verdad `parseManualChoice`, igual que el servidor.
 */
export function draftToChoice(draft: ManualDraft): DraftResult {
  const kind = draft.kind;
  if (!kind) return { ready: false, hint: "Elegí de dónde vino" };

  let raw: unknown;
  let label: string;

  switch (kind) {
    case "organic": {
      if (!draft.organicNetwork) return { ready: false, hint: "Elegí la red" };
      if (!draft.piece && !draft.unknownPiece) return { ready: false, hint: "Buscá la pieza o marcá «No sé qué pieza»" };
      raw = {
        kind,
        network: draft.organicNetwork,
        piece: draft.piece ? { contentPostId: draft.piece.contentPostId, title: draft.piece.title } : null,
      };
      label = [draftKindLabel(kind), ORGANIC_NETWORK_LABELS[draft.organicNetwork], draft.piece?.title ?? "pieza sin identificar"].join(" · ");
      break;
    }
    case "paid": {
      if (!draft.paidNetwork) return { ready: false, hint: "Elegí Facebook o Instagram" };
      if (!draft.ad && !draft.unknownAd) return { ready: false, hint: "Buscá el anuncio o marcá «No sé qué anuncio»" };
      raw = {
        kind,
        network: draft.paidNetwork,
        ad: draft.ad ? { adId: draft.ad.adId, adsetId: draft.ad.adsetId, campaignId: draft.ad.campaignId } : null,
      };
      label = [draftKindLabel(kind), PAID_NETWORK_LABELS[draft.paidNetwork], draft.ad?.label ?? "anuncio sin identificar"].join(" · ");
      break;
    }
    case "referral": {
      if (!draft.referrer) return { ready: false, hint: "Elegí quién lo recomendó" };
      raw =
        draft.referrer.type === "contact"
          ? { kind, referrer: { type: "contact", contactId: draft.referrer.id } }
          : { kind, referrer: { type: "member", userId: draft.referrer.id } };
      label = [draftKindLabel(kind), draft.referrer.name].join(" · ");
      break;
    }
    case "event": {
      if (!draft.eventName.trim()) return { ready: false, hint: "Escribí el nombre del evento" };
      raw = { kind, name: draft.eventName };
      label = [draftKindLabel(kind), draft.eventName.trim()].join(" · ");
      break;
    }
    case "other": {
      raw = { kind, note: draft.otherNote };
      label = [draftKindLabel(kind), draft.otherNote.trim()].filter(Boolean).join(" · ");
      break;
    }
    case "utm": {
      if (!draft.utm.source) return { ready: false, hint: "Elegí la fuente" };
      raw = { kind, ...draft.utm };
      label = [draftKindLabel(kind), draft.utm.source, draft.utm.medium, draft.utm.campaign.trim()].filter(Boolean).join(" · ");
      break;
    }
  }

  const parsed = parseManualChoice(raw);
  if (!parsed.ok) return { ready: false, hint: parsed.error };
  return { ready: true, choice: raw as ManualChoiceInput, label };
}
