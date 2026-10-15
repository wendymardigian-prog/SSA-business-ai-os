"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FinanceTabs, ReadOnlyNote } from "@/components/finance/finance-tabs";
import { BackLink } from "@/components/forms/back-link";
import { SaleModal } from "@/components/sales/sale-modal";
import { archiveCommissionRule, duplicateCommissionRule, reorderCommissionRules, setCommissionRuleActive } from "@/lib/actions/commission-rules";
import { payeeLabel } from "@/lib/commissions/roles";
import { COMMISSIONS_PATH, activeRoles, roleTabHref } from "@/lib/commissions/rules-ui-access";
import { draftFromRule, emptyRuleDraft, type RuleDraft } from "@/lib/commissions/rules-ui-draft";
import type { OrderSaveResult } from "@/lib/commissions/rules-ui-order";
import type { RulesViewData } from "@/lib/commissions/rules-ui-load";
import type { RuleView } from "@/lib/commissions/rules-view";
import type { CommissionRule } from "@/lib/commissions/types";
import { RoleTabs } from "./role-tabs";
import { RolesDialog } from "./roles-dialog";
import { RuleList } from "./rule-list";
import { RulePanel } from "./rule-panel";
import { RuleTester } from "./rule-tester";
import { btnPrimary, btnSecondary } from "./ui";

/**
 * Finanzas > Comisiones > Reglas de comisión (F57 y F58). Las reglas deciden quién cobra comisión y cuánto cuando se
 * cobra un pago: una pestaña por rol, una lista ordenada por prioridad, y un panel lateral para crear o editar.
 * Sin `commissions.manage` (solo `commissions.view` con alcance «todo») es de solo lectura.
 *
 * La pestaña activa vive en la URL (`?rol=`) pero se cambia sin pedirle la página al servidor: ya trae las reglas de
 * todos los roles.
 */
type Panel = { draft: RuleDraft; position: number };
type Notice = { kind: "ok" | "error"; text: string };

