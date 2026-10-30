"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { brandName } from "@/lib/brand";
import { requestPasswordReset } from "@/lib/actions/password-reset";

/**
 * "Olvidé mi contraseña": se pide el email y Supabase manda el link. La
 * respuesta es la misma exista o no la cuenta (no se revela quien esta
 * registrado).
 */
export default function RecoverPage() {
  return (
    <Suspense>
      <RecoverForm />
    </Suspense>
  );
}

function RecoverForm() {
  const expired = useSearchParams().get("vencido") === "1";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const result = await requestPasswordReset({ email });
    if (!result.ok) {
      setError(result.error);
      setState("idle");
      return;
    }
    setState("sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandMark size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{brandName()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Recuperá tu contraseña</p>
        </div>

        {state === "sent" ? (
          <div role="status" className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <p className="font-medium">Revisá tu email</p>
            <p className="text-muted-foreground">
              Si <strong className="text-foreground">{email.trim()}</strong> tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Puede
              tardar unos minutos; si no lo ves, mirá en spam.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {expired && (
              <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                Ese link venció o ya se usó. Pedí uno nuevo acá.
              </p>
            )}
            <p className="text-sm text-muted-foreground">Escribí el email con el que entrás y te mandamos un link para elegir una contraseña nueva.</p>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="tu@email.com"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={state === "sending"}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {state === "sending" ? "Enviando…" : "Mandarme el link"}
            </button>
          </form>
        )}

        <p className="text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
