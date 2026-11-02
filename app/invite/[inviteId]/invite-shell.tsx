/**
 * El fondo de la pagina de invitacion: un brillo suave del color del negocio
 * arriba, que se desvanece al fondo de la pantalla. Sigue a `--primary`, asi que
 * toma el color del negocio que invita (o el de la instalacion).
 */
export function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
      }}
    >
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
