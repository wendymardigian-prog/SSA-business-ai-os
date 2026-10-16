"use client";

import { MoreHorizontal } from "lucide-react";
import { InsertAssetButton } from "@/components/response-assets/insert-asset-button";
import { PopoverMenu, type MenuItem } from "@/components/automations/popover-menu";
import { useStepEditor } from "@/components/automations/step-tree-context";
import { BOOKING_STATUSES } from "@/lib/scheduling/booking-status";
import { FieldEmojiButton } from "@/components/ui/emoji-picker";
import { actionProblem, describeAction, emailRecipientsFor, kindOfStep, type EmailRecipient } from "@/lib/automations/step-catalog";
import { canDuplicate, canMove, duplicateStep, moveStep, patchStepData, removeStep } from "@/lib/automations/step-tree-edit";
import type { ActionStep, NodeData, Step } from "@/lib/automations/step-tree";

/**
 * Un paso comun: un email, un mensaje, una espera, un tag... Muestra lo que
 * hace en palabras y se edita ahi mismo. Los pasos que el editor no sabe
 * editar (una llamada HTTP, un agente de IA) se ven con su nombre y se
 * abren en el canvas.
 */

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
const textareaClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

const RECIPIENT_OPTION: Record<EmailRecipient, string> = {
  contact: "Al contacto",
  host: "Al anfitrión (quien da la reunión)",
  fixed: "A una dirección fija",
  member: "A quien envió el reporte",
  users: "A personas del equipo",
};

const CANCEL_STATUSES = ["cancelled_other", "cancelled_no_response", "cancelled_not_qualified"] as const;

export function ActionCard({ step, index, steps }: { step: ActionStep; index: number; steps: Step[] }) {
  const { screen, edit, disabled, sendStepTest, canSendTest } = useStepEditor();
  const kind = kindOfStep(step, screen);
  const problem = actionProblem(step, screen);

  const patch = (data: NodeData) => edit((t) => patchStepData(t, step.id, data));

  const items: MenuItem[] = [
    { key: "up", label: "Subir", disabled: !canMove(steps, index, -1), onSelect: () => edit((t) => moveStep(t, step.id, -1)) },
    { key: "down", label: "Bajar", disabled: !canMove(steps, index, 1), onSelect: () => edit((t) => moveStep(t, step.id, 1)) },
    // Un paso que el editor no edita no se duplica: la copia tampoco se podria guardar.
    ...(kind && canDuplicate(step) ? [{ key: "dup", label: "Duplicar paso", onSelect: () => edit((t) => duplicateStep(t, step.id)) } satisfies MenuItem] : []),
    ...(kind?.key === "email" && canSendTest ? [{ key: "test", label: "Enviarme este email", hint: "Va solo a tu email, con datos de ejemplo.", onSelect: () => sendStepTest(step) } satisfies MenuItem] : []),
    { key: "sep", separator: true },
    { key: "delete", label: "Borrar paso", destructive: true, onSelect: () => edit((t) => removeStep(t, step.id)) },
  ];

  const name = `s-${step.id}`;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3" data-step-id={step.id}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          {index + 1}. {describeAction(step, screen)}
        </p>
        <PopoverMenu
          align="right"
          disabled={disabled}
          items={items}
          triggerLabel={`Opciones del paso ${index + 1}`}
          trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
          triggerClassName="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      {kind?.key === "email" && <EmailEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {kind?.key === "message" && <MessageEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {kind?.key === "delay" && <DelayEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {(kind?.key === "tag_add" || kind?.key === "tag_remove") && <TagEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {kind?.key === "booking_status" && <BookingStatusEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {kind?.key === "cancel_booking" && <CancelEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {kind?.key === "notify_team" && <NotifyEditor name={name} step={step} patch={patch} disabled={disabled} />}
      {!kind && <p className="text-xs text-muted-foreground">Este paso se edita en el canvas. Acá se puede mover o borrar.</p>}

      {problem && <p className="text-[11px] text-amber-700 dark:text-amber-300">{problem}</p>}
    </div>
  );
}

interface EditorProps {
  name: string;
  step: ActionStep;
  patch: (data: NodeData) => void;
  disabled: boolean;
}

