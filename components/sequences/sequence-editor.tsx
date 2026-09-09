"use client";

import { useState, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  MessageSquare,
  Clock,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { updateSequence, deleteSequence } from "@/lib/actions/sequences";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { canActivate } from "@/lib/sequences/validate";
import { sequenceStatusStyle } from "@/lib/sequences/labels";
import type { SequenceStatus, SequenceStep } from "@/lib/types/database";

export interface AiProviderOption {
  provider: string;
  label: string;
  defaultModel: string;
  models: string[];
}

interface SequenceEditorProps {
  sequence: {
    id: string;
    name: string;
    description: string | null;
    status: SequenceStatus;
    steps: SequenceStep[];
  };
  /** Owner/Admin editan; un Member ve la secuencia en modo lectura. */
  canEdit: boolean;
  /** Proveedores de IA conectados, para los pasos con IA (F10). */
  aiProviders: AiProviderOption[];
}

export function SequenceEditor({ sequence, canEdit, aiProviders }: SequenceEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description || "");
  const [steps, setSteps] = useState<SequenceStep[]>(sequence.steps);
  const [status, setStatus] = useState<SequenceStatus>(sequence.status);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const statusStyle = sequenceStatusStyle(status);

  const updateStep = useCallback((index: number, patch: Partial<SequenceStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setSuccess(null);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setSuccess(null);
  }, []);

  const insertStep = useCallback((index: number, step: SequenceStep) => {
    setSteps((prev) => [...prev.slice(0, index), step, ...prev.slice(index)]);
    setSuccess(null);
  }, []);

  const moveStep = useCallback((index: number, delta: number) => {
    setSteps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSuccess(null);
  }, []);

  async function handleSave(nextStatus?: SequenceStatus) {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const result = await updateSequence(sequence.id, {
      name,
      description: description || null,
      steps,
      status: nextStatus ?? status,
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (nextStatus) setStatus(nextStatus);
    setSuccess("Cambios guardados");
    router.refresh();
  }

  function toggleStatus() {
    if (status === "active") {
      void handleSave("paused");
      return;
    }
    // La misma regla la vuelve a chequear el servidor; acá es para no hacer
    // el viaje y dar el aviso al toque.
    const allowed = canActivate(steps);
    if (!allowed.ok) {
      setError(allowed.error);
      return;
    }
    void handleSave("active");
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteSequence(sequence.id);
    if (!result.ok) {
      setError(result.error);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    router.push("/dashboard/sequences");
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-border px-8 py-5">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/sequences")}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Volver a las secuencias"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <label htmlFor="seq-name" className="sr-only">
            Nombre de la secuencia
          </label>
          <input
            id="seq-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSuccess(null);
            }}
            disabled={!canEdit}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold focus:border-input focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default"
          />

          <span
            className={cn(
              "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              statusStyle.classes
            )}
          >
            {statusStyle.label}
          </span>

          {canEdit && (
            <>
              <button
                onClick={toggleStatus}
                disabled={saving}
                className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {status === "active" ? "Pausar" : "Activar"}
              </button>
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                aria-label="Eliminar la secuencia"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-8 py-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {!canEdit && (
          <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Estás viendo la secuencia. Crear y editar secuencias es de Owner y Admin.
          </p>
        )}

        <label htmlFor="seq-description" className="mb-1 block text-xs font-medium text-muted-foreground">
          Descripción
        </label>
        <textarea
          id="seq-description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSuccess(null);
          }}
          disabled={!canEdit}
          rows={2}
          placeholder="Para qué sirve esta secuencia"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
        />

        <h2 className="mt-6 text-sm font-semibold">Pasos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Se ejecutan en orden. La secuencia se pausa sola en cuanto el contacto responde.
        </p>

        {steps.length === 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">Todavía no hay pasos</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Empezá con un mensaje, o con una espera si querés dejar pasar un rato.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {canEdit && <AddStepButton index={0} onAdd={insertStep} />}
          {steps.map((step, index) => (
            <div key={index} className="space-y-2">
              <StepCard
                step={step}
                index={index}
                total={steps.length}
                canEdit={canEdit}
                aiProviders={aiProviders}
                onChange={(patch) => updateStep(index, patch)}
                onRemove={() => removeStep(index)}
                onMove={(delta) => moveStep(index, delta)}
              />
              {canEdit && <AddStepButton index={index + 1} onAdd={insertStep} />}
            </div>
          ))}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          open
          title="Eliminar la secuencia"
          message="Se elimina la secuencia y todas sus inscripciones. No se puede deshacer."
          confirmLabel={deleting ? "Eliminando..." : "Eliminar"}
          destructive
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  canEdit,
  aiProviders,
  onChange,
  onRemove,
  onMove,
}: {
  step: SequenceStep;
  index: number;
  total: number;
  canEdit: boolean;
  aiProviders: AiProviderOption[];
  onChange: (patch: Partial<SequenceStep>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const icon =
    step.type === "message" ? (
      <MessageSquare className="h-4 w-4 text-muted-foreground" />
    ) : step.type === "aiMessage" ? (
      <Sparkles className="h-4 w-4 text-muted-foreground" />
    ) : (
      <Clock className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">{icon}</div>
        <span className="text-xs font-medium text-muted-foreground">Paso {index + 1}</span>
        <div className="flex-1" />
        {canEdit && (
          <>
            <button
              onClick={() => onMove(-1)}
              disabled={index === 0}
              className="rounded p-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label={`Subir el paso ${index + 1}`}
            >
              ↑
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              className="rounded p-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label={`Bajar el paso ${index + 1}`}
            >
              ↓
            </button>
            <button
              onClick={onRemove}
              className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              aria-label={`Eliminar el paso ${index + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {step.type === "message" && (
        <>
          <label htmlFor={`step-${index}-content`} className="sr-only">
            Mensaje del paso {index + 1}
          </label>
          <textarea
            id={`step-${index}-content`}
            value={step.content || ""}
            onChange={(e) => onChange({ content: e.target.value })}
            disabled={!canEdit}
            rows={3}
            placeholder="Lo que se le manda al contacto. Podés usar {{contact.display_name}}."
            className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
          />
        </>
      )}

      {step.type === "aiMessage" && (
        <AiStepFields
          step={step}
          index={index}
          canEdit={canEdit}
          aiProviders={aiProviders}
          onChange={onChange}
        />
      )}

      {step.type === "delay" && (
        <DelayPicker
          index={index}
          minutes={step.delayMinutes || 60}
          canEdit={canEdit}
          onChange={(delayMinutes) => onChange({ delayMinutes })}
        />
      )}
    </div>
  );
}

function AiStepFields({
  step,
  index,
  canEdit,
  aiProviders,
  onChange,
}: {
  step: SequenceStep;
  index: number;
  canEdit: boolean;
  aiProviders: AiProviderOption[];
  onChange: (patch: Partial<SequenceStep>) => void;
}) {
  const selected = aiProviders.find((p) => p.provider === step.provider);

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label htmlFor={`step-${index}-prompt`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Qué tiene que decir
        </label>
        <textarea
          id={`step-${index}-prompt`}
          value={step.prompt || ""}
          onChange={(e) => onChange({ prompt: e.target.value })}
          disabled={!canEdit}
          rows={3}
          placeholder="Escribile recordándole que la promo vence mañana, en dos líneas y sin sonar insistente."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
        />
      </div>

      {aiProviders.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400">
          No hay ningún proveedor de IA conectado. Se configura en Ajustes → Integraciones.
          Sin eso, el paso queda registrado con el error y la secuencia sigue con el siguiente.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`step-${index}-provider`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Proveedor
            </label>
            <select
              id={`step-${index}-provider`}
              value={step.provider || ""}
              onChange={(e) => onChange({ provider: e.target.value || undefined, model: undefined })}
              disabled={!canEdit}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
            >
              <option value="">El que esté conectado</option>
              {aiProviders.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`step-${index}-model`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Modelo
            </label>
            <select
              id={`step-${index}-model`}
              value={step.model || ""}
              onChange={(e) => onChange({ model: e.target.value || undefined })}
              disabled={!canEdit || !selected}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
            >
              <option value="">Por defecto</option>
              {(selected?.models ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

const UNITS = [
  { key: "minutes", label: "minutos", factor: 1 },
  { key: "hours", label: "horas", factor: 60 },
  { key: "days", label: "días", factor: 1440 },
] as const;

function DelayPicker({
  index,
  minutes,
  canEdit,
  onChange,
}: {
  index: number;
  minutes: number;
  canEdit: boolean;
  onChange: (minutes: number) => void;
}) {
  // Se muestra en la unidad más grande que dé un número entero, que es como
  // lo pensó quien lo escribió ("3 días", no "4320 minutos").
  const unit =
    minutes % 1440 === 0 ? UNITS[2] : minutes % 60 === 0 ? UNITS[1] : UNITS[0];
  const value = Math.max(1, Math.round(minutes / unit.factor));

  return (
    <div className="mt-3 flex items-center gap-2">
      <label htmlFor={`step-${index}-delay`} className="text-sm text-muted-foreground">
        Esperar
      </label>
      <input
        id={`step-${index}-delay`}
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1) * unit.factor)}
        disabled={!canEdit}
        className="w-20 rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
      />
      <label htmlFor={`step-${index}-unit`} className="sr-only">
        Unidad de la espera del paso {index + 1}
      </label>
      <select
        id={`step-${index}-unit`}
        value={unit.key}
        onChange={(e) => {
          const next = UNITS.find((u) => u.key === e.target.value) ?? UNITS[0];
          onChange(value * next.factor);
        }}
        disabled={!canEdit}
        className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-70"
      >
        {UNITS.map((u) => (
          <option key={u.key} value={u.key}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function AddStepButton({
  index,
  onAdd,
}: {
  index: number;
  onAdd: (index: number, step: SequenceStep) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar paso
      </button>
    );
  }

  const options: Array<{ label: string; icon: React.ReactNode; step: SequenceStep }> = [
    {
      label: "Mensaje",
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      step: { type: "message", content: "" },
    },
    {
      label: "Mensaje con IA",
      icon: <Sparkles className="h-3.5 w-3.5" />,
      step: { type: "aiMessage", prompt: "" },
    },
    {
      label: "Espera",
      icon: <Clock className="h-3.5 w-3.5" />,
      step: { type: "delay", delayMinutes: 60 },
    },
  ];

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-2">
      {options.map((option) => (
        <button
          key={option.label}
          onClick={() => {
            onAdd(index, option.step);
            setOpen(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          {option.icon}
          {option.label}
        </button>
      ))}
      <button
        onClick={() => setOpen(false)}
        className="ml-auto rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
      >
        Cancelar
      </button>
    </div>
  );
}
