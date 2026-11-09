// @plantilla-quitar(servicios)
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { opensLabel, readVariantPortal } from "@/lib/services/screens/variant-portal-form";
import { SECTION_LABELS } from "@/lib/services/availability";
import { PageHeader } from "@/components/page-header";
import { HeaderTabs } from "@/components/ui/header-tabs";
import { ProgramSettingsPanel } from "@/components/services/portal/program-settings-panel";
import { ProgramTermsPanel } from "@/components/services/portal/program-terms-panel";
import { ProgramContentEditor, type ContentRow } from "@/components/services/portal/program-content-editor";
import { ProgramCalendar } from "@/components/services/portal/program-calendar";
import { loadCalendar } from "@/lib/program/load-calendar";
import { ProgramCommunity, type CommunityPost } from "@/components/services/portal/program-community";
import { lessonCommentsOn, programSpaces, LESSON_SPACE } from "@/lib/program/community";
import { svcRpc } from "@/lib/services/db";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveBrand } from "@/lib/brand";
import { ProgramAssistant, type AssistantUsage, type TutorKnowledge } from "@/components/services/portal/program-assistant";
import { svcSchema } from "@/lib/services/db";
import { createServiceClient } from "@/lib/supabase/server";
import type { PortalFormInitial } from "@/components/services/portal/portal-form-editor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Portal › un programa: Ajustes del programa (secciones prendidas y el resumen de variantes) y Afiliados (qué links ven
 * los estudiantes, F106). El contenido, las evaluaciones, el calendario y la comunidad se suman con sus bloques.
 */
