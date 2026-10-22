"use client";

import { cn } from "@/lib/utils";
import {
  applyToEveryChannel,
  canGrantChannels,
  CHANNEL_SCOPE_LABELS,
  CHANNEL_SCOPES,
  grantFor,
  setAllChannels,
  setChannelGrant,
  toCustomChannels,
  type ChannelGrant,
  type ChannelScope,
  type ChannelsConfig,
} from "@/lib/auth/channel-permissions";
import { platformLabel } from "@/lib/platforms";
import type { GrantActor } from "@/lib/team/grant";

/** Una cuenta conectada, como la muestra la pantalla de roles. */
export interface RoleChannelAccount {
  id: string;
  platform: string;
  label: string;
  active: boolean;
}

type ScopeChoice = ChannelScope | "none";
const CHOICES: ScopeChoice[] = ["none", ...CHANNEL_SCOPES];

/**
 * La bandeja de un rol (00249): "todas las cuentas" (también las que se conecten después) o una fila por
 * cuenta conectada, cada una con qué conversaciones ve y si puede responder. Responder exige ver.
 *
 * No guarda nada: arma la configuración nueva y se la pasa a `onChange` (el editor la manda por su cola).
 * Lo que quien mira no puede dar aparece deshabilitado, con la misma regla que aplica el servidor.
 */