function EmailEditor({ name, step, patch, disabled }: EditorProps) {
  const { screen } = useStepEditor();
  const d = step.data;
  const to = String(d.to ?? "contact");
  const subject = String(d.subject ?? "");
  const body = String(d.body ?? "");

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${name}-to`} className="text-xs text-muted-foreground">
            Para
          </label>
          <select
            id={`${name}-to`}
            value={to}
            disabled={disabled}
            onChange={(e) =>
              patch({ to: e.target.value, ...(e.target.value === "fixed" ? {} : { fixedEmail: undefined }), ...(e.target.value === "users" ? {} : { userIds: undefined }) })
            }
            className={inputClass}
          >
            {emailRecipientsFor(screen).map((r) => (
              <option key={r} value={r}>
                {RECIPIENT_OPTION[r]}
              </option>
            ))}
          </select>
        </div>
        {to === "fixed" && (
          <div className="space-y-1">
            <label htmlFor={`${name}-fixed`} className="text-xs text-muted-foreground">
              Dirección de email
            </label>
            <input id={`${name}-fixed`} type="email" value={String(d.fixedEmail ?? "")} disabled={disabled} onChange={(e) => patch({ fixedEmail: e.target.value })} className={inputClass} />
          </div>
        )}
      </div>
      {to === "users" && <MemberPicker name={`${name}-users`} value={Array.isArray(d.userIds) ? (d.userIds as string[]) : []} onChange={(userIds) => patch({ userIds })} disabled={disabled} />}
      <div className="space-y-1">
        <label htmlFor={`${name}-subject`} className="text-xs text-muted-foreground">
          Asunto
        </label>
        <div className="flex items-center gap-1.5">
          <input id={`${name}-subject`} value={subject} disabled={disabled} onChange={(e) => patch({ subject: e.target.value })} className={inputClass} />
          <FieldEmojiButton targetId={`${name}-subject`} value={subject} disabled={disabled} onChange={(next) => patch({ subject: next })} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${name}-body`} className="text-xs text-muted-foreground">
            Texto
          </label>
          <span className="flex items-center gap-1.5">
            <FieldEmojiButton targetId={`${name}-body`} value={body} disabled={disabled} onChange={(next) => patch({ body: next })} />
            <InsertAssetButton targetId={`${name}-body`} value={body} disabled={disabled} onChange={(next) => patch({ body: next })} />
          </span>
        </div>
        <textarea id={`${name}-body`} value={body} disabled={disabled} rows={8} onChange={(e) => patch({ body: e.target.value })} className={`${textareaClass} font-mono text-xs`} />
      </div>
    </>
  );
}

function MessageEditor({ name, step, patch, disabled }: EditorProps) {
  const d = step.data;
  const messages = Array.isArray(d.messages) ? (d.messages as Array<Record<string, unknown>>) : [];
  const first = messages[0] ?? {};
  const text = String(first.text ?? "");
  // Un mensaje con botones, imagenes o varios globos: el texto se edita acá y lo demas se conserva.
  const hasMore = messages.length > 1 || Object.keys(first).some((key) => key !== "text");

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${name}-text`} className="text-xs text-muted-foreground">
            Mensaje
          </label>
          <span className="flex items-center gap-1.5">
            <FieldEmojiButton targetId={`${name}-text`} value={text} disabled={disabled} onChange={(next) => patch({ messages: [{ ...first, text: next }, ...messages.slice(1)] })} />
            <InsertAssetButton targetId={`${name}-text`} value={text} disabled={disabled} onChange={(next) => patch({ messages: [{ ...first, text: next }, ...messages.slice(1)] })} />
          </span>
        </div>
        <textarea
          id={`${name}-text`}
          value={text}
          disabled={disabled}
          rows={4}
          onChange={(e) => patch({ messages: [{ ...first, text: e.target.value }, ...messages.slice(1)] })}
          className={textareaClass}
        />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={d.onlyIfPhone === true} disabled={disabled} onChange={(e) => patch({ onlyIfPhone: e.target.checked })} />
        Saltear este paso si el contacto no tiene teléfono
      </label>
      {hasMore && <p className="text-[11px] text-muted-foreground">Este mensaje tiene más elementos (botones, imágenes u otros mensajes) que se editan en el canvas: acá se conservan tal cual.</p>}
    </div>
  );
}

function DelayEditor({ name, step, patch, disabled }: EditorProps) {
  const d = step.data;
  const unit = String(d.unit ?? "hours");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${name}-duration`} className="text-xs text-muted-foreground">
        Esperar
      </label>
      <input
        id={`${name}-duration`}
        type="number"
        min={1}
        value={Number(d.duration ?? 1)}
        disabled={disabled}
        onChange={(e) => patch({ duration: Number(e.target.value) || 1 })}
        className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-sm"
      />
      <select aria-label="Unidad" value={unit} disabled={disabled} onChange={(e) => patch({ unit: e.target.value })} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
        {unit === "seconds" && <option value="seconds">segundos</option>}
        <option value="minutes">minutos</option>
        <option value="hours">horas</option>
        <option value="days">días</option>
      </select>
    </div>
  );
}