export default async function PortalProgramPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<{ tab?: string; vista?: string; mes?: string; serie?: string; filtro?: string; espacio?: string; clase?: string }> }) {
  const [{ productId }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(productId)) notFound();
  const ctx = await requireAnyPermission(["portal.view", "portal.sections", "portal.access_rules", "portal.settings", "program.manage", "program.activate", "live_sessions.manage", "attendance.manage", "community.view", "community.spaces", "tutor.manage", "tutor.knowledge"]);
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const [{ data: product }, { data: variants }] = await Promise.all([
    supabase.from("products").select("id, name, portal_enabled, portal_settings, portal_settings_rev, links").eq("workspace_id", workspace.id).eq("id", productId).maybeSingle(),
    supabase.from("product_variants").select("id, name, portal_settings").eq("product_id", productId).is("archived_at", null).order("display_order"),
  ]);
  const p = product as unknown as { id: string; name: string; portal_enabled: boolean; portal_settings: Record<string, unknown> | null; portal_settings_rev: number; links: { items?: Array<{ key: string; name: string; active: boolean }> } | null } | null;
  if (!p || !p.portal_enabled) notFound();
  const tab = sp.tab === "afiliados" ? "afiliados" : sp.tab === "ajustes" ? "ajustes" : sp.tab === "calendario" ? "calendario" : sp.tab === "comunidad" ? "comunidad" : sp.tab === "asistente" ? "asistente" : "contenido";
  const ps = (p.portal_settings ?? {}) as { sections?: Record<string, boolean>; affiliates?: { visible_link_keys?: string[] } };
  const vs = ((variants ?? []) as unknown as Array<{ id: string; name: string; portal_settings: unknown }>).map((v) => ({ id: v.id, name: v.name, portal: readVariantPortal(v.portal_settings) }));
  const canEdit = ctx.can("portal.sections");

  // Términos al entrar (F113): el formulario del producto se lee con el cliente de servicio, del negocio de la sesión.
  async function termsPanel() {
    const terms = ((ps as { terms?: { enabled?: boolean; form_id?: string | null; ask_again_on_change?: boolean } }).terms ?? {}) as { enabled?: boolean; form_id?: string | null; ask_again_on_change?: boolean };
    let form: PortalFormInitial | null = null;
    if (terms.form_id) {
      const { data } = await (await createServiceClient()).from("forms").select("name, draft_definition").eq("id", terms.form_id).eq("workspace_id", workspace.id).maybeSingle();
      const f = data as { name: string; draft_definition: { intro?: string; fields?: PortalFormInitial["fields"] } } | null;
      if (f) form = { name: f.name, intro: f.draft_definition?.intro ?? "", fields: f.draft_definition?.fields ?? [], quiz: {}, grading: { enabled: false } };
    }
    return <ProgramTermsPanel productId={p!.id} terms={terms} rev={p!.portal_settings_rev ?? 0} form={form} canEdit={canEdit} />;
  }

  // Contenido (F45): el árbol se lee con la sesión (la RLS de program_items); las transcripciones, con su clase.
  async function contentTab() {
    const { data: items } = await svcSchema(supabase)
      .from("program_items")
      .select("id, parent_id, kind, lesson_type, title, description, position, status, unlock_rule, video_url, thumbnail_path, thumbnail_url, cover_path, required, comments_enabled, html_content, document_path, form_id")
      .eq("product_id", productId)
      .eq("workspace_id", workspace.id);
    const ids = ((items ?? []) as Array<{ id: string }>).map((i) => i.id);
    const { data: kb } = ids.length ? await supabase.from("knowledge_base").select("program_item_id").in("program_item_id" as never, ids as never) : { data: [] };
    const withTranscript = new Set(((kb ?? []) as unknown as Array<{ program_item_id: string | null }>).map((k) => k.program_item_id));
    // Los formularios de las evaluaciones y actividades (no aparecen en Formularios): con el cliente de servicio,
    // del negocio de la sesión, después del permiso de la página.
    const formIds = ((items ?? []) as Array<{ form_id?: string | null }>).map((i) => i.form_id).filter((x): x is string => !!x);
    const { data: forms } = formIds.length ? await (await createServiceClient()).from("forms").select("id, name, draft_definition").in("id", formIds).eq("workspace_id", workspace.id) : { data: [] };
    const formById = new Map(((forms ?? []) as Array<{ id: string; name: string; draft_definition: Record<string, unknown> }>).map((f) => [f.id, f]));
    const rows = ((items ?? []) as unknown as Array<Omit<ContentRow, "hasTranscript"> & { form_id?: string | null }>).map((r) => {
      const f = r.form_id ? formById.get(r.form_id) : null;
      const d = (f?.draft_definition ?? {}) as { intro?: string; fields?: PortalFormInitial["fields"]; quiz?: PortalFormInitial["quiz"]; grading?: PortalFormInitial["grading"] };
      return { ...r, hasTranscript: withTranscript.has(r.id), portalForm: f ? { name: f.name, intro: d.intro ?? "", fields: d.fields ?? [], quiz: d.quiz ?? {}, grading: d.grading ?? { enabled: false } } : null };
    });
    const counts = await svcRpc<{ by_item?: Record<string, number> }>(supabase, "community_item_counts", { p_product_id: productId });
    return <ProgramContentEditor productId={productId} rows={rows} canManage={ctx.can("program.manage")} canActivate={ctx.can("program.activate")} commentCounts={counts.ok ? counts.data?.by_item ?? {} : {}} />;
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
      canView ? svcRpc<CommunityPost[]>(supabase, "community_feed", { p_product_id: productId, p: { filter, space: lessonId ? LESSON_SPACE : space, program_item_id: lessonId, limit: 50 } }) : Promise.resolve({ ok: true as const, data: [] as CommunityPost[] }),
      canView ? svcRpc<{ unanswered: number; reported: number }>(supabase, "community_item_counts", { p_product_id: productId }) : Promise.resolve({ ok: true as const, data: { unanswered: 0, reported: 0 } }),
      getWorkspaceMembers(workspace.id),
      svcSchema(supabase).from("program_items").select("id, title").eq("product_id", productId).eq("kind", "lesson"),
    ]);
    return (
      <ProgramCommunity
        productId={productId}
        posts={feed.ok ? feed.data ?? [] : []}
        spaces={programSpaces(p!.portal_settings)}
        lessonComments={lessonCommentsOn(p!.portal_settings)}
        rev={p!.portal_settings_rev ?? 0}
        counts={counts.ok && counts.data ? { unanswered: counts.data.unanswered ?? 0, reported: counts.data.reported ?? 0 } : { unanswered: 0, reported: 0 }}
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={p.name}
        tooltip="El programa en el portal: qué secciones tiene, qué variantes dan acceso y qué links ven los estudiantes."
        backHref={
          <Link href="/dashboard/portal" aria-label="Volver a Portal" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        tabs={
          <HeaderTabs
            label="Secciones del programa"
            active={tab}
            items={[
              { key: "contenido", label: "Contenido" },
              { key: "calendario", label: "Calendario" },
              { key: "comunidad", label: "Comunidad" },
              { key: "asistente", label: "Asistente IA" },
              { key: "ajustes", label: "Ajustes del programa" },
              { key: "afiliados", label: "Afiliados" },
            ].map((t) => ({ ...t, href: `/dashboard/portal/${p.id}?tab=${t.key}` }))}
          />
        }
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
          ) : tab === "ajustes" ? (
            <div className="space-y-6">
              <section aria-labelledby="secciones" className="space-y-2">
                <h2 id="secciones" className="text-sm font-semibold">
                  Secciones del programa
                </h2>
                <ProgramSettingsPanel productId={p.id} mode="sections" sections={ps.sections ?? {}} links={[]} visibleLinkKeys={[]} rev={p.portal_settings_rev ?? 0} canEdit={canEdit} />
              </section>
              <section aria-labelledby="terminos" className="space-y-2">
                <h2 id="terminos" className="text-sm font-semibold">
                  Términos al entrar
                </h2>
                {await termsPanel()}
              </section>
              <section aria-labelledby="variantes" className="space-y-2">
                <h2 id="variantes" className="text-sm font-semibold">
                  Variantes
                </h2>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {vs.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <span className="text-foreground">{v.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {v.portal.enabled
                          ? (v.portal.sections ?? [])
                              .filter((s) => s.included !== false)
                              .map((s) => `${SECTION_LABELS[s.section as keyof typeof SECTION_LABELS] ?? s.section}: ${opensLabel(s).toLowerCase()}`)
                              .join(" · ") || "Con acceso, sin secciones"
                          : "Sin acceso al portal"}
                      </span>
                      <Link href={`/dashboard/settings/productos/${p.id}/variantes/${v.id}?tab=portal`} className="text-xs text-primary-ink hover:underline">
                        Editar en Productos
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
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