export function ChannelAccessSection({
  channels,
  accounts,
  viewer,
  before,
  readOnly,
  onChange,
}: {
  channels: ChannelsConfig;
  accounts: RoleChannelAccount[];
  viewer: GrantActor;
  /** Lo que el rol tiene guardado: solo hay que poder dar lo que se agrega sobre eso. */
  before: ChannelsConfig;
  readOnly: boolean;
  onChange: (next: ChannelsConfig) => void;
}) {
  const refs = accounts.map((a) => ({ id: a.id, platform: a.platform }));
  const isAdminLike = viewer.role === "owner" || viewer.role === "admin";
  const allowed = (next: ChannelsConfig) => isAdminLike || canGrantChannels(viewer.permissions.channels, next, before);

  const allGrant: ChannelGrant = channels.mode === "all" ? channels.all : { scope: "own", reply: true };

  function choose(next: ChannelsConfig) {
    if (readOnly || !allowed(next)) return;
    onChange(next);
  }

  function grantWith(current: ChannelGrant | null, scope: ScopeChoice, reply?: boolean): ChannelGrant | null {
    if (scope === "none") return null;
    return { scope, reply: reply ?? current?.reply ?? false };
  }

  // «Aplicar a todas»: con "responde" si quien mira lo puede dar; si no, sin.
  function everyChannel(scope: ScopeChoice): ChannelsConfig {
    const withReply = applyToEveryChannel(refs, grantWith(null, scope, true));
    return allowed(withReply) ? withReply : applyToEveryChannel(refs, grantWith(null, scope, false));
  }

  const modeAllOption = setAllChannels(allGrant);
  const modeCustomOption = toCustomChannels(channels, refs);

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Qué cuentas ve" className="grid gap-2 sm:grid-cols-2">
        <ModeOption
          checked={channels.mode === "all"}
          disabled={readOnly || (channels.mode !== "all" && !allowed(modeAllOption))}
          title="Todas las cuentas"
          hint="Incluye las que se conecten después."
          onSelect={() => choose(modeAllOption)}
        />
        <ModeOption
          checked={channels.mode === "custom"}
          disabled={readOnly}
          title="Elegir por cuenta"
          hint="Una cuenta nueva no se ve hasta que se la des."
          onSelect={() => choose(modeCustomOption)}
        />
      </div>

      {channels.mode === "all" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <ScopeSelect
            label="Qué conversaciones ve"
            value={channels.all.scope}
            readOnly={readOnly}
            includeNone={false}
            isAllowed={(scope) => allowed(setAllChannels({ scope: scope as ChannelScope, reply: channels.all.reply }))}
            onChange={(scope) => choose(setAllChannels({ scope: scope as ChannelScope, reply: channels.all.reply }))}
          />
          <ReplyCheckbox
            checked={channels.all.reply}
            disabled={readOnly || (!channels.all.reply && !allowed(setAllChannels({ ...channels.all, reply: true })))}
            onChange={(reply) => choose(setAllChannels({ ...channels.all, reply }))}
          />
        </div>
      ) : accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Todavía no hay cuentas conectadas. Cuando conectes una, la vas a poder dar desde acá.</p>
      ) : (
        <>
          {!readOnly && (
            <label className="block text-[11px] font-medium text-muted-foreground">
              Aplicar a todas las cuentas
              <select
                value=""
                onChange={(e) => {
                  const scope = e.target.value as ScopeChoice | "";
                  if (!scope) return;
                  choose(everyChannel(scope));
                }}
                className="ml-2 rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="">Elegí…</option>
                {CHOICES.map((c) => (
                  <option key={c} value={c} disabled={!allowed(everyChannel(c))}>
                    {CHANNEL_SCOPE_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-medium">Cuenta</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Qué conversaciones ve</th>
                  <th scope="col" className="py-1 font-medium">Responde</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const grant = grantFor(channels, account.id);
                  const replyOn = setChannelGrant(channels, refs, account.id, grant ? { ...grant, reply: true } : null);
                  return (
                    <tr key={account.id} className={cn("border-t border-border", !account.active && "opacity-60")}>
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                        <span className="font-medium">{account.label}</span>
                        <span className="ml-1 text-muted-foreground">· {platformLabel(account.platform)}</span>
                        {!account.active && <span className="ml-1 text-[10px] text-muted-foreground">(desconectada)</span>}
                      </th>
                      <td className="py-1.5 pr-2">
                        <ScopeSelect
                          label={`Qué conversaciones de ${account.label} ve`}
                          hideLabel
                          value={grant?.scope ?? "none"}
                          readOnly={readOnly}
                          includeNone
                          isAllowed={(scope) => allowed(setChannelGrant(channels, refs, account.id, grantWith(grant, scope)))}
                          onChange={(scope) => choose(setChannelGrant(channels, refs, account.id, grantWith(grant, scope)))}
                        />
                      </td>
                      <td className="py-1.5">
                        <ReplyCheckbox
                          hideLabel
                          label={`Responde por ${account.label}`}
                          checked={grant?.reply ?? false}
                          disabled={readOnly || !grant || (!grant.reply && !allowed(replyOn))}
                          onChange={(reply) => grant && choose(setChannelGrant(channels, refs, account.id, { ...grant, reply }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        «Asignadas» son las conversaciones a su cargo o de contactos donde es setter o vendedor. Ver una conversación deja ver la ficha de ese contacto.
      </p>
    </div>
  );
}

function ModeOption({
  checked,
  disabled,
  title,
  hint,
  onSelect,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <label
      title={disabled && !checked ? "No podés dar permisos que no tenés" : undefined}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs",
        checked ? "border-primary bg-primary/5" : "border-border",
        disabled && !checked && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" checked={checked} disabled={disabled && !checked} onChange={onSelect} className="mt-0.5" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function ScopeSelect({
  label,
  hideLabel,
  value,
  readOnly,
  includeNone,
  isAllowed,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  value: ScopeChoice;
  readOnly: boolean;
  includeNone: boolean;
  isAllowed: (scope: ScopeChoice) => boolean;
  onChange: (scope: ScopeChoice) => void;
}) {
  const options = includeNone ? CHOICES : CHANNEL_SCOPES;
  return (
    <label className="block text-xs font-medium">
      <span className={cn(hideLabel && "sr-only")}>{label}</span>
      <select
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value as ScopeChoice)}
        className={cn("block w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs disabled:opacity-60 sm:max-w-[14rem]", !hideLabel && "mt-1")}
      >
        {options.map((option) => (
          <option key={option} value={option} disabled={option !== value && !isAllowed(option)}>
            {CHANNEL_SCOPE_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReplyCheckbox({
  checked,
  disabled,
  label = "Puede responder",
  hideLabel,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label?: string;
  hideLabel?: boolean;
  onChange: (reply: boolean) => void;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-xs", disabled && "opacity-60")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn(hideLabel && "sr-only")}>{label}</span>
    </label>
  );
}
