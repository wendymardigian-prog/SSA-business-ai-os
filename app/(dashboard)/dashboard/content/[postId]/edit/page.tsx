import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPermissionContext } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { PostEditor, type EditorPost } from "@/components/content/post-editor";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { STATUS_LABELS } from "@/lib/content/status";
import type { AutomationRule } from "@/lib/content/keywords";
import type { NetworkEntry } from "@/lib/content/redistribution";
import type { MediaEntry } from "@/lib/content/media";
import type { StoredVersion } from "@/lib/content/versions";

/**
 * El editor de una pieza (F24 a F29).
 *
 * Todo lo que el editor necesita se lee aca de una vez: la pieza, sus
 * publicaciones, las redes conectadas, las automatizaciones por palabra clave
 * y el historial. Asi la pantalla no hace diez idas y vueltas.
 */
export default async function EditPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  // Por permiso y no por cargo (F78).
  const { workspace, user, supabase, can } = await getPermissionContext();
  const canUseAi = can("content.ai");

  const { data: post } = await supabase
    .from("content_posts")
    .select(
      "id, title, format, script, recording_notes, caption, networks, media, status, material_status, ai_unreviewed, created_by, updated_at, copy_status, idea_id",
    )
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) notFound();

  const [publicationsRes, accountsRes, channelsRes, triggersRes, versionsRes, aiProviders, members] =
    await Promise.all([
      supabase
        .from("social_posts")
        .select("platform, status, scheduled_at")
        .eq("content_post_id", postId),
      supabase
        .from("social_accounts")
        .select("platform, channel_id, username, display_name, publishers, default_publisher")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true),
      supabase
        .from("channels")
        .select("id, platform")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true),
      // Las automatizaciones por palabra clave, para decir si el CTA tiene
      // quien lo conteste (F27).
      supabase
        .from("triggers")
        .select("id, type, config, is_active, channel_id, flows(id, name)")
        .eq("workspace_id", workspace.id)
        .in("type", ["keyword", "comment_keyword"]),
      supabase
        .from("content_post_versions")
        .select("id, version_no, snapshot, author_kind, author_id, reason, created_at")
        .eq("post_id", postId)
        .order("version_no", { ascending: false })
        .limit(50),
      canUseAi ? listConnectedAiProviders(workspace.id) : Promise.resolve([]),
      getWorkspaceMembers(workspace.id),
    ]);

  // Las plataformas de `channels` y las de `social_accounts` no son el mismo
  // conjunto (una tiene whatsapp, la otra youtube), asi que el mapa es por
  // texto y no por tipo.
  const channelByPlatform = new Map<string, string>(
    (channelsRes.data ?? []).map((c) => [c.platform as string, c.id]),
  );

  const automations: AutomationRule[] = (triggersRes.data ?? []).map((row) => {
    const config = (row.config ?? {}) as {
      keywords?: Array<string | { value: string; matchType?: string }>;
      matchType?: string;
      postIds?: string[];
    };
    const flow = row.flows as { id: string; name: string } | null;

    return {
      triggerId: row.id,
      flowId: flow?.id ?? "",
      flowName: flow?.name ?? "Automatizacion",
      type: row.type,
      isActive: row.is_active,
      channelIds: row.channel_id ? [row.channel_id] : [],
      keywords: (config.keywords ?? []).map((kw) =>
        typeof kw === "string"
          ? { value: kw, matchType: config.matchType }
          : { value: kw.value, matchType: kw.matchType ?? config.matchType },
      ),
      postIds: config.postIds ?? [],
    };
  });

  // Por dónde puede salir cada red y con qué nombre se ve: lo primero llena
  // "Publicar por" (C8) y lo segundo la vista previa (C10).
  const publishersByPlatform: Record<string, string[]> = {};
  const accountNames: Record<string, string | null> = {};

  for (const account of accountsRes.data ?? []) {
    const platform = account.platform as string;
    const entries = (Array.isArray(account.publishers) ? account.publishers : []) as Array<{
      publisher?: string;
      status?: string;
    }>;
    publishersByPlatform[platform] = entries
      .filter((e) => e.publisher && e.status !== "unavailable")
      .map((e) => e.publisher as string);
    accountNames[platform] = account.username ?? account.display_name ?? null;
  }

  // La idea de la que salió, para el chip que la vuelve a abrir (C12).
  const { data: idea } = post.idea_id
    ? await supabase.from("content_ideas").select("id, title").eq("id", post.idea_id).maybeSingle()
    : { data: null };

  const editorPost: EditorPost = {
    id: post.id,
    title: post.title,
    format: post.format,
    idea: idea ? { id: idea.id, title: idea.title } : null,
    copyStatus: post.copy_status,
    script: post.script,
    recordingNotes: post.recording_notes,
    caption: post.caption,
    networks: (Array.isArray(post.networks) ? post.networks : []) as unknown as NetworkEntry[],
    media: (Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[],
    status: post.status,
    materialStatus: post.material_status,
    aiUnreviewed: post.ai_unreviewed,
    updatedAt: post.updated_at,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/content/[postId]/edit"
        title={post.title}
        left={
          <span className="hidden rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:inline">
            {STATUS_LABELS[post.status]}
          </span>
        }
        backHref={
          <Link
            href="/dashboard/content"
            aria-label="Volver a Contenido"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <PostEditor
        publishersByPlatform={publishersByPlatform}
        accountNames={accountNames}
        post={editorPost}
        perms={{
          create: true,
          approve: can("content.approve"),
          publish: can("content.publish"),
          ai: canUseAi,
          isAuthor: post.created_by === user.id,
        }}
        publications={(publicationsRes.data ?? []).map((p) => ({
          platform: p.platform,
          status: p.status,
          scheduledAt: p.scheduled_at,
        }))}
        connected={(accountsRes.data ?? []).map((a) => a.platform)}
        automations={automations}
        channelIdByPlatform={Object.fromEntries(
          (accountsRes.data ?? []).map((a) => [
            a.platform,
            a.channel_id ?? channelByPlatform.get(a.platform) ?? null,
          ]),
        )}
        versions={(versionsRes.data ?? []) as unknown as StoredVersion[]}
        authorNames={Object.fromEntries(memberLabels(members))}
        aiAvailable={aiProviders.length > 0}
        timeZone={workspace.timezone || "America/Costa_Rica"}
      />
    </div>
  );
}
