import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { PageHeader } from "@/components/page-header";
import { ContentKanban, NewContentButtons } from "@/components/content/kanban";
import { ContentCalendar } from "@/components/content/calendar-view";
import { ContentList, type ListRow } from "@/components/content/list-view";
import { ContentViewSwitcher, CountModeSwitcher } from "@/components/content/view-switcher";
import { parseContentFilters } from "@/lib/content/filters";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import type { BoardIdea, BoardPost } from "@/lib/content/board";
import type { ContentPostStatus } from "@/lib/types/database";

/**
 * Contenido: el pipeline de la idea a la publicacion (F20).
 *
 * La ven todos los miembros. Lo que cambia por rol es que se puede hacer:
 * cualquiera crea ideas y piezas, y aprobar, programar y generar con IA es de
 * Owner y Admin (en el bloque 9 pasa a ser un permiso configurable).
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const filters = parseContentFilters(await searchParams);
  const { workspace, user, role, supabase } = await getWorkspace();
  const isAdmin = isAdminRole(role);

  const [ideasRes, postsRes, publicationsRes, aiProviders] = await Promise.all([
    supabase
      .from("content_ideas")
      .select("id, title, hook, angle, format, pillar, reference, notes, status, created_by, position, created_at")
      .eq("workspace_id", workspace.id)
      .eq("status", "nueva")
      .order("position"),
    supabase
      .from("content_posts")
      .select("id, title, format, status, created_by, position, networks, copy, caption, copy_source, material_status, copy_status, created_at")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("social_posts")
      .select("content_post_id, platform, status, scheduled_at, published_at")
      .eq("workspace_id", workspace.id)
      .not("content_post_id", "is", null),
    isAdmin ? listConnectedAiProviders(workspace.id) : Promise.resolve([]),
  ]);

  const publicationsByPost = new Map<string, Array<{ platform: string; status: string | null; at: string | null }>>();
  for (const row of publicationsRes.data ?? []) {
    if (!row.content_post_id) continue;
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
    hook: idea.hook,
    angle: idea.angle,
    pillar: idea.pillar,
    reference: idea.reference,
    notes: idea.notes,
    createdAt: idea.created_at,
    authorName: idea.created_by ? (authorNames.get(idea.created_by) ?? null) : null,
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

    const copy = (post.copy ?? {}) as { hook?: string; body?: string; cta?: string };

    return {
      kind: "post",
      id: post.id,
      title: post.title,
      format: post.format,
      status: post.status as ContentPostStatus,
      createdBy: post.created_by,
      position: post.position,
      networks,
      hasCopy: Boolean(copy.body?.trim() || copy.hook?.trim()),
      hasCaption: Boolean(post.caption?.trim()),
      copyFromAi: post.copy_source !== "manual",
      materialStatus: post.material_status,
      copyStatus: post.copy_status,
      createdAt: post.created_at,
      authorName: post.created_by ? (authorNames.get(post.created_by) ?? null) : null,
    };
  });

  // Lo que necesitan los modales de crear: las redes conectadas y los
  // pilares que ya se usaron, para sugerirlos en vez de hacerlos escribir.
  const { data: accountsRes } = await supabase
    .from("social_accounts")
    .select("platform")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true);

  const platforms = (accountsRes ?? []).map((a) => a.platform as string);
  const pillars = [
    ...new Set(
      (ideasRes.data ?? [])
        .map((i) => (i.pillar ?? "").trim())
        .filter(Boolean),
    ),
  ].sort();

  const copywriter = {
    available: isAdmin && aiProviders.length > 0,
    reason: !isAdmin
      ? "Necesitás el permiso de generar copy con IA."
      : aiProviders.length === 0
        ? "Conectá un proveedor de IA en Ajustes → Integraciones."
        : undefined,
  };

  const crear = {
    canCreate: true,
    ideas: ideas.map((i) => ({ id: i.id, title: i.title })),
    platforms,
    pillars,
    copywriter,
    canApprove: isAdmin,
  };

  // La lista muestra TODO lo que hay, ideas incluidas (C15): si una idea no
  // aparece, buscarla obliga a volver al tablero.
  const listRows: ListRow[] = [
    ...ideas.map<ListRow>((idea) => ({
      id: idea.id,
      title: idea.title,
      status: "draft",
      createdBy: idea.createdBy,
      platforms: [],
      format: idea.format,
      authorName: idea.authorName,
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
      firstAt: post.networks.map((n) => n.at).filter(Boolean).sort()[0] ?? null,
      hasCopy: post.hasCopy,
    })),
  ];

  const listMonths = [
    ...new Set(listRows.map((r) => r.firstAt?.slice(0, 7)).filter(Boolean) as string[]),
  ].sort();

  const timeZone = workspace.timezone || "America/Costa_Rica";
  const month =
    filters.month ??
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
      .format(new Date())
      .slice(0, 7);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/content"
        left={<ContentViewSwitcher current={filters.view} />}
        filters={filters.view === "calendar" ? <CountModeSwitcher current={filters.count} /> : undefined}
        right={<NewContentButtons {...crear} />}
      />

      {filters.view === "kanban" && (
        <ContentKanban
          ideas={ideas}
          posts={posts}
          perms={{ create: true, approve: isAdmin, publish: isAdmin, ai: isAdmin }}
          currentUserId={user.id}
          aiAvailable={aiProviders.length > 0}
          platforms={platforms}
          pillars={pillars}
        />
      )}

      {filters.view === "calendar" && (
        <ContentCalendar
          pieces={posts.map((post) => ({
            id: post.id,
            title: post.title,
            format: post.format,
            networks: post.networks
              .filter((n) => n.at)
              .map((n) => ({ platform: n.platform, at: n.at!, status: n.status })),
          }))}
          timeZone={timeZone}
          month={month}
          countMode={filters.count}
          canPublish={isAdmin}
        />
      )}

      {filters.view === "list" && (
        <ContentList
          rows={listRows}
          filters={filters}
          authors={[...authorNames.entries()].map(([id, name]) => ({ id, name }))}
          platforms={[...new Set(posts.flatMap((p) => p.networks.map((n) => n.platform)))]}
          months={listMonths}
        />
      )}
    </div>
  );
}
