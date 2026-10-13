/**
 * `find_or_create_contact` simulada sobre la base en memoria, SOLO para tests.
 *
 * Replica la regla de la base (00200): normaliza la identidad con `normalizeIdentity`, busca en el orden
 * canal -> telefono -> email -> redes (solo no borrados del workspace, el mas antiguo), devuelve los
 * conflictos y, segun la modalidad, crea. No toma bloqueos (en memoria no hay concurrencia). La verdad de la
 * regla vive en la base y se prueba con `scripts/verify-contacts-single-entry.mjs`; esto solo deja a los
 * tests de cada camino escribir y leer contactos sin simular la RPC a mano.
 */
import type { MemoryDb } from "@/lib/agent/testing/memory-db";
import { normalizeIdentity, hasStrongIdentity, type ContactIdentity } from "@/lib/contacts/identity";
import { linkedinSlug } from "@/lib/contacts/social";

type Row = Record<string, unknown>;

const COLUMN: Record<string, string> = {
  phone: "phone", whatsapp_phone: "whatsapp_phone", email: "email", secondary_email: "secondary_email",
  instagram: "instagram_username", tiktok: "tiktok_username", x: "twitter_username",
  linkedin: "linkedin_profile_url", facebook: "facebook_id",
};
const FORBIDDEN = ["id", "workspace_id", "deleted_at", "created_at", "updated_at", "phone", "whatsapp_phone", "email", "secondary_email", "instagram_username", "tiktok_username", "twitter_username", "linkedin_profile_url"];

let seq = 0;

export function memoryCentralRpc(args: Record<string, unknown>, db: MemoryDb): unknown {
  const ws = args.p_workspace_id as string;
  const mode = (args.p_mode as string) ?? "create";
  const ident = normalizeIdentity(args.p_identity as ContactIdentity);
  const defaults = (args.p_defaults ?? {}) as Row;
  const allowNone = args.p_allow_without_identity === true;
  const live = () => (db.tables.contacts ??= []).filter((c) => c.workspace_id === ws && !c.deleted_at);
  const lower = (v: unknown) => String(v ?? "").toLowerCase();
  const oldest = (rows: Row[]) => [...rows].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0];

  const out = (over: Row) => ({ contact_id: null, created: false, matched_by: null, conflict_contact_id: null, conflicts: [], status: "not_found", ...over });

  if (!hasStrongIdentity(ident) && !(allowNone && mode !== "find_only")) return out({ status: "no_identity" });

  if (hasStrongIdentity(ident)) {
    // Canal
    if (ident.channel_id) {
      const link = (db.tables.contact_channels ?? []).find((l) => l.channel_id === ident.channel_id && l.platform_sender_id === ident.sender_id);
      if (link) return out({ contact_id: link.contact_id, matched_by: "channel", status: "found" });
    }
    const hits: { by: string; contact_id: string }[] = [];
    const add = (by: string, rows: Row[]) => {
      const c = oldest(rows);
      if (c) hits.push({ by, contact_id: String(c.id) });
    };
    for (const p of [ident.phone, ident.whatsapp_phone]) if (p) add("phone", live().filter((c) => c.phone === p || c.whatsapp_phone === p));
    for (const e of [ident.email, ident.secondary_email]) if (e) add("email", live().filter((c) => lower(c.email) === e || lower(c.secondary_email) === e));
    if (ident.instagram) add("instagram", live().filter((c) => lower(c.instagram_username) === ident.instagram));
    if (ident.tiktok) add("tiktok", live().filter((c) => lower(c.tiktok_username) === ident.tiktok));
    if (ident.x) add("x", live().filter((c) => lower(c.twitter_username) === ident.x));
    if (ident.linkedin) add("linkedin", live().filter((c) => c.linkedin_profile_url && linkedinSlug(String(c.linkedin_profile_url)) === linkedinSlug(ident.linkedin!)));
    if (ident.facebook) add("facebook", live().filter((c) => lower(c.facebook_id) === ident.facebook));
    // Un mismo contacto por dos datos no es un conflicto.
    const winner = hits[0];
    if (winner) {
      const conflicts = hits.filter((h) => h.contact_id !== winner.contact_id);
      return out({ contact_id: winner.contact_id, matched_by: winner.by, conflict_contact_id: conflicts[0]?.contact_id ?? null, conflicts, status: "found" });
    }
  }

  if (mode === "find_only") return out({});

  const row: Row = { ...Object.fromEntries(Object.entries(defaults).filter(([k]) => !FORBIDDEN.includes(k))), workspace_id: ws, deleted_at: null };
  for (const [key, column] of Object.entries(COLUMN)) {
    const value = (ident as Record<string, string | undefined>)[key];
    if (value) row[column] = value;
  }
  row.id = `central-${++seq}`;
  row.created_at = (row.created_at as string) ?? new Date().toISOString();
  db.tables.contacts.push(row);
  if (mode === "link_channel" && ident.channel_id) {
    (db.tables.contact_channels ??= []).push({ contact_id: row.id, channel_id: ident.channel_id, platform_sender_id: ident.sender_id });
  }
  return out({ contact_id: row.id, created: true, status: "created" });
}