function TagEditor({ name, step, patch, disabled }: EditorProps) {
  const { catalog } = useStepEditor();
  return (
    <div className="space-y-1">
      <label htmlFor={`${name}-tag`} className="text-xs text-muted-foreground">
        Nombre del tag
      </label>
      <input id={`${name}-tag`} list={`${name}-tags`} value={String(step.data.tagName ?? "")} disabled={disabled} onChange={(e) => patch({ tagName: e.target.value })} className={inputClass} />
      <datalist id={`${name}-tags`}>
        {(catalog?.tags ?? []).map((t) => (
          <option key={t.name} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}

function BookingStatusEditor({ name, step, patch, disabled }: EditorProps) {
  const current = String(step.data.status ?? "");
  // Cancelar es otro paso ("Cancelar la reunión"); acá solo los estados que no cancelan, salvo el que ya estaba.
  const options = BOOKING_STATUSES.filter((s) => s.group !== "cancelled" || s.key === current);
  return (
    <div className="space-y-1">
      <label htmlFor={`${name}-status`} className="text-xs text-muted-foreground">
        Nuevo estado
      </label>
      <select id={`${name}-status`} value={current} disabled={disabled} onChange={(e) => patch({ status: e.target.value })} className={inputClass}>
        {options.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CancelEditor({ name, step, patch, disabled }: EditorProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={`${name}-cancel`} className="text-xs text-muted-foreground">
        Motivo
      </label>
      <select id={`${name}-cancel`} value={String(step.data.status ?? "cancelled_other")} disabled={disabled} onChange={(e) => patch({ status: e.target.value })} className={inputClass}>
        {CANCEL_STATUSES.map((key) => (
          <option key={key} value={key}>
            {BOOKING_STATUSES.find((s) => s.key === key)?.label ?? key}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Personas del equipo, con casillas (EOD: un email o un aviso a gente elegida). */
function MemberPicker({ name, value, onChange, disabled }: { name: string; value: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const { members } = useStepEditor();
  if (members.length === 0) return <p className="text-xs text-muted-foreground">No hay personas en el equipo para elegir.</p>;
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs text-muted-foreground">Personas del equipo</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {members.map((m) => (
          <label key={m.userId} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              disabled={disabled}
              checked={value.includes(m.userId)}
              onChange={(e) => onChange(e.target.checked ? [...new Set([...value, m.userId])] : value.filter((id) => id !== m.userId))}
            />
            {m.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "Avisar en la campana": a quién, el título y el texto (con variables). */
function NotifyEditor({ name, step, patch, disabled }: EditorProps) {
  const d = step.data;
  const to = String(d.to ?? "users");
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label htmlFor={`${name}-to`} className="text-xs text-muted-foreground">
          Para
        </label>
        <select id={`${name}-to`} value={to} disabled={disabled} onChange={(e) => patch({ to: e.target.value })} className={inputClass}>
          <option value="users">Personas elegidas</option>
          <option value="reporter">Quien envió el reporte</option>
          <option value="both">Quien envió el reporte y personas elegidas</option>
        </select>
      </div>
      {to !== "reporter" && <MemberPicker name={`${name}-users`} value={Array.isArray(d.userIds) ? (d.userIds as string[]) : []} onChange={(userIds) => patch({ userIds })} disabled={disabled} />}
      <div className="space-y-1">
        <label htmlFor={`${name}-title`} className="text-xs text-muted-foreground">
          Título
        </label>
        <input id={`${name}-title`} value={String(d.title ?? "")} maxLength={200} disabled={disabled} onChange={(e) => patch({ title: e.target.value })} className={inputClass} />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${name}-body`} className="text-xs text-muted-foreground">
            Texto (opcional)
          </label>
          <FieldEmojiButton targetId={`${name}-body`} value={String(d.body ?? "")} disabled={disabled} onChange={(next) => patch({ body: next })} />
        </div>
        <textarea id={`${name}-body`} value={String(d.body ?? "")} maxLength={1000} rows={3} disabled={disabled} onChange={(e) => patch({ body: e.target.value })} className={textareaClass} />
      </div>
    </div>
  );
}
