"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { brandName } from "@/lib/brand";
import { setNewPassword } from "@/lib/actions/password-reset";
import { PASSWORD_MIN, parseNewPassword } from "@/lib/account/validation";
import { RESET_REQUEST_PATH } from "@/lib/account/password-reset";

/**
 * La contraseña nueva, despues de abrir el link del email. El link deja una
 * sesion de recuperacion (lo resuelven /auth/confirm o /auth/callback): sin
 * ella, el servidor responde que el link vencio.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseNewPassword(next, confirm);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await setNewPassword({ next, confirm });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setExpired(Boolean(result.expired));
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1200);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandMark size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{brandName()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Elegí tu contraseña nueva</p>
        </div>

        {done ? (
          <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
            Listo, ya cambiaste tu contraseña. Te llevamos al panel…
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">
                Contraseña nueva
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">Al menos {PASSWORD_MIN} caracteres.</p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium">
                Repetila
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}{" "}
                {expired && (
                  <Link href={RESET_REQUEST_PATH} className="font-medium underline underline-offset-2">
                    Pedir otro link
                  </Link>
                )}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
