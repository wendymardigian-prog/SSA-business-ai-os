// @plantilla-quitar(servicios)
import { notFound, redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { PROGRAM_PAGE_PERMISSIONS, loadPortalProgram } from "@/lib/portal-admin/load-program";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/ui/back-link";
import { TopbarTabs } from "@/components/ui/topbar-tabs";
import { SettingsLinkButton } from "@/components/ui/settings-link-button";
import { ProgramSettingsPanel } from "@/components/services/portal/program-settings-panel";
import { ProgramContentEditor, type ContentRow } from "@/components/services/portal/program-content-editor";
import { ProgramCalendar } from "@/components/services/portal/program-calendar";
import { loadCalendar } from "@/lib/program/load-calendar";
import { ProgramCommunity, type CommunityPost } from "@/components/services/portal/program-community";
import { LESSON_SPACE, pickCommunity, programCommunities } from "@/lib/program/community";
import { svcRpc } from "@/lib/services/db";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveBrand } from "@/lib/brand";
import { ProgramPointsPanel, type RankingRow } from "@/components/services/portal/program-points-panel";
import type { PointsSettings } from "@/lib/portal-points/rules";
import { ProgramAssistant, type AssistantUsage, type TutorKnowledge } from "@/components/services/portal/program-assistant";
import { ProgramTutorConversations } from "@/components/services/portal/program-tutor-conversations";
import { CONVERSATION_FILTERS, CONVERSATION_FILTER_LABELS, parseConversationFilter, readConversationsPage } from "@/lib/program/tutor-conversations";
import { svcSchema } from "@/lib/services/db";
import { loadServicePicker } from "@/lib/services/service-picker-load";
import { createServiceClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { PAGE_LESSON_TYPES, PAGE_SOURCE_FILENAME, indexLessonPageQuietly } from "@/lib/program/page-store";
import type { PortalFormInitial } from "@/components/services/portal/portal-form-editor";
import { loadActivityRatings } from "@/lib/program/load-activity-ratings";
import { LinkQuickFilterMenu, LinkViewToggle, PrimaryButton, TopbarMoreMenu, type MoreAction } from "@/components/ui/topbar-controls";
import { MonthNav } from "@/components/ui/month-nav";
import { intentHref } from "@/lib/ui/url-intent";
import { communityQuickOptions, communityQuickValue } from "@/lib/program/community";
import { COMMUNITY_MEDIA_BUCKET, mediaPaths } from "@/lib/program/community-text";
import { shiftMonth } from "@/lib/program/calendar-view";
// @plantilla-desde(proyectos)
import { ProgramProjects, type FameRow, type FameSettings, type IdeaRow, type PaymentRow, type ProjectRow, type ProjectsView } from "@/components/services/portal/program-projects";
// @plantilla-hasta(proyectos)

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `community_item_counts`: los de todo el programa y, desde la 00402, los de cada comunidad. */
type CommunityCounts = { unanswered?: number; reported?: number; by_item?: Record<string, number>; by_community?: Record<string, { unanswered?: number; reported?: number }> };

const PROGRAM_TABS = [
  { key: "contenido", label: "Contenido" },
  { key: "calendario", label: "Calendario" },
  { key: "comunidad", label: "Comunidad" },
  { key: "asistente", label: "Asistente IA" },
  { key: "afiliados", label: "Afiliados" },
  { key: "puntos", label: "Puntos" },
  { key: "proyectos", label: "Proyectos y facturación" }, // @plantilla-quitar(proyectos)
] as const;

/**
 * Portal › un programa: Contenido, Calendario, Comunidad, Asistente IA, Afiliados (qué links ven los estudiantes,
 * F106) y Puntos (F129, se ve con `portal.points` o `portal.view`), como pestañas en la barra superior. Los ajustes del programa (secciones, términos, variantes) son el
 * engranaje de la barra (`/dashboard/portal/<id>/ajustes`); el link viejo `?tab=ajustes` lleva ahí.
 */
export default async function PortalProgramPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<{ tab?: string; vista?: string; mes?: string; serie?: string; filtro?: string; espacio?: string; clase?: string; periodo?: string; comunidad?: string }> }) {
  const [{ productId }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(productId)) notFound();
  if (sp.tab === "ajustes") redirect(`/dashboard/portal/${productId}/ajustes`);
  const ctx = await requireAnyPermission(PROGRAM_PAGE_PERMISSIONS);
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const loaded = await loadPortalProgram(supabase, workspace.id, productId);
  if (!loaded) notFound();
  const { program: p, variants: vs } = loaded;
  const canSeePoints = ctx.can("portal.points") || ctx.can("portal.view");
  // Corrida C: «Proyectos y facturación» solo con la extensión de proyectos prendida en el negocio (la cambia la plataforma).
  const projectsOn = (((workspace as { portal_settings?: { extensions?: { projects?: boolean } } | null }).portal_settings ?? {}).extensions?.projects ?? false) === true;
  const tabs = PROGRAM_TABS.filter((t) => (t.key !== "puntos" || canSeePoints) && ((t.key as string) !== "proyectos" || projectsOn));
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "contenido";
  const ps = (p.portal_settings ?? {}) as { sections?: Record<string, boolean>; affiliates?: { visible_link_keys?: string[] } };
  // Las comunidades del programa (00402): la barra elige cuál se mira (`?comunidad=`, por defecto la principal).
  const communities = programCommunities(p.portal_settings);
  const multiCommunity = communities.length > 1;
  const community = pickCommunity(communities, sp.comunidad);
  const usedBy: Record<string, string[]> = {};
  for (const v of vs) if (v.portal.community_key) (usedBy[v.portal.community_key] ??= []).push(v.name);
  const canEdit = ctx.can("portal.sections");

  // Contenido (F45): el árbol se lee con la sesión (la RLS de program_items); las transcripciones, con su clase.
  async function contentTab() {
    const { data: items } = await svcSchema(supabase)
      .from("program_items")
      .select("id, parent_id, kind, lesson_type, title, description, position, status, unlock_rule, video_url, thumbnail_path, thumbnail_url, cover_path, is_extra, required, comments_enabled, html_content, document_path, form_id, points, source_call_id")
      .eq("product_id", productId)
      .eq("workspace_id", workspace.id);
    const ids = ((items ?? []) as Array<{ id: string }>).map((i) => i.id);
    const { data: kb } = ids.length
      ? await supabase.from("knowledge_base").select("program_item_id, source_filename, status, chunk_count, indexed_at, updated_at").in("program_item_id" as never, ids as never).is("deleted_at", null)
      : { data: [] };
    type KbRow = { program_item_id: string | null; source_filename: string | null; status: string; chunk_count: number | null; indexed_at: string | null; updated_at: string | null };
    const kbRows = (kb ?? []) as unknown as KbRow[];
    // La página HTML de una clase también vive en Conocimiento (page-store.ts): no es la transcripción.
    const isPage = (k: KbRow) => k.source_filename === PAGE_SOURCE_FILENAME;
    // Las páginas que el tutor todavía no tiene (cargadas antes de que se indexaran, o copiadas de otro programa) se
    // cargan al abrir el programa, después de responder. Si una ya está pero falló, se reintenta desde Conocimiento.
    const withPage = new Set(kbRows.filter(isPage).map((k) => k.program_item_id));
    const missingPages = ((items ?? []) as Array<{ id: string; kind: string; lesson_type: string | null; status: string; html_content: string | null }>).filter(
      (r) => r.kind === "lesson" && r.status !== "archived" && (PAGE_LESSON_TYPES as readonly string[]).includes(r.lesson_type ?? "") && !!r.html_content?.trim() && !withPage.has(r.id),
    );
    if (missingPages.length) after(async () => {
      for (const r of missingPages) await indexLessonPageQuietly(workspace.id, ctx.user.id, productId, r.id);
    });
    const transcriptOf = new Map(
      kbRows.filter((k) => !isPage(k)).map((k) => [
        k.program_item_id,
        { status: k.status, chunks: k.chunk_count, at: k.indexed_at ?? k.updated_at },
      ]),
    );
    // Los formularios de las evaluaciones y actividades (no aparecen en Formularios): con el cliente de servicio,
    // del negocio de la sesión, después del permiso de la página.
    const formIds = ((items ?? []) as Array<{ form_id?: string | null }>).map((i) => i.form_id).filter((x): x is string => !!x);
    const { data: forms } = formIds.length ? await (await createServiceClient()).from("forms").select("id, name, draft_definition").in("id", formIds).eq("workspace_id", workspace.id) : { data: [] };
    const formById = new Map(((forms ?? []) as Array<{ id: string; name: string; draft_definition: Record<string, unknown> }>).map((f) => [f.id, f]));
    // Encuestas en las actividades: el promedio de cada pregunta de estrellas (si falla, el editor se ve sin resumen).
    const ratingsByForm = await loadActivityRatings(await createServiceClient(), workspace.id, [...formById.values()]);
    const rows = ((items ?? []) as unknown as Array<Omit<ContentRow, "hasTranscript" | "transcript"> & { form_id?: string | null; points?: PortalFormInitial["points"] }>).map((r) => {
      const f = r.form_id ? formById.get(r.form_id) : null;
      const d = (f?.draft_definition ?? {}) as { intro?: string; fields?: PortalFormInitial["fields"]; quiz?: PortalFormInitial["quiz"]; grading?: PortalFormInitial["grading"]; submission?: PortalFormInitial["submission"] };
      return { ...r, hasTranscript: transcriptOf.has(r.id), transcript: transcriptOf.get(r.id) ?? null, portalForm: f ? { name: f.name, intro: d.intro ?? "", fields: d.fields ?? [], quiz: d.quiz ?? {}, grading: d.grading ?? { enabled: false }, submission: d.submission, points: r.points ?? null, ratings: ratingsByForm.get(f.id) } : null };
    });
    const counts = await svcRpc<{ by_item?: Record<string, number> }>(supabase, "community_item_counts", { p_product_id: productId });
    // F50: los otros programas del negocio (productos con portal), para «Copiar a otro programa».
    const { data: progs } = await supabase.from("products").select("id, name").eq("workspace_id", workspace.id).eq("portal_enabled" as never, true as never).neq("id", productId).order("name");
    const otherPrograms = ((progs ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name }));
    // «Se abre al completar algo»: los pasos del camino de las variantes de este producto. Si no se pueden leer, la
    // lista queda sin pasos (se puede elegir igual una clase o un módulo); nunca rompe la pantalla.
    const journeyVariants = await loadServicePicker(supabase, workspace.id)
      .then((o) => o.products.find((x) => x.id === productId)?.variants ?? [])
      .catch(() => []);
    return (
      <ProgramContentEditor
        productId={productId}
        rows={rows}
        canManage={ctx.can("program.manage")}
        canActivate={ctx.can("program.activate")}
        commentCounts={counts.ok ? counts.data?.by_item ?? {} : {}}
        otherPrograms={otherPrograms}
        journeyVariants={journeyVariants}
      />
    );
  }

  // Calendario (F58-F63): sesiones, fechas, asistencia y grabaciones, todo en paralelo.
  async function calendarTab() {
    const view = sp.vista === "mes" || sp.vista === "series" || sp.vista === "grilla" ? sp.vista : "lista";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? (sp.mes as string) : new Date().toISOString().slice(0, 7);
    const data = await loadCalendar(ctx, productId, month, vs.map((v) => ({ id: v.id, name: v.name })));
    const tzRaw = (workspace as { timezone?: string | null }).timezone;
    return (
      <ProgramCalendar
        productId={productId}
        data={data}
        view={view}
        month={month}
        seriesFilter={sp.serie && UUID.test(sp.serie) ? sp.serie : null}
        canManage={ctx.can("live_sessions.manage")}
        canAttendance={ctx.can("attendance.manage")}
        defaultTimezone={tzRaw || "UTC"}
      />
    );
  }

  // Comunidad (F77, F111): el muro y los comentarios de las clases, por la función que vuelve a pedir community.view.
  async function communityTab() {
    const filter = sp.filtro === "sin-contestar" ? "unanswered" : sp.filtro === "reportados" ? "reported" : "all";
    const space = sp.espacio && /^[a-z0-9_]{1,40}$/.test(sp.espacio) ? sp.espacio : null;
    const lessonId = sp.clase && UUID.test(sp.clase) ? sp.clase : null;
    const canView = ctx.can("community.view");
    const [feed, counts, team, { data: lessons }] = await Promise.all([
      canView
        ? svcRpc<CommunityPost[]>(supabase, "community_feed", { p_product_id: productId, p: { filter, community: community.key, space: lessonId ? LESSON_SPACE : space, program_item_id: lessonId, limit: 50 } })
        : Promise.resolve({ ok: true as const, data: [] as CommunityPost[] }),
      canView ? svcRpc<CommunityCounts>(supabase, "community_item_counts", { p_product_id: productId }) : Promise.resolve({ ok: true as const, data: { unanswered: 0, reported: 0 } as CommunityCounts }),
      getWorkspaceMembers(workspace.id),
      svcSchema(supabase).from("program_items").select("id, title").eq("product_id", productId).eq("kind", "lesson"),
    ]);
    const posts = feed.ok ? feed.data ?? [] : [];
    // Las fotos de los posts: links firmados de una hora, con el servicio, después del permiso (community.view).
    const paths = [...new Set(posts.flatMap((post) => mediaPaths(post.media)))];
    const photoUrls: Record<string, string> = {};
    if (paths.length) {
      const service = await createServiceClient();
      const { data: signed } = await service.storage.from(COMMUNITY_MEDIA_BUCKET).createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl;
    }
    return (
      <ProgramCommunity
        productId={productId}
        posts={posts}
        photoUrls={photoUrls}
        meUserId={ctx.user.id}
        spaces={community.spaces}
        communities={communities}
        community={community.key}
        programSettings={p!.portal_settings}
        usedBy={usedBy}
        rev={p!.portal_settings_rev ?? 0}
        counts={countsOf(counts.ok ? counts.data : null)}
        filter={filter}
        space={lessonId ? null : space}
        lessonId={lessonId}
        teamNames={Object.fromEntries(team.map((m) => [m.userId, m.name]))}
        businessName={resolveBrand(workspace as never).name}
        lessonTitles={Object.fromEntries(((lessons ?? []) as Array<{ id: string; title: string }>).map((l) => [l.id, l.title]))}
        can={{ reply: ctx.can("community.reply"), moderate: ctx.can("community.moderate"), spaces: ctx.can("community.spaces") }}
      />
    );
  }

  // Asistente IA (F84-F86, F110): el tutor, sus límites, el uso del mes y la base de conocimiento. El tutor y los otros
  // programas se leen con el cliente de servicio, del negocio de la sesión, después del permiso de la página.
  async function assistantTab() {
    // «Conversaciones» (00513): lo que preguntan los estudiantes y cómo respondió el tutor. La base mira el permiso
    // (`services.view` o `tutor.manage`, igual que el uso del mes).
    if (assistantView === "conversaciones") {
      const filter = parseConversationFilter(sp.filtro);
      const res = await svcRpc<unknown>(supabase, "tutor_conversations", { p_product_id: productId, p_filter: filter, p_limit: 30, p_before: null });
      return (
        <ProgramTutorConversations
          key={filter}
          productId={productId}
          filter={filter}
          initial={res.ok ? readConversationsPage(res.data) : null}
          error={res.ok ? null : res.error.message}
        />
      );
    }
    const service = await createServiceClient();
    const [{ data: tutorRow }, { data: others }, usage, knowledge] = await Promise.all([
      service.from("products").select("tutor_agent_id" as never).eq("id", productId).eq("workspace_id", workspace.id).maybeSingle(),
      service.from("products").select("id, name, tutor_agent_id" as never).eq("workspace_id", workspace.id).eq("portal_enabled" as never, true as never).is("archived_at", null).neq("id", productId),
      svcRpc<AssistantUsage>(supabase, "assistant_usage", { p_product_id: productId }),
      ctx.can("tutor.knowledge") || ctx.can("tutor.manage") ? svcRpc<TutorKnowledge>(supabase, "tutor_knowledge_list", { p_product_id: productId }) : Promise.resolve({ ok: false as const, error: { code: null, message: "", detail: null } }),
    ]);
    const tutorId = (tutorRow as { tutor_agent_id?: string | null } | null)?.tutor_agent_id ?? null;
    const { data: agent } = tutorId ? await service.from("agents").select("id, name, is_enabled").eq("id", tutorId).eq("workspace_id", workspace.id).is("deleted_at", null).maybeSingle() : { data: null };
    const a = agent as { id: string; name: string; is_enabled: boolean } | null;
    const settings = ((p!.portal_settings ?? {}) as { assistant?: Record<string, unknown> }).assistant ?? {};
    return (
      <ProgramAssistant
        productId={productId}
        tutor={a ? { id: a.id, name: a.name, enabled: a.is_enabled } : null}
        sections={(ps.sections ?? {}) as Record<string, boolean>}
        settings={settings as never}
        rev={p!.portal_settings_rev ?? 0}
        usage={usage.ok ? usage.data : null}
        knowledge={knowledge.ok ? knowledge.data : null}
        otherPrograms={((others ?? []) as unknown as Array<{ id: string; name: string; tutor_agent_id: string | null }>).map((o) => ({ id: o.id, name: o.name, hasTutor: !!o.tutor_agent_id }))}
        can={{ manage: ctx.can("tutor.manage"), sections: ctx.can("portal.sections"), knowledge: ctx.can("tutor.knowledge") }}
      />
    );
  }

  // Puntos (F129): la configuración sale del producto; el ranking, de `points_ranking` (00380).
  async function pointsTab() {
    // Decisión 4 (00402): con más de una comunidad, el ranking es el de la comunidad elegida en la barra.
    const ranking = await svcRpc<{ students: number; rows: RankingRow[] } | null>(supabase, "points_ranking", { p_product_id: productId, p_limit: 50, p_community: multiCommunity ? community.key : null });
    return (
      <ProgramPointsPanel
        productId={productId}
        settings={(((p!.portal_settings ?? {}) as { points?: PointsSettings }).points ?? {}) as PointsSettings}
        rev={p!.portal_settings_rev ?? 0}
        canEdit={ctx.can("portal.points")}
        ranking={ranking.ok ? ranking.data : null}
      />
    );
  }

  // @plantilla-desde(proyectos)
  // Proyectos y facturación (Corrida C, F80, F118, F120): cada vista lee con su función `projects_admin_*`.
  async function projectsTab() {
    const views: ProjectsView[] = ["pagos", "proyectos", "fama", "mesa", "ideas"];
    const view = (views as string[]).includes(sp.vista ?? "") ? (sp.vista as ProjectsView) : "pagos";
    const filter = sp.filtro === "unverified" || sp.filtro === "no_receipt" ? sp.filtro : "all";
    const period = sp.periodo === "month" ? "month" : "all";
    const none = Promise.resolve({ ok: false as const, error: { code: null, message: "", detail: null } });
    const [payments, projects, fame, ideas] = await Promise.all([
      view === "pagos" ? svcRpc<{ counts: { unverified: number; no_receipt: number }; rows: PaymentRow[] }>(supabase, "projects_admin_payments", { p_product_id: productId, p_filter: filter, p_limit: 300 }) : none,
      view === "proyectos" ? svcRpc<ProjectRow[]>(supabase, "projects_admin_projects", { p_product_id: productId }) : none,
      view === "fama" ? svcRpc<FameRow[]>(supabase, "projects_admin_fame", { p_product_id: productId, p_period: period }) : none,
      view === "ideas" && ctx.can("projects.templates") ? svcRpc<IdeaRow[]>(supabase, "projects_admin_ideas", { p_product_id: productId }) : none,
    ]);
    const settings = (p!.portal_settings ?? {}) as { fame?: FameSettings; projects?: { steps?: unknown[]; budget_ranges?: unknown[] } };
    return (
      <ProgramProjects
        productId={productId}
        view={view}
        filter={filter}
        period={period}
        payments={payments.ok ? payments.data : null}
        projects={projects.ok ? projects.data : null}
        fame={fame.ok ? fame.data : null}
        fameSettings={settings.fame ?? {}}
        ideas={ideas.ok ? ideas.data : null}
        workbench={{ steps: (settings.projects?.steps ?? []) as never, budget_ranges: (settings.projects?.budget_ranges ?? []) as never }}
        rev={p!.portal_settings_rev ?? 0}
        can={{ manageRevenue: ctx.can("student_revenue.manage"), fame: ctx.can("fame.manage"), templates: ctx.can("projects.templates") }}
      />
    );
  }
  // @plantilla-hasta(proyectos)

  // Lo sin contestar de la comunidad es el contador de su pestaña (lo mismo que cuenta «Por revisar»).
  const unanswered = ctx.can("community.view") ? await svcRpc<{ unanswered?: number }>(supabase, "community_item_counts", { p_product_id: productId }) : null;
  const unansweredCount = unanswered?.ok ? Number(unanswered.data?.unanswered ?? 0) || 0 : 0;

  // Comunidad y Puntos con más de una comunidad: cuál se mira, en la barra (00402).
  function communityToggle(t: "comunidad" | "puntos") {
    const shown = communities.filter((c) => !c.archived || c.key === community.key);
    return (
      <LinkViewToggle
        label="Comunidad"
        value={community.key}
        options={shown.map((c) => ({ value: c.key, label: c.name, href: `/dashboard/portal/${p.id}?${new URLSearchParams({ tab: t, comunidad: c.key })}` }))}
      />
    );
  }
  // Los contadores de la comunidad que se mira (`by_community`); con una sola comunidad, los de siempre.
  function countsOf(d: CommunityCounts | null | undefined): { unanswered: number; reported: number } {
    if (!d) return { unanswered: 0, reported: 0 };
    if (!multiCommunity) return { unanswered: Number(d.unanswered ?? 0) || 0, reported: Number(d.reported ?? 0) || 0 };
    const c = d.by_community?.[community.key];
    return { unanswered: Number(c?.unanswered ?? 0) || 0, reported: Number(c?.reported ?? 0) || 0 };
  }

  // Los controles de cada pestaña van en la barra superior (Servicios A2, F130.0); el contenido solo los recibe por la URL.
  const base = `/dashboard/portal/${p.id}`;
  const calView = sp.vista === "mes" || sp.vista === "series" || sp.vista === "grilla" ? sp.vista : "lista";
  const calMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? (sp.mes as string) : new Date().toISOString().slice(0, 7);
  const assistantView = sp.vista === "conversaciones" ? "conversaciones" : "tutor";
  const calHref = (v: string, extra: Record<string, string> = {}) => `${base}?${new URLSearchParams({ tab: "calendario", vista: v, mes: calMonth, ...extra })}`;
  let view: React.ReactNode = null;
  let quickFilter: React.ReactNode = null;
  let filters: React.ReactNode = null;
  let primary: React.ReactNode = null;
  const moreActions: MoreAction[] = [];
  if (tab === "contenido" && ctx.can("program.manage")) {
    primary = <PrimaryButton label="Nuevo módulo" text="Módulo" href={intentHref(`${base}?tab=contenido`, "nuevo", "modulo")} />;
  } else if (tab === "calendario") {
    view = (
      <LinkViewToggle
        label="Vistas del calendario"
        value={calView}
        options={[
          { value: "lista", label: "Lista", href: calHref("lista") },
          { value: "mes", label: "Mes", href: calHref("mes") },
          { value: "series", label: "Recurrentes", href: calHref("series") },
        ]}
      />
    );
    if (calView === "mes") filters = <MonthNav prevHref={calHref("mes", { mes: shiftMonth(calMonth, -1) })} nextHref={calHref("mes", { mes: shiftMonth(calMonth, 1) })} todayHref={calHref("mes", { mes: new Date().toISOString().slice(0, 7) })} />;
    if (ctx.can("live_sessions.manage")) primary = <PrimaryButton label={calView === "series" ? "Nueva sesión recurrente" : "Nueva sesión"} text={calView === "series" ? "Sesión recurrente" : "Sesión"} href={intentHref(calHref(calView), "nuevo", "sesion")} />;
  } else if (tab === "comunidad" && ctx.can("community.view")) {
    const filter = sp.filtro === "sin-contestar" ? "unanswered" : sp.filtro === "reportados" ? "reported" : "all";
    const space = sp.espacio && /^[a-z0-9_]{1,40}$/.test(sp.espacio) ? sp.espacio : null;
    const counts = await svcRpc<CommunityCounts>(supabase, "community_item_counts", { p_product_id: productId });
    const keepCommunity = multiCommunity ? community.key : null;
    if (multiCommunity) view = communityToggle("comunidad");
    quickFilter = (
      <LinkQuickFilterMenu
        label="Mostrar"
        value={communityQuickValue(filter, space)}
        allKey="all"
        options={communityQuickOptions({ base, spaces: community.spaces, counts: countsOf(counts.ok ? counts.data : null), community: keepCommunity })}
      />
    );
    if (ctx.can("community.spaces")) {
      moreActions.push({
        key: "espacios",
        label: multiCommunity ? "Comunidades y espacios" : "Espacios de la comunidad",
        href: intentHref(`${base}?${new URLSearchParams({ tab: "comunidad", ...(keepCommunity ? { comunidad: keepCommunity } : {}) })}`, "espacios", "1"),
      });
    }
  } else if (tab === "asistente") {
    const assistantHref = (extra: Record<string, string> = {}) => `${base}?${new URLSearchParams({ tab: "asistente", ...extra })}`;
    view = (
      <LinkViewToggle
        label="Vistas del Asistente IA"
        value={assistantView}
        options={[
          { value: "tutor", label: "Tutor", href: assistantHref() },
          { value: "conversaciones", label: "Conversaciones", href: assistantHref({ vista: "conversaciones" }) },
        ]}
      />
    );
    if (assistantView === "conversaciones") {
      quickFilter = (
        <LinkQuickFilterMenu
          label="Mostrar"
          value={parseConversationFilter(sp.filtro)}
          allKey="todas"
          options={CONVERSATION_FILTERS.map((f) => ({
            key: f,
            label: CONVERSATION_FILTER_LABELS[f],
            href: assistantHref(f === "todas" ? { vista: "conversaciones" } : { vista: "conversaciones", filtro: f }),
          }))}
        />
      );
    }
  } else if (tab === "puntos" && multiCommunity) {
    view = communityToggle("puntos");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={p.name}
        route="/dashboard/portal/[productId]"
        backHref={<BackLink href="/dashboard/portal" label="Volver a Portal" />}
        tabs={
          <TopbarTabs
            label="Secciones del programa"
            active={tab}
            tabs={tabs.map((t) => ({
              key: t.key,
              label: t.label,
              href: `/dashboard/portal/${p.id}?tab=${t.key}`,
              count: t.key === "comunidad" ? unansweredCount : null,
              countLabel: "sin contestar",
            }))}
          />
        }
        view={view}
        quickFilter={quickFilter}
        filters={filters}
        more={<TopbarMoreMenu actions={moreActions} />}
        right={<SettingsLinkButton href={`/dashboard/portal/${p.id}/ajustes`} label="Ajustes del programa" />}
        primary={primary}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-8">
          {tab === "contenido" ? (
            await contentTab()
          ) : tab === "calendario" ? (
            await calendarTab()
          ) : tab === "comunidad" ? (
            await communityTab()
          ) : tab === "asistente" ? (
            await assistantTab()
          ) : tab === "puntos" ? (
            await pointsTab()
          ) : (tab as string) === "proyectos" ? ( // @plantilla-quitar(proyectos)
            await projectsTab() // @plantilla-quitar(proyectos)
          ) : (
            <ProgramSettingsPanel
              productId={p.id}
              mode="affiliates"
              sections={ps.sections ?? {}}
              links={(p.links?.items ?? []).map((l) => ({ key: l.key, name: l.name, active: l.active }))}
              visibleLinkKeys={ps.affiliates?.visible_link_keys ?? []}
              rev={p.portal_settings_rev ?? 0}
              canEdit={canEdit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
