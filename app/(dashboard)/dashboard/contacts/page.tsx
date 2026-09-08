import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { ContactsView, type ContactRow } from "./contacts-view";
import type { LeadTemperature } from "@/lib/types/database";
import { isSupportedPlatform, platformLabel } from "@/lib/platforms";
import { LEAD_TEMPERATURES } from "@/lib/contacts/fields";
import { firstParam, pickEnum, pickPage, sanitizeSearch } from "@/lib/url-params";

/**
 * Lista de contactos.
 *
 * Antes traia 100 contactos fijos y filtraba en memoria. Ahora la busqueda,
 * los filtros y la paginacion se resuelven en la base, por tres motivos:
 *
 * 1. Con el scope de leads prendido, "todos los contactos" ya no es lo mismo
 *    para cada persona; filtrar en el cliente sobre una tanda arbitraria
 *    mostraba resultados incompletos sin avisar.
 * 2. Buscar por telefono o por usuario de red necesita indices, no un
 *    Array.filter.
 * 3. Con datos reales, 100 filas se quedan cortas enseguida.
 *
 * El estado de los filtros vive en la URL, asi que una vista filtrada se puede
 * compartir o guardar en favoritos.
 */

const PAGE_SIZE = 25;

/** "" oculta los anonimos (default), "1" los suma, "solo" muestra solo esos. */
const ANON_FILTER_VALUES = ["", "1", "solo"] as const;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { workspace, supabase } = await getWorkspace();

  const search = sanitizeSearch(firstParam(params.q));
  const tagId = firstParam(params.tag);
  const setterId = firstParam(params.setter);
  const vendedorId = firstParam(params.vendedor);
  // Los dos vienen de la URL, asi que se validan contra su lista antes de
  // llegar a la consulta: un valor inventado se ignora en vez de romper.
  const temperature = pickEnum<LeadTemperature>(params.temp, LEAD_TEMPERATURES);
  const platformParam = firstParam(params.canal);
  const platform = isSupportedPlatform(platformParam) ? platformParam : "";
  // Los contactos sin datos (los "Instagram User") se ocultan por defecto: son
  // mas de la mitad de la tabla y no se puede trabajar con ellos hasta que la
  // persona responda. "1" los muestra, "solo" deja unicamente esos.
  const anon = pickEnum(params.anon, ANON_FILTER_VALUES);
  const page = pickPage(params.page);

  // Los embeds con alias permiten filtrar por tag o por canal sin perder la
  // lista completa de tags de cada contacto: `tag_match` e `channel_match` son
  // inner joins que recortan QUE contactos vuelven, y `contact_tags` sigue
  // trayendo todos los tags de los que vuelven.
  let select = "*, contact_tags(tag_id, tags(id, name, color))";
  if (tagId) select += ", tag_match:contact_tags!inner(tag_id)";
  if (platform) select += ", channel_match:contact_channels!inner(channels!inner(platform))";

  let query = supabase
    .from("contacts")
    .select(select, { count: "exact" })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  if (search) {
    const like = `%${search}%`;
    query = query.or(
      [
        `display_name.ilike.${like}`,
        `email.ilike.${like}`,
        `secondary_email.ilike.${like}`,
        `phone.ilike.${like}`,
        `whatsapp_phone.ilike.${like}`,
        `instagram_username.ilike.${like}`,
        `tiktok_username.ilike.${like}`,
        `twitter_username.ilike.${like}`,
      ].join(","),
    );
  }

  if (tagId) query = query.eq("tag_match.tag_id", tagId);
  if (platform) query = query.eq("channel_match.channels.platform", platform);
  if (setterId) query = query.eq("setter_id", setterId);
  if (vendedorId) query = query.eq("vendedor_id", vendedorId);
  if (temperature) query = query.eq("lead_temperature", temperature);
  if (anon === "solo") query = query.eq("is_anonymous", true);
  else if (anon !== "1") query = query.eq("is_anonymous", false);

  const from = (page - 1) * PAGE_SIZE;

  // Cuantos quedaron afuera por ser anonimos. Sin este numero, la lista pasa de
  // 171 a 72 sin explicacion y parece que se perdieron contactos.
  const anonymousQuery = supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .eq("is_anonymous", true);

  const [contactsRes, tagsRes, channelsRes, members, anonymousRes] = await Promise.all([
    query
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    supabase.from("tags").select("id, name, color").eq("workspace_id", workspace.id).order("name"),
    supabase
      .from("channels")
      .select("platform")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
    getWorkspaceMembers(workspace.id),
    anonymousQuery,
  ]);

  if (contactsRes.error) {
    console.error("[contacts] listado fallido:", contactsRes.error.message);
  }

  // El select dinamico no se puede tipar en tiempo de compilacion, asi que la
  // forma se fija aca, en un solo lugar.
  const rows = (contactsRes.data ?? []) as unknown as Array<
    Record<string, unknown> & {
      contact_tags?: { tags: { id: string; name: string; color: string | null } | null }[];
    }
  >;

  const contacts: ContactRow[] = rows.map((c) => ({
    id: c.id as string,
    displayName: (c.display_name as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    lastInteractionAt: (c.last_interaction_at as string | null) ?? null,
    temperature: (c.lead_temperature as LeadTemperature | null) ?? null,
    doNotContact: Boolean(c.do_not_contact),
    setterId: (c.setter_id as string | null) ?? null,
    vendedorId: (c.vendedor_id as string | null) ?? null,
    tags: (c.contact_tags ?? [])
      .map((ct) => ct.tags)
      .filter((t): t is { id: string; name: string; color: string | null } => Boolean(t)),
  }));

  const platforms = [...new Set((channelsRes.data ?? []).map((c) => c.platform))].sort();

  return (
    <ContactsView
      contacts={contacts}
      total={contactsRes.count ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      tags={tagsRes.data ?? []}
      platforms={platforms.map((p) => ({ value: p, label: platformLabel(p) }))}
      members={members.map((m) => ({ userId: m.userId, label: m.name }))}
      filters={{ search, tagId, setterId, vendedorId, temperature, platform, anon }}
      anonymousCount={anonymousRes.count ?? 0}
    />
  );
}
