"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { patchRole, type RolePatch } from "@/lib/actions/roles";
import {
  PERMISSION_MODULES,
  MODULE_LABELS,
  scopeOptionsFor,
  SCOPED_MODULES,
  visiblePermissionsOfModule,
  type PermissionScope,
  type ScopedModule,
} from "@/lib/auth/permissions";
import { applyKeyToggle, eodSelectorValue, moduleState, scopeFieldState, SCOPE_GROUP, toggleModule, type RoleRow } from "@/lib/auth/roles-admin";
import { createSaveQueue } from "@/lib/roles/save-queue";
import { assertCanGrant, type GrantActor } from "@/lib/team/grant";

const NAME_DEBOUNCE_MS = 700;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * El editor de un rol, con guardado automático (Equipo y roles, F13).
 *
 * Cada tilde o selector se guarda al instante, por una cola serial (`lib/roles/save-queue.ts`): dos
 * cambios seguidos llegan en orden y no se pisan. El nombre y la descripción se guardan a los 700 ms
 * sin escribir y al salir del campo. Si un guardado falla, ese control vuelve a su valor anterior y
 * aparece «Reintentar». No se recarga la página: cada respuesta trae el rol resultante.
 *
 * Con `readOnly` es la misma grilla sin controles activos (roles de sistema y quien solo ve).
 */