export function RulesScreen({ data, initialRole }: { data: RulesViewData; initialRole: string | null }) {
  const router = useRouter();
  const canManage = data.access === "manage";
  const [role, setRole] = useState<string | null>(initialRole);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [archiving, setArchiving] = useState<RuleView | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, start] = useTransition();
  const returnFocus = useRef<HTMLElement | null>(null);
  const tabPanel = useRef<HTMLDivElement>(null);

  const roles = useMemo(() => activeRoles(data.roles), [data.roles]);
  // Si el rol elegido se desactivó (o dejó de existir), se muestra el primero que sigue activo.
  const selected = roles.some((r) => r.key === role) ? role : (roles[0]?.key ?? null);
  const roleDef = roles.find((r) => r.key === selected) ?? null;
  const views = (selected && data.rules[selected]) || [];
  const savedRules = useMemo<CommissionRule[]>(() => Object.values(data.rules).flatMap((list) => list.map((v) => v.rule)), [data.rules]);
  const ruleCounts = useMemo(() => Object.fromEntries(data.roles.map((r) => [r.key, data.rules[r.key]?.length ?? 0])), [data.roles, data.rules]);
  const panelId = "reglas-panel";

  function selectRole(key: string) {
    setRole(key);
    try {
      window.history.replaceState(null, "", roleTabHref(key));
    } catch {
      // Sin acceso al historial, la pestaña igual cambia: solo no queda en la URL.
    }
  }

  function remember() {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function openNew() {
    if (!roleDef) return;
    remember();
    setNotice(null);
    setPanel({ draft: emptyRuleDraft(roleDef, views.length), position: views.reduce((max, v) => Math.max(max, v.position), 0) + 1 });
  }

  function openEdit(view: RuleView) {
    remember();
    setNotice(null);
    setPanel({ draft: draftFromRule(view.rule, data.updatedAt[view.id] ?? null), position: view.position });
  }

  function closePanel() {
    setPanel(null);
    // Si la regla que abrió el panel se redibuja con los datos nuevos, el foco no se pierde en la nada.
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) tabPanel.current?.focus();
    });
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setNotice(null);
    start(async () => {
      const result = await action();
      if (!result.ok) return setNotice({ kind: "error", text: result.error });
      setNotice({ kind: "ok", text: success });
      router.refresh();
    });
  }

  async function saveOrder(ids: string[]): Promise<OrderSaveResult> {
    if (!selected) return { ok: false, error: "No hay un rol elegido" };
    const result = await reorderCommissionRules(selected, ids);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  const newButton = canManage && roleDef ? (
    <button type="button" onClick={openNew} aria-label="Nueva regla" className={btnPrimary}>
      <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Nueva regla</span>
    </button>
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/finanzas/comisiones/reglas"
        title="Reglas de comisión"
        backHref={<BackLink href={COMMISSIONS_PATH} label="Volver a Comisiones" />}
        tabs={<FinanceTabs />}
        right={newButton}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {!canManage && <ReadOnlyNote />}

          {data.loadError && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-sm">
              <p className="text-red-700 dark:text-red-300">No pudimos cargar las reglas de comisión.</p>
              <button type="button" onClick={() => router.refresh()} className={`${btnSecondary} mt-3`}>Reintentar</button>
            </div>
          )}

          {notice && (
            <div role={notice.kind === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${notice.kind === "error" ? "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200" : "border-border bg-muted/40"}`}>
              <p className="min-w-0 flex-1">{notice.text}</p>
              <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-xs underline-offset-2 hover:underline">Cerrar aviso</button>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Cuando se cobra un pago, el sistema mira las reglas de cada rol activo, de arriba hacia abajo, y la primera que cumple decide a quién se le paga y cuánto.
          </p>

          {roles.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm">
              <p className="font-medium">No hay roles de comisión activos</p>
              <p className="mx-auto mt-1 max-w-md text-muted-foreground">Sin roles activos nadie cobra comisión. {canManage ? "Activá uno desde «Roles»." : "Pedile a quien administra las comisiones que active uno."}</p>
              {canManage && (
                <button type="button" onClick={() => setRolesOpen(true)} className={`${btnPrimary} mt-4`}>
                  <Users className="h-4 w-4" aria-hidden /> Roles
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 max-w-full flex-1 basis-80">
                  <RoleTabs
                    panelId={panelId}
                    active={selected ?? ""}
                    onSelect={selectRole}
                    tabs={roles.map((r) => ({ key: r.key, name: r.name, count: ruleCounts[r.key] ?? 0 }))}
                  />
                </div>
                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setRolesOpen(true)} className={btnSecondary}>
                      <Users className="h-4 w-4" aria-hidden /> Roles
                    </button>
                    <button type="button" onClick={() => { remember(); setTestOpen(true); }} className={btnSecondary}>
                      <FlaskConical className="h-4 w-4" aria-hidden /> Probar con una venta
                    </button>
                  </div>
                )}
              </div>

              {roleDef && (
                <div ref={tabPanel} id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${roleDef.key}`} tabIndex={-1} className="space-y-3 outline-none">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{roleDef.name}</span>: se le paga a {payeeLabel(roleDef.payee).toLowerCase()}.
                    {pending && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" aria-label="Guardando" />}
                  </p>
                  <RuleList
                    key={roleDef.key}
                    role={roleDef}
                    rules={views}
                    canManage={canManage}
                    busy={pending}
                    onReorder={saveOrder}
                    onSettled={() => router.refresh()}
                    onCreate={openNew}
                    onEdit={openEdit}
                    onDuplicate={(view) => run(() => duplicateCommissionRule(view.id), `Copia de «${view.name}» creada al final de la lista.`)}
                    onToggle={(view) => run(() => setCommissionRuleActive(view.id, !view.rule.is_active), view.rule.is_active ? `«${view.name}» quedó pausada: no se usa, pero conserva su lugar.` : `«${view.name}» volvió a estar activa.`)}
                    onArchive={setArchiving}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {panel && roleDef && (
        <RulePanel
          key={panel.draft.id ?? "nueva"}
          role={roleDef}
          initial={panel.draft}
          savedRules={savedRules}
          editor={data.editor}
          lookups={data.lookups}
          position={panel.position}
          returnFocus={returnFocus}
          onClose={closePanel}
          onSaved={(text) => setNotice({ kind: "ok", text })}
        />
      )}

      {rolesOpen && <RolesDialog roles={data.roles} ruleCounts={ruleCounts} onClose={() => setRolesOpen(false)} onSaved={() => setNotice({ kind: "ok", text: "Roles guardados." })} />}

      {testOpen && (
        <SaleModal
          title="Probar con una venta"
          label="Probar con una venta"
          size="lg"
          onClose={() => setTestOpen(false)}
          footer={<button type="button" onClick={() => setTestOpen(false)} className={`${btnSecondary} ml-auto`}>Cerrar</button>}
        >
          <RuleTester editor={data.editor} lookups={data.lookups} savedRules={savedRules} />
        </SaleModal>
      )}

      {archiving && (
        <SaleModal
          title="Archivar regla"
          label="Archivar regla"
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button type="button" onClick={() => setArchiving(null)} className={`${btnSecondary} ml-auto`}>Cancelar</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const view = archiving;
                  setArchiving(null);
                  run(() => archiveCommissionRule(view.id), `«${view.name}» se archivó.`);
                }}
                className={btnPrimary}
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Archivar
              </button>
            </>
          }
        >
          <p className="text-sm">¿Archivás <strong>{archiving.name}</strong>?</p>
          <p className="text-sm text-muted-foreground">La regla deja de usarse y sale de la lista. Las comisiones que ya se generaron con ella no cambian. Si hace falta, podés crear otra igual.</p>
        </SaleModal>
      )}
    </div>
  );
}
