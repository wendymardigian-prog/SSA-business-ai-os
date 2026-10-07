"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Crown, Shield, User, Loader2 } from "lucide-react";
import { acceptInvite, registerFromInvite } from "@/lib/actions/team";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3.5 w-3.5" />,
  admin: <Shield className="h-3.5 w-3.5" />,
  member: <User className="h-3.5 w-3.5" />,
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function AcceptInviteView({
  inviteId,
  workspaceName,
  inviterName,
  role,
  email,
  isLoggedIn,
  currentUserEmail,
}: {
  inviteId: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  email: string;
  isLoggedIn: boolean;
  currentUserEmail: string | null;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const emailMismatch =
    isLoggedIn && currentUserEmail && currentUserEmail !== email;

  async function handleAccept() {
    if (accepting) return;
    setAccepting(true);
    setError(null);

    const result = await acceptInvite(inviteId);

    if (result.error) {
      setError(result.error);
      setAccepting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (accepting) return;
    setAccepting(true);
    setError(null);

    const result = await registerFromInvite(inviteId, name, password);

    if (result.error) {
      setError(result.error);
      setAccepting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandMark size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">¡Te invitaron!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {inviterName} te invitó a sumarte a
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-3 text-lg font-semibold">{workspaceName}</h2>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {roleIcons[role] ?? roleIcons.member}
              {roleLabels[role] ?? role}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Invitación para {email}
          </p>
        </div>

        {isLoggedIn && !emailMismatch && (
          <div className="space-y-3">
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {accepting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Aceptando…
                </>
              ) : (
                "Aceptar invitación"
              )}
            </button>

            {error && <p className="text-center text-sm text-destructive">{error}</p>}
          </div>
        )}

        {isLoggedIn && emailMismatch && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm text-amber-800">
              Estás logueado como <span className="font-medium">{currentUserEmail}</span>, pero esta
              invitación se mandó a <span className="font-medium">{email}</span>.
            </p>
            <p className="mt-1 text-xs text-amber-600">
              Iniciá sesión con el email invitado para aceptarla.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
            >
              Cambiar de cuenta
            </Link>
          </div>
        )}

        {!isLoggedIn && (
          <div className="space-y-4">
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-1.5">
                  Tu nombre
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Tu nombre"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-1.5">
                  Elegí una contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={accepting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {accepting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creando cuenta…
                  </>
                ) : (
                  "Crear cuenta y aceptar"
                )}
              </button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              ¿Ya tenés cuenta?{" "}
              <Link
                href={`/login?next=/invite/${inviteId}`}
                className="font-medium text-foreground hover:underline"
              >
                Iniciar sesión
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
