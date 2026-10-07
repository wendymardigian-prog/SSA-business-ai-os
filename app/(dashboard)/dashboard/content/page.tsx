import { getPermissionContext } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { ContentKanban, NewContentButtons } from "@/components/content/kanban";
import { ContentCalendar } from "@/components/content/calendar-view";
import { ContentList, type ListRow } from "@/components/content/list-view";
import { ContentViewSwitcher, CountModeSwitcher, PlatformFilter } from "@/components/content/view-switcher";
import { ContentShell } from "@/components/content/drawer/content-shell";
import { parseContentFilters, matchesPlatform } from "@/lib/content/filters";
import { parseDrawer } from "@/lib/content/drawer-url";
import { loadPiece, type PieceData } from "@/lib/content/load-piece";
import { contentTooltip } from "@/lib/nav/page-actions";
import { timeZoneLabel } from "@/lib/dates";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { attributedContactsFor, countByPiece, type BoardIdea, type BoardPost } from "@/lib/content/board";
import { authorshipLine } from "@/lib/content/classification";
import { tagFor } from "@/lib/content/taxonomy";
import { loadContentTaxonomy } from "@/lib/content/load-taxonomy";
import type { ContentPostStatus } from "@/lib/types/database";

/**
 * Contenido: el pipeline de la idea a la publicacion (F20).
 *
 * La ven todos los miembros. Lo que cambia por rol es que se puede hacer:
 * cualquiera crea ideas y piezas, y aprobar, programar y generar con IA es de
 * Owner y Admin (en el bloque 9 pasa a ser un permiso configurable).
 */
const COUNT_PAGE = 1000;
const COUNT_MAX_PAGES = 10;

/**
 * Cuantos contactos tienen cada pieza como PRIMER toque (F101).
 *
 * Se lee con el cliente de quien mira, no con el del servidor: la lista de
 * contactos tiene scope (un Member solo ve los suyos), y el numero no puede
 * mostrar lo que la persona no puede ver. Va de a paginas: PostgREST corta en
 * 1000 filas sin avisar, y un conteo que se queda corto en silencio es peor
 * que no tener conteo. Solo se traen los contactos que SI llegaron por una pieza.
 */
