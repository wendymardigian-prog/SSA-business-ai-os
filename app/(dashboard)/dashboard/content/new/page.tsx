import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/page-header";
import { NewContentForm } from "@/components/content/new-content-form";

/**
 * Crear una idea o una pieza.
 *
 * Una sola pantalla para las dos cosas, elegido por `?tipo=idea`: los campos
 * se parecen mucho y son cuatro. Dos pantallas casi iguales envejecen peor.
 */
export default async function NewContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { tipo } = await searchParams;
  const { workspace, supabase } = await getWorkspace();

  // Las ideas sin decidir, para poder vincular la pieza a la que la origino.
  const { data: ideas } = await supabase
    .from("content_ideas")
    .select("id, title")
    .eq("workspace_id", workspace.id)
    .eq("status", "nueva")
    .order("position");

  // Solo se ofrecen las redes que el workspace tiene conectadas: elegir una
  // red que no existe termina en una pieza que no se puede publicar.
  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("platform")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/content/new"
        title={tipo === "idea" ? "Nueva idea" : "Nueva pieza"}
        backHref={
          <Link
            href="/dashboard/content"
            aria-label="Volver a Contenido"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <NewContentForm
          kind={tipo === "idea" ? "idea" : "post"}
          ideas={ideas ?? []}
          platforms={(accounts ?? []).map((a) => a.platform)}
        />
      </div>
    </div>
  );
}
