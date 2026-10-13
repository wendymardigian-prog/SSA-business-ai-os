"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { CheckCircle2, Loader2, Lock, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Historial } from "@/components/historial/historial";
import { Avatar } from "@/components/ui/filter-menu";
import type { CellPatch } from "@/lib/tasks/cell-edit";
import { applyDraftPatch, draftFromDefaults, draftProblem, valuesFromTask, type DraftDefaults, type TaskValues } from "@/lib/tasks/draft";
import { wouldCreateCycle } from "@/lib/tasks/dependencies";
import { dueLabel, formatSource, type SourceContext } from "@/lib/tasks/format";
import { colorOf, initialsOf } from "@/lib/tasks/people";
import type { ProjectSummary } from "@/lib/tasks/project";
import { openBlockers, type MemberLite } from "@/lib/tasks/table-model";
import { TASK_LIMITS, type TaskRow } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { BlockedMark, PersonBadge, PriorityChip, StatusChip } from "./chips";
import { AutoSaveText, DateField, DurationSelect, FieldRow, Section, TimeField } from "./fields";
import { useTimeFormat } from "./time-format-context";
import { DURATION_OPTIONS } from "@/lib/tasks/time";
import { CenterDialog, SidePanel } from "./overlay";
import { MemberPicker, MembersMultiPicker, PriorityPicker, ProjectPicker, StatusPicker } from "./pickers";
import type { TaskActions } from "./use-task-actions";
import { FloatingPanel } from "./floating";
import { foldText } from "@/lib/tasks/text";

export interface TaskDrawerProps {
  /** `view`: una tarea que existe. `create`: el formulario completo de una tarea nueva. */
  mode: "view" | "create";
  /** En `view`, la tarea; si es null, no existe o no se puede ver. */
  task: TaskRow | null;
  allTasks: TaskRow[];
  members: MemberLite[];
  memberNames: ReadonlyMap<string, string>;
  projects: ProjectSummary[];
  today: string;
  timeZone: string;
  canEdit: boolean;
  canDelete: boolean;
  actions: TaskActions;
  contactName: string | null;
  source: SourceContext;
  /** Al crear: valores iniciales (por ejemplo, el contacto desde el que se crea). */
  defaults?: DraftDefaults & { contact_id?: string | null; conversation_id?: string | null };
  currentUserId: string;
  historyNames: Record<string, string>;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onCreated: (task: TaskRow) => void;
  returnFocus?: MutableRefObject<HTMLElement | null>;
}

export function TaskDrawer(props: TaskDrawerProps) {
  const { mode, task, onClose, returnFocus } = props;

  if (mode === "view" && !task) {
    return (
      <SidePanel label="Tarea no encontrada" onClose={onClose} returnFocus={returnFocus} header={<><h2 className="min-w-0 flex-1 text-base font-semibold">No encontramos esta tarea</h2><CloseButton onClose={onClose} /></>}>
        <div className="p-6 text-sm text-muted-foreground">
          <p>Puede que la hayan borrado o que no tengas acceso a ella.</p>
          <button type="button" onClick={onClose} className="mt-4 h-9 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Volver a la lista</button>
        </div>
      </SidePanel>
    );
  }
  return <DrawerBody {...props} />;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}

// Un selector abierto desde un boton del drawer.
type PickerName = "status" | "priority" | "owner" | "followers" | "project";