export function RoleEditor({
  role,
  viewer,
  readOnly,
  onRoleChange,
}: {
  role: RoleRow;
  viewer: GrantActor;
  readOnly: boolean;
  /** El servidor devolvió el rol resultante: la tarjeta se actualiza en el lugar. */
  onRoleChange: (role: RoleRow) => void;
}) {
  const [keys, setKeys] = useState(role.permissions.keys);
  const [scopes, setScopes] = useState(role.permissions.scopes);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [errors, setErrors] = useState<{ name?: string; description?: string; general?: string }>({});
  const [notices, setNotices] = useState<string[]>([]);
  const queue = useRef(createSaveQueue((pending) => setState((s) => (pending > 0 ? "saving" : s === "saving" ? "saved" : s)))).current;
  const lastFailed = useRef<(() => void) | null>(null);
  const timers = useRef<{ name?: ReturnType<typeof setTimeout>; description?: ReturnType<typeof setTimeout> }>({});
  const latest = useRef({ keys, scopes });
  // Lo ultimo que se ve en pantalla, para que los handlers lean el valor vigente (no el de su cierre).
  useEffect(() => {
    latest.current = { keys, scopes };
  }, [keys, scopes]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      clearTimeout(t.name);
      clearTimeout(t.description);
    };
  }, []);

  /** Manda un cambio por la cola. Si falla, `revert` deja el control como estaba. */
  function save(patch: RolePatch, revert: () => void, retry: () => void) {
    setErrors((e) => ({ ...e, general: undefined }));
    queue
      .enqueue(() => patchRole(role.id, patch))
      .then((result) => {
        if (result.ok) {
          setNotices(result.data.warnings);
          // Solo la ultima respuesta pisa lo que se ve: si hay mas cambios en cola, ellos traen lo suyo.
          if (queue.pending() <= 1) {
            setKeys(result.data.role.permissions.keys);
            setScopes(result.data.role.permissions.scopes);
          }
          onRoleChange(result.data.role);
          lastFailed.current = null;
          setState("saved");
        } else {
          revert();
          lastFailed.current = retry;
          if (result.field === "name" || result.field === "description") setErrors((e) => ({ ...e, [result.field as string]: result.error }));
          else setErrors((e) => ({ ...e, general: result.error }));
          setState("error");
        }
      })
      .catch(() => {
        revert();
        lastFailed.current = retry;
        setErrors((e) => ({ ...e, general: "No se pudo guardar. Revisá tu conexión." }));
        setState("error");
      });
  }

  function toggleKey(key: string, on: boolean) {
    if (readOnly) return;
    const before = latest.current.keys;
    const next = applyKeyToggle(before, key, on);
    setKeys(next.keys);
    const patch: RolePatch = on ? { addKeys: [key] } : { removeKeys: [key] };
    save(patch, () => setKeys(before), () => toggleKey(key, on));
  }

  function toggleGroup(moduleKeys: string[], enable: boolean) {
    if (readOnly) return;
    const before = latest.current.keys;
    const grantable = moduleKeys.filter((k) => canGive(k));
    const nextKeys = toggleModule(before, grantable, enable);
    setKeys(nextKeys);
    const added = nextKeys.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !nextKeys.includes(k));
    if (added.length === 0 && removed.length === 0) return;
    save({ addKeys: added, removeKeys: removed }, () => setKeys(before), () => toggleGroup(moduleKeys, enable));
  }

  function setScope(scoped: ScopedModule, value: PermissionScope) {
    if (readOnly) return;
    const before = latest.current.scopes[scoped];
    setScopes((s) => ({ ...s, [scoped]: value }));
    save({ scopes: { [scoped]: value } }, () => setScopes((s) => ({ ...s, [scoped]: before })), () => setScope(scoped, value));
  }

  function saveText(field: "name" | "description", value: string) {
    if (readOnly) return;
    clearTimeout(timers.current[field]);
    setErrors((e) => ({ ...e, [field]: undefined }));
    const original = field === "name" ? role.name : (role.description ?? "");
    if (value === original) return;
    // Un nombre vacio no se manda: se marca el campo y listo.
    if (field === "name" && value.trim().length < 2) {
      setErrors((e) => ({ ...e, name: "El nombre tiene que tener al menos 2 caracteres." }));
      return;
    }
    save(
      field === "name" ? { name: value } : { description: value },
      () => undefined,
      () => saveText(field, value),
    );
  }

  function scheduleText(field: "name" | "description", value: string) {
    clearTimeout(timers.current[field]);
    timers.current[field] = setTimeout(() => saveText(field, value), NAME_DEBOUNCE_MS);
  }

  /** Si quien mira puede dar esta clave (Owner y Admin, todas menos las solo-Owner; el resto, las que tiene). */
  function canGive(key: string) {
    return assertCanGrant(viewer, { keys: [key] }).ok;
  }
  function canGiveScope(scoped: ScopedModule, value: PermissionScope) {
    return assertCanGrant(viewer, { keys: [], scopes: { [scoped]: value } }).ok;
  }

  const groups = useMemo(
    () =>
      PERMISSION_MODULES.map((group) => ({ group, perms: visiblePermissionsOfModule(group) })).filter((g) => g.perms.length > 0),
    [],
  );

  return (
    <div className="space-y-5 border-t border-border bg-muted/20 p-4 sm:p-5">
      {/* Nombre y descripción; el indicador de guardado a la derecha */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium">
            Nombre
            <input
              value={name}
              disabled={readOnly}
              maxLength={40}
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => {
                setName(e.target.value);
                scheduleText("name", e.target.value);
              }}
              onBlur={(e) => saveText("name", e.target.value)}
              className={cn("mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-70", errors.name ? "border-destructive" : "border-input")}
            />
            {errors.name && <span role="alert" className="mt-1 block text-[11px] text-destructive">{errors.name}</span>}
          </label>
          <label className="block text-xs font-medium">
            Descripción
            <input
              value={description}
              disabled={readOnly}
              maxLength={200}
              aria-invalid={Boolean(errors.description)}
              onChange={(e) => {
                setDescription(e.target.value);
                scheduleText("description", e.target.value);
              }}
              onBlur={(e) => saveText("description", e.target.value)}
              className={cn("mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-70", errors.description ? "border-destructive" : "border-input")}
            />
            {errors.description && <span role="alert" className="mt-1 block text-[11px] text-destructive">{errors.description}</span>}
          </label>
        </div>
        {!readOnly && (
          <div className="min-h-[1.5rem] shrink-0 text-xs sm:pt-7" aria-live="polite">
            {state === "saving" && (
              <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Guardando…</span>
            )}
            {state === "saved" && (
              <span className="inline-flex items-center gap-1 text-green-700"><Check className="h-3.5 w-3.5" aria-hidden /> Guardado</span>
            )}
            {state === "error" && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> No se pudo guardar ·{" "}
                <button type="button" onClick={() => lastFailed.current?.()} className="font-medium underline underline-offset-2">Reintentar</button>
              </span>
            )}
          </div>
        )}
      </div>

      {role.members > 0 && !readOnly && (
        <p className="text-xs text-muted-foreground">
          Los cambios aplican ya a {role.members} {role.members === 1 ? "persona" : "personas"}.
        </p>
      )}
      {readOnly && (
        <p className="text-xs text-muted-foreground">
          {role.systemRole
            ? "Los roles de sistema no se editan. Si necesitás algo parecido, duplicalo y cambiá lo que haga falta."
            : "Solo podés ver los permisos de este rol."}
        </p>
      )}
      {errors.general && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{errors.general}</p>}
      {notices.map((n) => (
        <p key={n} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs">{n}</p>
      ))}

      {/* Permisos por grupo; en los grupos con alcance, la primera fila es el selector */}
      <div className="space-y-3">
        {groups.map(({ group, perms }) => {
          const moduleKeys = perms.map((p) => p.key);
          const toggleable = moduleKeys.filter((k) => k !== "eod.view_all");
          const stateOfGroup = moduleState(keys, toggleable);
          const scopeModules = SCOPED_MODULES.filter((m) => SCOPE_GROUP[m] === group);
          return (
            <fieldset key={group} className="rounded-lg border border-border bg-card p-3">
              <legend className="px-1 text-xs font-semibold">{MODULE_LABELS[group]}</legend>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => toggleGroup(toggleable, stateOfGroup !== "all")}
                  className="float-right text-[11px] font-medium text-primary underline underline-offset-2"
                >
                  {stateOfGroup === "all" ? "Ninguno" : "Todos"}
                </button>
              )}

              {scopeModules.map((m) => {
                const field = scopeFieldState(m, keys);
                return (
                  <label key={m} className="mb-2 block text-xs font-medium">
                    {field.label}
                    <select
                      value={scopes[m]}
                      disabled={readOnly || !field.enabled}
                      onChange={(e) => setScope(m, e.target.value as PermissionScope)}
                      className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60 sm:max-w-sm"
                    >
                      {scopeOptionsFor(m).map((value) => (
                        <option key={value} value={value} disabled={!canGiveScope(m, value) && value !== scopes[m]}>
                          {field.options.find((o) => o.value === value)?.label}
                        </option>
                      ))}
                    </select>
                    {!field.enabled && field.hint && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{field.hint}</span>}
                  </label>
                );
              })}

              {group === "forms" && (
                <p className="mb-2 text-[11px] text-muted-foreground">Las respuestas siguen el alcance de Contactos.</p>
              )}

              <div className="grid gap-1.5 sm:grid-cols-2">
                {perms.map((perm) => {
                  if (perm.key === "eod.view_all") {
                    return (
                      <label key={perm.key} className="col-span-full block text-xs font-medium">
                        Qué reportes de fin de día ve
                        <select
                          value={eodSelectorValue(keys)}
                          disabled={readOnly || !canGive("eod.view_all")}
                          onChange={(e) => toggleKey("eod.view_all", e.target.value === "all")}
                          className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60 sm:max-w-sm"
                        >
                          <option value="own">Solo los suyos</option>
                          <option value="all">Todos los del equipo</option>
                        </select>
                      </label>
                    );
                  }
                  const checked = keys.includes(perm.key);
                  const blocked = !readOnly && !checked && !canGive(perm.key);
                  const ownerOnly = perm.ownerOnly === true;
                  return (
                    <label
                      key={perm.key}
                      title={blocked ? (ownerOnly ? "Solo el Owner" : "No podés dar permisos que no tenés") : perm.description || undefined}
                      className={cn("flex items-start gap-2 text-xs", (blocked || readOnly) && "opacity-70")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly || blocked || (ownerOnly && !readOnly)}
                        onChange={(e) => toggleKey(perm.key, e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        {perm.label}
                        {ownerOnly && <span className="ml-1 text-[10px] text-muted-foreground">(solo el Owner)</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
