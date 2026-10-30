import { createServiceClient } from "@/lib/supabase/server";
import { loadUnsubscribeTarget, publicView } from "@/lib/email/unsubscribe-public";
import { UnsubscribePanel } from "@/components/email/unsubscribe-panel";

/**
 * `/baja/<token>`: la pagina de baja de los emails (suscripcion a emails, E3).
 *
 * Abrirla NO da de baja (un previsualizador de links o un antivirus que la abre no
 * puede sacar a nadie): solo muestra la direccion enmascarada y el boton. La baja la
 * hace el boton, con el token como unica autorizacion. Un token que no sirve muestra
 * un mensaje generico, sin ningun dato.
 */
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = await createServiceClient();
  const target = await loadUnsubscribeTarget(service, token).catch(() => null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      {target ? (
        <UnsubscribePanel token={token} initial={publicView(target)} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Este link no es válido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Puede que esté incompleto o que sea viejo. Si querés dejar de recibir emails, usá el link del último email que te llegó.
          </p>
        </div>
      )}
    </main>
  );
}
