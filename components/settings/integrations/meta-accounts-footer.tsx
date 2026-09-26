"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { refreshMetaAccounts, setMetaAccountSync } from "@/lib/actions/meta-accounts";
import type { AdAccount } from "@/lib/meta/accounts";

/**
 * Elegir que cuentas publicitarias se sincronizan (F40).
 *
 * Las cuentas se descubren con el token, no se escriben a mano. Cada una con
 * su casilla: lo tildado es lo que el cron trae todos los dias.
 *
 * Una cuenta que el token ya no alcanza sigue apareciendo, con su aviso: que
 * desaparezca sin decir nada es la peor forma de enterarse de que se perdio
 * un permiso.
 */
export function MetaAccountsFooter({
  accounts: initial,
  igUsername,
}: {
  accounts: AdAccount[];
  igUsername: string | null;
}) {
  const [accounts, setAccounts] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    const next = accounts.map((a) =>
      a.ad_account_id === id ? { ...a, sync_enabled: !a.sync_enabled } : a,
    );
    setAccounts(next);
    setError(null);
    start(async () => {
      const result = await setMetaAccountSync(
        next.filter((a) => a.sync_enabled).map((a) => a.ad_account_id),
      );
      if (!result.ok) {
        setError(result.error);
        setAccounts(accounts);
      }
    });
  };

  const refresh = () =>
    start(async () => {
      setError(null);
      const result = await refreshMetaAccounts();
      if (result.ok) setAccounts(result.data.accounts);
      else setError(result.error);
    });

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Cuentas publicitarias</p>
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          Buscar cuentas
        </button>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Lo tildado es lo que se sincroniza cada noche. Destildar una deja de traer sus datos; los que
        ya estan no se borran.
      </p>

      {igUsername && (
        <p className="mt-1 text-xs text-muted-foreground">
          Instagram: <span className="font-medium">@{igUsername}</span>
        </p>
      )}

      {accounts.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Todavia no buscamos las cuentas. Apretá &quot;Buscar cuentas&quot;.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {accounts.map((account) => (
            <li key={account.ad_account_id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={account.sync_enabled}
                  disabled={pending}
                  onChange={() => toggle(account.ad_account_id)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <span className="min-w-0">
                  <span className="block truncate">{account.name || account.ad_account_id}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {account.ad_account_id}
                    {account.currency ? ` · ${account.currency}` : ""}
                    {account.last_synced_at
                      ? ` · ultima vez ${new Date(account.last_synced_at).toLocaleDateString("es-AR")}`
                      : ""}
                  </span>
                  {account.last_error && (
                    <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                      {account.last_error}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
