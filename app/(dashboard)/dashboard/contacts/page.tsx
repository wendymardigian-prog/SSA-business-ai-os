import { attributionClauses, parseAttributionFilters } from "@/lib/contacts/attribution-filter";
import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { ContactsView, type ContactRow } from "./contacts-view";
import type { LeadTemperature } from "@/lib/types/database";
import { isSupportedPlatform, platformLabel } from "@/lib/platforms";
import { LEAD_TEMPERATURES } from "@/lib/contacts/fields";
import { contactOrderClauses, parseContactSort } from "@/lib/contacts/sort";
import { firstParam, pickEnum, pickPage, sanitizeSearch } from "@/lib/url-params";
import { contactSearchFilter } from "@/lib/contacts/search";
import { contactIdsByWhatsappLid } from "@/lib/contacts/search-lid";
import { customFilterPlan, parseCustomFilter, parsePipelineFilters, pipelineClauses } from "@/lib/contacts/list-filters";
import { loadContactStatusSettings } from "@/lib/contacts/status-settings-load";
import { loadInterestCatalog } from "@/lib/contacts/interest-load";
import { isEmailStatus } from "@/lib/email/subscription";

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
  // Equipo y roles (F21): la pagina pide su permiso; el alcance de los contactos lo sigue aplicando la RLS.
  await requirePermission("contacts.view");
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
  // El orden de la lista (`?orden=`): una lista cerrada, con el de siempre por defecto.
  const sort = parseContactSort(params.orden);
  // Por PRIMER toque (F88): quien lo trajo, no lo ultimo que hizo. Los valores
  // se validan contra la taxonomia; uno inventado se ignora.
  const attribution = parseAttributionFilters(params);
  // Pipeline (00245/00246): estado (el ultimo o el de cada rol) y producto de interes.
  const pipeline = parsePipelineFilters(params);
  // Suscripcion a emails (00270): el estado de email del contacto. Un valor inventado se ignora.
  const emailParam = firstParam(params.email);
  const emailStatus = isEmailStatus(emailParam) ? emailParam : "";

  // Los campos personalizados (para el filtro y las columnas), las listas de
  // estados y el catalogo de productos: se piden antes porque el filtro por
  // campo necesita saber su tipo.
  const [fieldDefsRes, statusSettings, interestCatalog] = await Promise.all([
    supabase.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", workspace.id).is("deleted_at", null).order("name"),
    loadContactStatusSettings(workspace.id),
    loadInterestCatalog(supabase, workspace.id),
  ]);
  const customFields = fieldDefsRes.data ?? [];
  const customFilter = parseCustomFilter(params, customFields);
  const customPlan = customFilter ? customFilterPlan(customFilter) : null;

  // Los embeds con alias permiten filtrar por tag o por canal sin perder la
  // lista completa de tags de cada contacto: `tag_match` e `channel_match` son
  // inner joins que recortan QUE contactos vuelven, y `contact_tags` sigue
  // trayendo todos los tags de los que vuelven.
  let select = "*, contact_tags(tag_id, tags(id, name, color))";
  if (tagId) select += ", tag_match:contact_tags!inner(tag_id)";
  if (platform) select += ", channel_match:contact_channels!inner(channels!inner(platform))";
  // Por campo personalizado (00244): un join interno con la condicion, o un
  // anti-join para "esta vacio" (el contacto no tiene fila para ese campo).
  if (customPlan) select += customPlan.join === "anti" ? ", cf_match:contact_custom_fields(field_id)" : ", cf_match:contact_custom_fields!inner(field_id)";

  let query = supabase
    .from("contacts")
    .select(select, { count: "exact" })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  if (search) {
    // La misma regla que la bandeja (lib/contacts/search.ts): ademas de nombre,
    // emails, telefonos y los @, el telefono escrito con espacios y el id de
    // WhatsApp de quien escribio sin numero.
    const lidContactIds = await contactIdsByWhatsappLid(supabase, workspace.id, search);
    const filter = contactSearchFilter(search, lidContactIds);
    if (filter) query = query.or(filter);
  }

  if (tagId) query = query.eq("tag_match.tag_id", tagId);
  if (platform) query = query.eq("channel_match.channels.platform", platform);
  if (setterId) query = query.eq("setter_id", setterId);
  if (vendedorId) query = query.eq("vendedor_id", vendedorId);
  if (temperature) query = query.eq("lead_temperature", temperature);
  for (const { path, value } of attributionClauses(attribution)) query = query.eq(path, value);
  for (const clause of pipelineClauses(pipeline)) {
    query = clause.op === "is_null" ? query.is(clause.column, null) : query.eq(clause.column, clause.value as string);
  }
  if (customPlan) {
    query = query.eq("cf_match.field_id", customPlan.fieldId);
    if (customPlan.join === "anti") query = query.is("cf_match", null);
    else {
      const col = `cf_match.${customPlan.column}`;
      if (customPlan.op === "not_null") query = query.not(col, "is", null);
      else if (customPlan.op === "ilike") query = query.ilike(col, String(customPlan.value));
      else if (customPlan.op === "gt") query = query.gt(col, customPlan.value as string | number);
      else if (customPlan.op === "lt") query = query.lt(col, customPlan.value as string | number);
      else query = query.eq(col, customPlan.value as string | number);
    }
  }
  if (emailStatus) query = query.eq("email_status", emailStatus);
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
    contactOrderClauses(sort)
      .reduce(
        (q, clause) => q.order(clause.column, { ascending: clause.ascending, nullsFirst: clause.nullsFirst }),
        query,
      )
      .range(from, from + PAGE_SIZE - 1),
    supabase.from("tags").select("id, name, color, disables_agent, assigns_to").eq("workspace_id", workspace.id).order("name"),
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

  // Los valores de los campos personalizados de ESTA pagina (para las columnas que la persona elija).
  const pageIds = rows.map((c) => c.id as string);
  const customValues: Record<string, Record<string, string>> = {};
  if (pageIds.length > 0 && customFields.length > 0) {
    const { data: values } = await supabase.from("contact_custom_fields").select("contact_id, field_id, value").in("contact_id", pageIds);
    for (const v of values ?? []) (customValues[v.contact_id] ??= {})[v.field_id] = v.value;
  }

  const contacts: ContactRow[] = rows.map((c) => ({
    id: c.id as string,
    displayName: (c.display_name as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    lastInteractionAt: (c.last_interaction_at as string | null) ?? null,
    temperature: (c.lead_temperature as LeadTemperature | null) ?? null,
    doNotContact: Boolean(c.do_not_contact),
    isKnown: Boolean(c.is_known),
    isCustomer: Boolean(c.is_customer),
    emailStatus: isEmailStatus(c.email_status) ? c.email_status : "subscribed",
    setterId: (c.setter_id as string | null) ?? null,
    vendedorId: (c.vendedor_id as string | null) ?? null,
    tags: (c.contact_tags ?? [])
      .map((ct) => ct.tags)
      .filter((t): t is { id: string; name: string; color: string | null } => Boolean(t)),
    lastStatusRole: c.last_status_role === "setter" || c.last_status_role === "closer" ? c.last_status_role : null,
    lastStatus: (c.last_status as string | null) ?? null,
    interestProductId: (c.interest_product_id as string | null) ?? null,
    interestVariantId: (c.interest_variant_id as string | null) ?? null,
    custom: customValues[c.id as string] ?? {},
  }));

  const platforms = [...new Set((channelsRes.data ?? []).map((c) => c.platform))].sort();

  return (
    <ContactsView
      contacts={contacts}
      total={contactsRes.count ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      tags={(tagsRes.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        disablesAgent: t.disables_agent,
        assignsTo: t.assigns_to,
      }))}
      platforms={platforms.map((p) => ({ value: p, label: platformLabel(p) }))}
      members={members.map((m) => ({ userId: m.userId, label: m.name }))}
      filters={{
        search, tagId, setterId, vendedorId, temperature, platform, anon, source: attribution.source, medium: attribution.medium,
        lastStatus: firstParam(params.estado) && pipeline.lastStatus ? `${pipeline.lastStatus.role}:${pipeline.lastStatus.key}` : "",
        setterStatus: pipeline.setterStatus,
        closerStatus: pipeline.closerStatus,
        productId: pipeline.productId,
        emailStatus,
        customField: customFilter ? customFilter.field.slug : "",
      }}
      customFilter={customFilter ? { slug: customFilter.field.slug, op: customFilter.op, value: firstParam(params.valor) } : null}
      customFields={customFields}
      statusSettings={statusSettings}
      interestCatalog={interestCatalog}
      anonymousCount={anonymousRes.count ?? 0}
      sort={sort}
    />
  );
}