async function firstTouchCounts(supabase: Awaited<ReturnType<typeof getPermissionContext>>["supabase"]) {
  const rows: Array<{ content_post_id: string | null }> = [];

  for (let page = 0; page < COUNT_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("contacts")
      .select("content_post_id:attribution->first_touch->>content_post_id")
      .is("deleted_at", null)
      .not("attribution->first_touch->>content_post_id", "is", null)
      .order("id")
      .range(page * COUNT_PAGE, (page + 1) * COUNT_PAGE - 1);

    if (error) {
      console.error("[content] no pude contar los contactos por pieza:", error.message);
      break;
    }
    rows.push(...((data ?? []) as unknown as Array<{ content_post_id: string | null }>));
    if ((data ?? []).length < COUNT_PAGE) break;
  }

  return countByPiece(rows);
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseContentFilters(params);
  const target = parseDrawer(params);
  // Por permiso y no por cargo (F78): lo que se ve en el tablero sale de las
  // claves del rol, no de ser Owner o Admin.
  const ctx = await getPermissionContext();
  const { workspace, user, supabase, can } = ctx;
  const canApprove = can("content.approve");
  const canPublish = can("content.publish");
  const canUseAi = can("content.ai");

  // La zona del NEGOCIO, no la de quien mira: es la misma que usa el editor
  // para agendar (A19, lib/dates.ts) y el tope diario server-side
  // (lib/publishing/schedule-core.ts) — las tres tienen que coincidir.
  const timeZone = workspace.timezone || "UTC";

  const [ideasRes, postsRes, publicationsRes, aiProviders, taxonomy, attributed] = await Promise.all([
    supabase
      .from("content_ideas")
      .select("id, title, content, format, reference, platforms, pillar_id, offer_id, funnel_stage, status, created_by, position, created_at, updated_at")
      .eq("workspace_id", workspace.id)
      .eq("status", "nueva")
      .order("position"),
    supabase
      .from("content_posts")
      .select("id, title, format, status, created_by, position, networks, script, caption, copy_source, copy_status, pillar_id, offer_id, funnel_stage, created_at, updated_at")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("social_posts")
      .select("content_post_id, platform, status, scheduled_at, published_at")
      .eq("workspace_id", workspace.id)
      .not("content_post_id", "is", null)
      .is("deleted_at", null),
    canUseAi ? listConnectedAiProviders(workspace.id) : Promise.resolve([]),
    // Archivados incluidos: una idea o pieza que ya tiene un pilar lo sigue
    // mostrando aunque ya no se ofrezca en el selector (F89).
    loadContentTaxonomy(supabase, workspace.id, can("settings.manage")),
    firstTouchCounts(supabase),
  ]);

  const publicationsByPost = new Map<string, Array<{ platform: string; status: string | null; at: string | null }>>();
  for (const row of publicationsRes.data ?? []) {
    if (!row.content_post_id) continue;
    // Una fila cancelada (se desprogramo, o se paso a "la subo yo") no es la
    // publicacion de verdad: contarla dejaria el kanban y el calendario
    // mostrando "mixed" en vez de volver a la fecha tentativa (Contenido v4).
    if (row.status === "cancelled") continue;
    const list = publicationsByPost.get(row.content_post_id) ?? [];
    list.push({
      platform: row.platform,
      status: row.status,
      at: row.published_at ?? row.scheduled_at,
    });
    publicationsByPost.set(row.content_post_id, list);
  }

  // Los nombres del equipo, para la columna Autor, su filtro y las tarjetas.
  const authorNames = memberLabels(await getWorkspaceMembers(workspace.id));

  const ideas: BoardIdea[] = (ideasRes.data ?? []).map((idea) => ({
    kind: "idea",
    id: idea.id,
    title: idea.title,
    format: idea.format,
    status: idea.status,
    createdBy: idea.created_by,
    position: idea.position,
    content: idea.content,
    reference: idea.reference,
    platforms: idea.platforms ?? [],
    pillar: tagFor(taxonomy.pillars, idea.pillar_id),
    offer: tagFor(taxonomy.offers, idea.offer_id),
    funnelStage: idea.funnel_stage,
    createdAt: idea.created_at,
    updatedAt: idea.updated_at,
    authorName: idea.created_by ? (authorNames.get(idea.created_by) ?? null) : null,
    authorship: authorshipLine({
      authorName: idea.created_by ? (authorNames.get(idea.created_by) ?? null) : null,
      createdAt: idea.created_at,
      updatedAt: idea.updated_at,
      timeZone,
    }),
  }));

  const posts: BoardPost[] = (postsRes.data ?? []).map((post) => {
    const planned = (Array.isArray(post.networks) ? post.networks : []) as Array<{
      platform?: string;
      planned_at?: string | null;
    }>;
    const published = publicationsByPost.get(post.id) ?? [];

    // Lo programado gana sobre lo tentativo: si una red ya tiene su fila, esa
    // es la fecha de verdad.
    const networks: BoardPost["networks"] = planned.map((n) => {
      const real = published.find((p) => p.platform === n.platform);
      return {
        platform: String(n.platform ?? ""),
        at: real?.at ?? n.planned_at ?? null,
        status: (real?.status ?? null) as BoardPost["networks"][number]["status"],
      };
    });

    // Una red que se publico y no esta en el jsonb (una redistribucion) igual
    // se muestra.
    for (const real of published) {
      if (!networks.some((n) => n.platform === real.platform)) {
        networks.push({
          platform: real.platform,
          at: real.at,
          status: real.status as BoardPost["networks"][number]["status"],
          redistribution: true,
        });
      }
    }

    return {
      kind: "post",
      id: post.id,
      title: post.title,
      format: post.format,
      status: post.status as ContentPostStatus,
      createdBy: post.created_by,
      position: post.position,
      networks,
      hasCopy: Boolean(post.script?.trim()),
      hasCaption: Boolean(post.caption?.trim()),
      copyFromAi: post.copy_source !== "manual",
      copyStatus: post.copy_status,
      pillar: tagFor(taxonomy.pillars, post.pillar_id),
      offer: tagFor(taxonomy.offers, post.offer_id),
      funnelStage: post.funnel_stage,
      // Solo con publicaciones salidas: un cero en una pieza que no salio
      // diria "no funciono" cuando todavia no pudo funcionar (F101).
      attributedContacts: attributedContactsFor(
        attributed.get(post.id),
        published.some((p) => p.status === "published"),
      ),
      createdAt: post.created_at,
      updatedAt: post.updated_at,
      authorName: post.created_by ? (authorNames.get(post.created_by) ?? null) : null,
      authorship: authorshipLine({
        authorName: post.created_by ? (authorNames.get(post.created_by) ?? null) : null,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        timeZone,
      }),
    };
  });

  // El filtro de Red de la barra superior (F98). El drawer de ideas recorre TODAS
  // (si no, cambiar el filtro con un drawer abierto dejaria la idea sin lugar).
  const visibleIdeas = ideas.filter((i) => matchesPlatform(i.platforms, filters.platform));
  const visiblePosts = posts.filter((p) =>
    matchesPlatform(p.networks.map((n) => n.platform), filters.platform),
  );

  // El drawer: la pieza se lee aca, en el mismo viaje que el tablero. Una que
  // no existe (o de otro negocio) no abre nada y avisa.
  let piece: PieceData | null = null;
  let notice: string | null = null;
  if (target?.kind === "piece") {
    piece = await loadPiece(ctx, target.id);
    if (!piece) notice = "No encontré esa pieza, o no tenés acceso a ella.";
  } else if (target?.kind === "idea" && !ideas.some((i) => i.id === target.id)) {
    notice = "Esa idea ya no está en el tablero: la aprobaron o la descartaron.";
  }

  // Lo que necesitan los modales de crear: las redes conectadas.
  const { data: accountsRes } = await supabase
    .from("social_accounts")
    .select("platform")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true);

  const platforms = (accountsRes ?? []).map((a) => a.platform as string);
  const copywriter = {
    available: canUseAi && aiProviders.length > 0,
    reason: !canUseAi
      ? "Necesitás el permiso de generar copy con IA."
      : aiProviders.length === 0
        ? "Conectá un proveedor de IA en Ajustes → Integraciones."
        : undefined,
  };

  const crear = {
    canCreate: true,
    ideas: ideas.map((i) => ({ id: i.id, title: i.title })),
    platforms,
    taxonomy,
    copywriter,
    canApprove,
  };

  // La lista muestra TODO lo que hay, ideas incluidas (C15): si una idea no
  // aparece, buscarla obliga a volver al tablero.
  const listRows: ListRow[] = [
    ...ideas.map<ListRow>((idea) => ({
      id: idea.id,
      title: idea.title,
      status: "draft",
      createdBy: idea.createdBy,
      platforms: idea.platforms,
      format: idea.format,
      authorName: idea.authorName,
      authorship: idea.authorship,
      pillar: idea.pillar,
      firstAt: null,
      hasCopy: false,
      isIdea: true,
    })),
    ...posts.map<ListRow>((post) => ({
      id: post.id,
      title: post.title,
      status: post.status,
      createdBy: post.createdBy,
      platforms: post.networks.map((n) => n.platform),
      format: post.format,
      authorName: post.authorName,
      authorship: post.authorship,
      pillar: post.pillar,
      firstAt: post.networks.map((n) => n.at).filter(Boolean).sort()[0] ?? null,
      hasCopy: post.hasCopy,
      attributedContacts: post.attributedContacts,
    })),
  ];

  const listMonths = [
    ...new Set(listRows.map((r) => r.firstAt?.slice(0, 7)).filter(Boolean) as string[]),
  ].sort();

  const month =
    filters.month ??
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
      .format(new Date())
      .slice(0, 7);

  // La barra de redes del filtro: las conectadas y las que ya aparecen en alguna pieza o idea.
  const filterPlatforms = [
    ...new Set([...platforms, ...posts.flatMap((p) => p.networks.map((n) => n.platform)), ...ideas.flatMap((i) => i.platforms)]),
  ].sort();

  return (
    <ContentShell
      target={target}
      ideas={ideas}
      piece={piece}
      notice={notice}
      userId={user.id}
      perms={{ approve: canApprove, ai: canUseAi }}
      platforms={platforms}
      taxonomy={taxonomy}
      aiAvailable={aiProviders.length > 0}
      aiReason={copywriter.reason}
    >
      {/* La barra superior concentra todo lo de la pantalla (F98): las vistas,
          el conteo, el filtro de Red, el ⓘ con lo que puede hacer el rol y las
          dos altas. El cuerpo queda limpio: solo el tablero. */}
      <PageHeader
        route="/dashboard/content"
        tooltip={contentTooltip(
          { approve: canApprove, publish: canPublish, ai: canUseAi },
          timeZoneLabel(timeZone),
        )}
        left={<ContentViewSwitcher current={filters.view} />}
        filters={
          <>
            <PlatformFilter current={filters.platform} platforms={filterPlatforms} />
            {filters.view === "calendar" && <CountModeSwitcher current={filters.count} />}
          </>
        }
        right={<NewContentButtons {...crear} />}
      />

      {filters.view === "kanban" && (
        <ContentKanban
          ideas={visibleIdeas}
          posts={visiblePosts}
          perms={{ create: true, approve: canApprove, publish: canPublish, ai: canUseAi }}
          currentUserId={user.id}
          aiAvailable={aiProviders.length > 0}
          platforms={platforms}
          taxonomy={taxonomy}
        />
      )}

      {filters.view === "calendar" && (
        <ContentCalendar
          pieces={visiblePosts.map((post) => ({
            id: post.id,
            title: post.title,
            format: post.format,
            networks: post.networks
              .filter((n) => n.at && matchesPlatform([n.platform], filters.platform))
              .map((n) => ({ platform: n.platform, at: n.at!, status: n.status })),
          }))}
          timeZone={timeZone}
          month={month}
          countMode={filters.count}
          canPublish={canPublish}
        />
      )}

      {filters.view === "list" && (
        <ContentList
          rows={listRows}
          filters={filters}
          authors={[...authorNames.entries()].map(([id, name]) => ({ id, name }))}
          months={listMonths}
        />
      )}
    </ContentShell>
  );
}
