import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { PageHeader } from "@/components/page-header";
import { ContentKanban, NewContentButtons } from "@/components/content/kanban";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import type { BoardIdea, BoardPost } from "@/lib/content/board";
import type { ContentPostStatus } from "@/lib/types/database";

/**
 * Contenido: el pipeline de la idea a la publicacion (F20).
 *
 * La ven todos los miembros. Lo que cambia por rol es que se puede hacer:
 * cualquiera crea ideas y piezas, y aprobar, programar y generar con IA es de
 * Owner y Admin (en el bloque 9 pasa a ser un permiso configurable).
 */
export default async function ContentPage() {
  const { workspace, user, role, supabase } = await getWorkspace();
  const isAdmin = isAdminRole(role);

  const [ideasRes, postsRes, publicationsRes, aiProviders] = await Promise.all([
    supabase
      .from("content_ideas")
      .select("id, title, format, status, created_by, position")
      .eq("workspace_id", workspace.id)
      .eq("status", "nueva")
      .order("position"),
    supabase
      .from("content_posts")
      .select("id, title, format, status, created_by, position, networks, copy, caption, copy_source, material_status")
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

  const ideas: BoardIdea[] = (ideasRes.data ?? []).map((idea) => ({
    kind: "idea",
    id: idea.id,
    title: idea.title,
    format: idea.format,
    status: idea.status,
    createdBy: idea.created_by,
    position: idea.position,
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
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/content"
        right={<NewContentButtons canCreate />}
      />
      <ContentKanban
        ideas={ideas}
        posts={posts}
        perms={{ create: true, approve: isAdmin, publish: isAdmin, ai: isAdmin }}
        currentUserId={user.id}
        aiAvailable={aiProviders.length > 0}
      />
    </div>
  );
}
