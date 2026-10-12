/**
 * Lo que el detalle de una respuesta cuenta sobre el contacto: por qué dato se vinculó, qué otros datos
 * apuntaban a OTRO contacto (conflictos) y qué dato de la respuesta no se pudo guardar en el contacto. PURO.
 */
import { SOCIAL_LABELS, isSocialPlatform } from "@/lib/contacts/social";

/** Cómo se llama cada dato por el que se puede vincular un contacto. */
export const MATCHED_BY_LABELS: Record<string, string> = {
  phone: "el teléfono",
  email: "el email",
  instagram: "el usuario de Instagram",
  tiktok: "el usuario de TikTok",
  x: "el usuario de X",
  linkedin: "el perfil de LinkedIn",
  link: "el link firmado",
};

/** "el @ de Instagram", "el email"… para una frase de aviso. */
const CONFLICT_SUBJECT: Record<string, string> = {
  phone: "El teléfono",
  email: "El email",
  instagram: "El @ de Instagram",
  tiktok: "El @ de TikTok",
  x: "El @ de X",
  linkedin: "El perfil de LinkedIn",
};

export interface StoredDedupe {
  matched_by?: string | null;
  conflict_contact_id?: string | null;
  conflicts?: Array<{ by?: unknown; contact_id?: unknown }> | null;
}

export interface ConflictView {
  by: string;
  contactId: string;
  /** "El @ de Instagram coincide con otro contacto". */
  text: string;
}

/**
 * Los conflictos de una respuesta. Las respuestas viejas solo traen `conflict_contact_id` (el email contra el
 * teléfono): se leen igual, como un conflicto por email.
 */
export function describeConflicts(dedupe: StoredDedupe | null | undefined): ConflictView[] {
  const out: ConflictView[] = [];
  const seen = new Set<string>();
  const add = (by: string, contactId: string) => {
    const key = `${by}:${contactId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ by, contactId, text: `${CONFLICT_SUBJECT[by] ?? "Un dato"} coincide con otro contacto` });
  };
  for (const entry of dedupe?.conflicts ?? []) {
    if (typeof entry?.by === "string" && typeof entry?.contact_id === "string") add(entry.by, entry.contact_id);
  }
  if (out.length === 0 && dedupe?.conflict_contact_id) add("email", dedupe.conflict_contact_id);
  return out;
}

/** "La respuesta se vinculó por el teléfono." o null si no se vinculó por nada. */
export function matchedByText(matchedBy: string | null | undefined): string | null {
  if (!matchedBy) return null;
  return `La respuesta se vinculó por ${MATCHED_BY_LABELS[matchedBy] ?? matchedBy}.`;
}

// ── Datos que no se pudieron guardar en el contacto ──────────────────────────

export type ContactNoteReason = "country_unrecognized" | "social_invalid";

export interface ContactNote {
  reason: ContactNoteReason;
  /** Lo que escribió la persona (recortado). */
  text: string;
  /** Solo en `social_invalid`: la red. */
  platform?: string;
}

const NOTE_TEXT_MAX = 100;

export function describeContactNote(note: ContactNote): string {
  const text = note.text.slice(0, NOTE_TEXT_MAX);
  if (note.reason === "country_unrecognized") return `País no reconocido: ${text}`;
  const label = note.platform && isSocialPlatform(note.platform) ? SOCIAL_LABELS[note.platform] : "red social";
  return `Usuario de ${label} no válido: ${text}`;
}

/** Las notas guardadas en `meta.contact_notes`, ya como frases; lo que no tenga la forma esperada se ignora. */
export function describeContactNotes(meta: Record<string, unknown> | null | undefined): string[] {
  const raw = meta?.contact_notes;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const note = item as Record<string, unknown>;
    if ((note.reason !== "country_unrecognized" && note.reason !== "social_invalid") || typeof note.text !== "string") continue;
    out.push(describeContactNote({ reason: note.reason, text: note.text, platform: typeof note.platform === "string" ? note.platform : undefined }));
  }
  return out;
}