function DrawerBody(props: TaskDrawerProps) {
  const { mode, task, allTasks, members, memberNames, projects, today, canEdit, canDelete, actions, contactName, source, defaults, onClose, onOpenTask, onCreated, returnFocus } = props;
  const creating = mode === "create";
  const editable = creating || canEdit;
  const timeFormat = useTimeFormat();

  const [draft, setDraft] = useState<TaskValues>(() => draftFromDefaults(defaults, props.currentUserId));
  const values: TaskValues = creating ? draft : valuesFromTask(task as TaskRow);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState<PickerName | null>(null);
  const [blockerPicker, setBlockerPicker] = useState(false);

  const statusRef = useRef<HTMLButtonElement>(null);
  const priorityRef = useRef<HTMLButtonElement>(null);
  const ownerRef = useRef<HTMLButtonElement>(null);
  const followersRef = useRef<HTMLButtonElement>(null);
  const projectRef = useRef<HTMLButtonElement>(null);
  const blockerAnchor = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);

  /** Aplica un cambio: al crear, al borrador; al editar, se guarda en el servidor. */
  async function patch(change: CellPatch) {
    if (creating) {
      setDraft((d) => applyDraftPatch(d, change));
      return;
    }
    if (task) await actions.edit(task.id, change);
  }

  async function submitCreate() {
    if (draftProblem(draft) || saving) return;
    setSaving(true);
    const created = await actions.create({
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      start_date: draft.start_date,
      due_date: draft.due_date,
      due_time: draft.due_time,
      duration_minutes: draft.duration_minutes,
      owner_id: draft.owner_id,
      follower_ids: draft.follower_ids,
      project: draft.project,
      contact_id: defaults?.contact_id ?? null,
      conversation_id: defaults?.conversation_id ?? null,
    });
    setSaving(false);
    if (created) onCreated(created);
  }

  const close = onClose;
  const busy = !creating && !!task && actions.busy.has(task.id);
  const isDone = values.status === "completed";
  const ownerName = values.owner_id ? (memberNames.get(values.owner_id) ?? null) : null;

  const header = (
    <>
      {!creating && (
        <div className="shrink-0 pt-0.5">
          <PickerButton refEl={statusRef} disabled={!editable} onClick={() => setOpen("status")} label={`Estado: ${values.status}. Cambiar`}>
            <StatusChip status={values.status} />
          </PickerButton>
        </div>
      )}
      <div className="min-w-0 flex-1">
        {creating && <p className="px-2 text-xs font-medium text-muted-foreground">Nueva tarea</p>}
        <AutoSaveText
          value={values.title}
          onSave={(title) => patch({ title })}
          label="Título de la tarea"
          placeholder="¿Qué hay que hacer?"
          maxLength={TASK_LIMITS.title}
          disabled={!editable}
          required
          autoFocus={creating}
          className={cn("text-base font-semibold", isDone && "text-muted-foreground line-through")}
        />
      </div>
      <CloseButton onClose={close} />
    </>
  );

  const footer = creating ? (
    <>
      <button type="button" onClick={() => void submitCreate()} disabled={!!draftProblem(draft) || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Crear tarea
      </button>
      <button type="button" onClick={close} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
    </>
  ) : (
    <>
      {canEdit && task && (
        isDone ? (
          <button type="button" onClick={() => void actions.edit(task.id, { status: "pending" })} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
            <RotateCcw className="h-4 w-4" aria-hidden /> Reabrir
          </button>
        ) : (
          <button type="button" onClick={() => void actions.requestComplete(task.id)} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Completar
          </button>
        )
      )}
      {canDelete && task && (
        <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400">
          <Trash2 className="h-4 w-4" aria-hidden /> Borrar
        </button>
      )}
    </>
  );

  return (
    <>
      <SidePanel label={creating ? "Nueva tarea" : `Tarea: ${values.title}`} onClose={close} returnFocus={returnFocus} header={header} footer={footer}>
        {!editable && <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Podés ver esta tarea, pero no editarla.</p>}

        <Section title="Detalles">
          <FieldRow label="Descripción" top>
            <AutoSaveText value={values.description ?? ""} onSave={(description) => patch({ description: description || null })} label="Descripción" placeholder="Agregá detalles (texto simple)" maxLength={TASK_LIMITS.description} multiline disabled={!editable} />
          </FieldRow>
          <FieldRow label="Prioridad">
            <PickerButton refEl={priorityRef} disabled={!editable} onClick={() => setOpen("priority")} label="Cambiar la prioridad">
              <PriorityChip priority={values.priority} />
            </PickerButton>
          </FieldRow>
          <FieldRow label="Inicio">
            <DateField value={values.start_date} onSave={(start_date) => patch({ start_date })} label="Fecha de inicio" disabled={!editable} max={values.due_date} />
          </FieldRow>
          <FieldRow label="Vencimiento">
            <div className="flex items-center gap-2">
              <DateField value={values.due_date} onSave={(due_date) => patch({ due_date })} label="Fecha de vencimiento" disabled={!editable} min={values.start_date} />
              {!creating && task && values.due_date && (
                <span className={cn("shrink-0 text-xs", dueLabel(task, today, timeFormat).tone === "overdue" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{dueLabel(task, today, timeFormat).text}</span>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Hora">
            <TimeField value={values.due_time} onSave={(due_time) => patch({ due_time })} label="Hora de vencimiento" disabled={!editable || !values.due_date} />
            {!values.due_date && <p className="mt-1 text-xs text-muted-foreground">Elegí primero una fecha. Sin hora, la tarea es solo para ese día.</p>}
          </FieldRow>
          <FieldRow label="Duración">
            <DurationSelect value={values.duration_minutes} onChange={(duration_minutes) => patch({ duration_minutes })} label="Duración" disabled={!editable || !values.due_time} options={DURATION_OPTIONS} />
          </FieldRow>
        </Section>

        <Section title="Personas">
          <FieldRow label="Responsable">
            <PickerButton refEl={ownerRef} disabled={!editable} onClick={() => setOpen("owner")} label="Cambiar el responsable">
              <PersonBadge id={values.owner_id} name={ownerName} />
            </PickerButton>
          </FieldRow>
          <FieldRow label="Seguidores">
            <PickerButton refEl={followersRef} disabled={!editable} onClick={() => setOpen("followers")} label="Cambiar los seguidores">
              {values.follower_ids.length === 0 ? (
                <span className="text-sm text-muted-foreground">Nadie</span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  {values.follower_ids.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-2 text-xs">
                      <Avatar initials={initialsOf(memberNames.get(id) ?? "?")} color={colorOf(id)} size="sm" />
                      {memberNames.get(id) ?? "Alguien del equipo"}
                    </span>
                  ))}
                </span>
              )}
            </PickerButton>
          </FieldRow>
        </Section>

        <Section title="Proyecto">
          <FieldRow label="Proyecto">
            <PickerButton refEl={projectRef} disabled={!editable} onClick={() => setOpen("project")} label="Cambiar el proyecto">
              {values.project ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-sm">{values.project}</span> : <span className="text-sm text-muted-foreground">Sin proyecto</span>}
            </PickerButton>
          </FieldRow>
        </Section>

        {!creating && task && (
          <>
            <DependenciesSection
              task={task}
              byId={byId}
              allTasks={allTasks}
              today={today}
              canEdit={canEdit}
              busy={busy}
              onOpenTask={onOpenTask}
              onChange={(ids) => actions.saveBlockers(task.id, ids)}
              onAdd={() => setBlockerPicker(true)}
              addRef={blockerAnchor}
            />

            <Section title="Vínculos">
              <FieldRow label="Contacto">
                {task.contact_id ? <Link href={`/dashboard/contacts/${task.contact_id}`} className="text-sm text-primary hover:underline">{contactName ?? "Ver contacto"}</Link> : <span className="text-sm text-muted-foreground">Sin contacto</span>}
              </FieldRow>
              <FieldRow label="Conversación">
                {task.conversation_id ? <Link href={`/dashboard/inbox?c=${task.conversation_id}`} className="text-sm text-primary hover:underline">Abrir la conversación</Link> : <span className="text-sm text-muted-foreground">Sin conversación</span>}
              </FieldRow>
            </Section>

            <Section title="Origen">
              <FieldRow label="Creada por">
                {(() => {
                  const info = formatSource(task, source);
                  return info.href ? <Link href={info.href} className="text-sm text-primary hover:underline">{info.label}</Link> : <span className="text-sm">{info.label}</span>;
                })()}
              </FieldRow>
            </Section>

            <Section title="Historial">
              <Historial key={`${task.id}:${task.updated_at}`} entityType="task" entityId={task.id} names={{ users: props.historyNames }} timeZone={props.timeZone} pageSize={10} />
            </Section>
          </>
        )}
        {creating && defaults?.contact_id && (
          <Section title="Vínculos">
            <FieldRow label="Contacto">
              <span className="text-sm">{contactName ?? "Este contacto"}</span>
            </FieldRow>
          </Section>
        )}
        {creating && (
          <p className="px-4 py-4 text-xs text-muted-foreground">Las dependencias y el historial aparecen cuando la tarea está creada.</p>
        )}
      </SidePanel>

      {open === "status" && <StatusPicker anchor={statusRef} current={values.status} onPick={(status) => { setOpen(null); void patch({ status }); }} onClose={() => setOpen(null)} />}
      {open === "priority" && <PriorityPicker anchor={priorityRef} current={values.priority} onPick={(priority) => { setOpen(null); void patch({ priority }); }} onClose={() => setOpen(null)} />}
      {open === "owner" && <MemberPicker anchor={ownerRef} members={members} current={values.owner_id} onPick={(owner_id) => { setOpen(null); void patch({ owner_id }); }} onClose={() => setOpen(null)} />}
      {open === "followers" && (
        <MembersMultiPicker anchor={followersRef} members={members} selected={values.follower_ids} excludeId={values.owner_id} max={TASK_LIMITS.followers} onCommit={(follower_ids) => void patch({ follower_ids })} onClose={() => setOpen(null)} />
      )}
      {open === "project" && <ProjectPicker anchor={projectRef} projects={projects} current={values.projectKey} onPick={(project) => { setOpen(null); void patch({ project }); }} onClose={() => setOpen(null)} />}
      {blockerPicker && task && (
        <BlockerPicker
          anchor={blockerAnchor}
          task={task}
          allTasks={allTasks}
          today={today}
          onPick={(id) => { setBlockerPicker(false); void actions.saveBlockers(task.id, [...task.blocked_by.map((b) => b.task_id), id]); }}
          onClose={() => setBlockerPicker(false)}
        />
      )}
      {confirmDelete && task && (
        <CenterDialog label="Borrar la tarea" onClose={() => setConfirmDelete(false)}>
          <div className="p-5">
            <h2 className="text-base font-semibold">¿Borrar «{task.title}»?</h2>
            <p className="mt-1 text-sm text-muted-foreground">La tarea deja de verse y se saca de las dependencias de las demás. Las fechas de las otras tareas no se mueven.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
              <button
                type="button"
                onClick={async () => {
                  setConfirmDelete(false);
                  if (await actions.remove(task.id)) onClose();
                }}
                className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:opacity-90"
              >
                Borrar
              </button>
            </div>
          </div>
        </CenterDialog>
      )}
    </>
  );
}

/** El boton que abre un selector. Sin permiso de editar, es solo el valor. */
function PickerButton({ refEl, onClick, children, label, disabled }: { refEl: RefObject<HTMLButtonElement | null>; onClick: () => void; children: React.ReactNode; label: string; disabled?: boolean }) {
  if (disabled) return <div className="px-2 py-1">{children}</div>;
  return (
    <button ref={refEl} type="button" onClick={onClick} aria-label={label} className="flex min-h-8 w-full items-center rounded-lg border border-transparent px-2 py-1 text-left transition-colors hover:border-input hover:bg-accent/40 focus-visible:border-primary focus-visible:outline-none">
      {children}
    </button>
  );
}

// ── Dependencias ────────────────────────────────────────────────────────────

function DependenciesSection({
  task, byId, allTasks, today, canEdit, busy, onOpenTask, onChange, onAdd, addRef,
}: {
  task: TaskRow;
  byId: ReadonlyMap<string, TaskRow>;
  allTasks: TaskRow[];
  today: string;
  canEdit: boolean;
  busy: boolean;
  onOpenTask: (id: string) => void;
  onChange: (ids: string[]) => Promise<boolean>;
  onAdd: () => void;
  addRef: RefObject<HTMLButtonElement | null>;
}) {
  const blocks = allTasks.filter((t) => t.blocked_by.some((b) => b.task_id === task.id));
  const open = openBlockers(task, byId);
  return (
    <Section
      title="Dependencias"
      action={open > 0 ? <BlockedMark count={open} /> : undefined}
    >
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Bloqueada por</p>
        {task.blocked_by.length === 0 ? (
          <p className="text-sm text-muted-foreground">No depende de ninguna tarea.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {task.blocked_by.map((b) => {
              const blocker = byId.get(b.task_id);
              return (
                <li key={b.task_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                  {blocker ? (
                    <>
                      <button type="button" onClick={() => onOpenTask(blocker.id)} className={cn("min-w-0 flex-1 truncate text-left hover:underline", blocker.status === "completed" && "text-muted-foreground line-through")}>{blocker.title}</button>
                      <StatusChip status={blocker.status} />
                      <span className="shrink-0 text-xs text-muted-foreground">{dueLabel(blocker, today).text}</span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">Una tarea que no podés ver</span>
                  )}
                  {canEdit && (
                    <button type="button" disabled={busy} aria-label="Quitar este bloqueante" title="Quitar este bloqueante" onClick={() => void onChange(task.blocked_by.filter((x) => x.task_id !== b.task_id).map((x) => x.task_id))} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && (
          <button ref={addRef} type="button" onClick={onAdd} disabled={busy || task.blocked_by.length >= TASK_LIMITS.blockers} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar bloqueante
          </button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          <Lock className="mr-1 inline h-3 w-3" aria-hidden />
          Es informativo: podés completar esta tarea aunque estén sin completar.
        </p>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Bloquea a</p>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna tarea depende de esta.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {blocks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                <button type="button" onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 truncate text-left hover:underline">{t.title}</button>
                <StatusChip status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** Buscar una tarea para agregarla como bloqueante. Se ofrecen solo las que se pueden: sin ciclos ni repetidas. */
function BlockerPicker({
  anchor, task, allTasks, today, onPick, onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  task: TaskRow;
  allTasks: TaskRow[];
  today: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const blockedBy = useMemo(() => new Map(allTasks.map((t) => [t.id, t.blocked_by.map((b) => b.task_id)])), [allTasks]);
  const options = useMemo(() => {
    const q = foldText(query.trim());
    return allTasks
      .filter((t) => t.id !== task.id && !task.blocked_by.some((b) => b.task_id === t.id))
      .filter((t) => !wouldCreateCycle(blockedBy, task.id, [...task.blocked_by.map((b) => b.task_id), t.id]))
      .filter((t) => !q || foldText(t.title).includes(q))
      .slice(0, 30);
  }, [allTasks, blockedBy, query, task.blocked_by, task.id]);

  return (
    <FloatingPanel anchor={anchor} onClose={onClose} label="Elegir un bloqueante" width={340}>
      <div className="relative mb-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar una tarea" aria-label="Buscar una tarea" className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm outline-none focus:border-primary" />
      </div>
      <ul role="listbox" aria-label="Tareas">
        {options.map((t) => {
          const later = !!(t.due_date && task.due_date && t.due_date > task.due_date);
          return (
            <li key={t.id}>
              <button type="button" disabled={later} onClick={() => onPick(t.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{later ? "Vence después" : dueLabel(t, today).text}</span>
              </button>
            </li>
          );
        })}
        {options.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No hay tareas para agregar.</li>}
      </ul>
    </FloatingPanel>
  );
}
