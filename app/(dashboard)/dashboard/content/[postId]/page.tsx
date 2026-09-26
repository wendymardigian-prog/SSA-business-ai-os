import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { PageHeader } from "@/components/page-header";
import { PostDetail } from "@/components/content/post-detail";
import { STATUS_LABELS } from "@/lib/content/status";
import type { PublicationSummary } from "@/lib/content/detail";

/**
 * El detalle de una pieza (F36).
 *
 * Contesta sin hacer clic: que se publico, donde, como quedo cada red y que
 * se puede hacer ahora. Las metricas de cada publicacion se suman en el
 * bloque 6, sobre esta misma pantalla.
 */
export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const { workspace, user, role, supabase } = await getWorkspace();
  const isAdmin = isAdminRole(role);

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, title, caption, status, review_note, created_by")
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) notFound();

  const { data: publications } = await supabase
    .from("social_posts")
    .select(
      "platform, status, scheduled_at, published_at, url, last_error, last_error_kind, attempts, warning, actual_visibility",
    )
    .eq("content_post_id", postId)
    .is("deleted_at", null)
    .order("platform");

  const summaries: PublicationSummary[] = (publications ?? []).map((p) => ({
    platform: p.platform,
    status: p.status,
    scheduledAt: p.scheduled_at,
    publishedAt: p.published_at,
    url: p.url,
    lastError: p.last_error,
    lastErrorKind: p.last_error_kind,
    attempts: p.attempts ?? 0,
    warning: p.warning,
    actualVisibility: p.actual_visibility,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/content/[postId]"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PostDetail
          postId={post.id}
          title={post.title}
          status={post.status}
          caption={post.caption}
          reviewNote={post.review_note}
          perms={{
            create: true,
            approve: isAdmin,
            publish: isAdmin,
            isAuthor: post.created_by === user.id,
          }}
          publications={summaries}
          timeZone={workspace.timezone || "America/Costa_Rica"}
        />
      </div>
    </div>
  );
}
