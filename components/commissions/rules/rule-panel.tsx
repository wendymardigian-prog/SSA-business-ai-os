"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FlaskConical, Loader2, X } from "lucide-react";
import { Drawer } from "@/components/content/drawer/drawer";
import { createCommissionRule, updateCommissionRule } from "@/lib/actions/commission-rules";
import type { DescribeLookups } from "@/lib/commissions/describe";
import type { RulesScreenData } from "@/lib/commissions/list-load";
import {
  NEW_RULE_PREVIEW_ID,
  describeDraft,
  isDraftDirty,
  isEditConflict,
  previewRuleFrom,
  validateRuleDraft,
  type DraftErrors,
  type RuleDraft,
} from "@/lib/commissions/rules-ui-draft";
import type { CommissionRole, CommissionRule } from "@/lib/commissions/types";
import { RuleFormFields } from "./rule-form-fields";
import { RuleTester, type DraftRuleForTest } from "./rule-tester";
import { btnIcon, btnPrimary, btnSecondary } from "./ui";

/**
 * El panel lateral para crear o editar una regla (F57). En el celular ocupa toda la pantalla. Valida con el mismo
 * esquema que el servidor antes de enviar; si alguien cambió la regla mientras se editaba, lo dice y no pisa su
 * cambio. «Probar esta regla» (F58) muestra la prueba adentro del mismo panel, con la regla tal como está en el
 * formulario aunque todavía no se haya guardado. Si hay cambios sin guardar, cerrar pide confirmación.
 */
export function RulePanel({
  role,
  initial,
  savedRules,
  editor,
  lookups,
  position,
  returnFocus,
  onClose,
  onSaved,
}: {
  role: CommissionRole;
  initial: RuleDraft;
  /** Las reglas guardadas de todos los roles. */
  savedRules: CommissionRule[];
  editor: RulesScreenData["editor"];
  lookups: DescribeLookups;
  /** El lugar de la regla (el actual, o el siguiente al último si es nueva). */
  position: number;
  returnFocus: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const uid = useId();
  const body = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [view, setView] = useState<"form" | "test">("form");
  const [testRule, setTestRule] = useState<DraftRuleForTest | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [pending, start] = useTransition();

  const editing = initial.id !== null;
  const dirty = isDraftDirty(initial, draft);
  const conflict = isEditConflict(serverError);
  const sentence = useMemo(() => describeDraft(draft, lookups), [draft, lookups]);
  const title = editing ? "Editar regla" : `Nueva regla de ${role.name}`;

  // Después de un intento fallido, el foco va al primer campo con error.
  useEffect(() => {
    if (focusTick === 0) return;
    const target = body.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? body.current?.querySelector<HTMLElement>('[role="alert"]');
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  }, [focusTick]);

  function set(patch: Partial<RuleDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setServerError(null);
  }

  function requestClose() {
    if (pending) return;
    if (dirty && !window.confirm("Tenés cambios sin guardar. ¿Cerrás igual y los perdés?")) return;
    onClose();
  }

  function checked() {
    const result = validateRuleDraft(draft, role);
    if (!result.ok) {
      setErrors(result.errors);
      setServerError(null);
      setView("form");
      setFocusTick((t) => t + 1);
      return null;
    }
    setErrors({});
    return result.input;
  }

  function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending) return;
    const input = checked();
    if (!input) return;
    setServerError(null);
    start(async () => {
      const result = draft.id ? await updateCommissionRule(draft.id, input, draft.updatedAt) : await createCommissionRule(role.key, input);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      router.refresh();
      onSaved(draft.id ? ("changed" in result && result.changed === false ? "No había cambios para guardar." : "Regla guardada.") : "Regla creada al final de la lista.");
      onClose();
    });
  }

  function openTest() {
    const input = checked();
    if (!input) return;
    setTestRule({
      payload: previewRuleFrom(input, { id: draft.id ?? NEW_RULE_PREVIEW_ID, position }),
      pausedNote: !!initial.id && !initial.isActive,
    });
    setView("test");
  }

  return (
    <Drawer
      size="idea"
      label={title}
      returnFocus={returnFocus}
      onClose={requestClose}
      header={
        <>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{view === "test" ? "Probar esta regla" : title}</h2>
          <button type="button" onClick={requestClose} aria-label="Cerrar" className={btnIcon}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </>
      }
      footer={
        view === "test" ? (
          <button type="button" onClick={() => setView("form")} className={`${btnSecondary} ml-auto`}>Volver a la regla</button>
        ) : (
          <>
            {serverError && !conflict && <p role="alert" className="min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">{serverError}</p>}
            {!serverError && Object.keys(errors).length > 0 && <p role="alert" className="min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">Revisá los campos marcados.</p>}
            <button type="button" onClick={openTest} disabled={pending} className={`${btnSecondary} sm:ml-auto`}>
              <FlaskConical className="h-4 w-4" aria-hidden /> Probar esta regla
            </button>
            <button type="button" onClick={requestClose} disabled={pending} className={btnSecondary}>Cancelar</button>
            <button type="submit" form={`${uid}-form`} disabled={pending || conflict} className={btnPrimary}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear regla"}
            </button>
          </>
        )
      }
    >
      <div ref={body}>
        <div hidden={view !== "form"}>
          {conflict && (
            <div role="alert" className="m-4 space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="flex items-start gap-2 font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Esta regla cambió mientras la editabas
              </p>
              <p className="text-xs text-amber-900/90 dark:text-amber-200/90">Para no pisar el cambio de la otra persona, no guardamos el tuyo. Cerrá este panel, mirá cómo quedó la regla y volvé a aplicar lo que necesitás.</p>
              <button type="button" onClick={() => { router.refresh(); onClose(); }} className={btnSecondary}>Cerrar y ver lo último</button>
            </div>
          )}
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Así se lee la regla</p>
            <p className="mt-0.5 break-words text-sm">{sentence}</p>
          </div>
          <form id={`${uid}-form`} onSubmit={save} noValidate>
            <RuleFormFields draft={draft} set={set} errors={errors} role={role} editor={editor} lookups={lookups} uid={uid} />
          </form>
        </div>
        <div hidden={view !== "test"} className="px-4 py-4">
          {testRule && <RuleTester key={JSON.stringify(testRule.payload)} editor={editor} lookups={lookups} savedRules={savedRules} draftRule={testRule} />}
        </div>
      </div>
    </Drawer>
  );
}
