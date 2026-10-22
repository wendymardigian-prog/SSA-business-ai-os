import { Bot, FileText, Sparkles } from "lucide-react";
import { AiProviderOptions } from "@/components/agents/no-ai-connection";

/**
 * El empty state de Agentes IA: el negocio todavia no conecto ninguna IA y
 * nunca la uso (lib/agent/page-mode.ts). Sin una IA no hay agente que
 * configurar ni tarea que pueda correr, asi que la pantalla entera es la
 * invitacion a conectar la primera (Anthropic, OpenAI o Google).
 *
 * Al conectarla, el agente de chat y el copywriter aparecen ya configurados
 * (lib/agent/defaults.ts) y las tareas, con sus instrucciones y su modelo.
 */

const WHAT_YOU_GET = [
  { icon: Bot, title: "Agente de chat", text: "Responde a tus leads por Instagram y WhatsApp. Viene apagado y con un prompt inicial para que lo revises." },
  { icon: FileText, title: "Copywriter de contenido", text: "Escribe guiones y captions de tus piezas con la voz de tu marca." },
  { icon: Sparkles, title: "Tareas de IA", text: "Resúmenes, clasificación de mensajes, análisis de llamadas y más, con sus instrucciones listas." },
] as const;

export function ConnectFirstAi({ canConnect }: { canConnect: boolean }) {
  return (
    <section aria-labelledby="connect-first-ai-title" className="mx-auto max-w-3xl rounded-xl border border-dashed border-border p-6 md:p-8">
      <div className="text-center">
        <Sparkles className="mx-auto h-9 w-9 text-muted-foreground/50" aria-hidden />
        <h2 id="connect-first-ai-title" className="mt-3 text-lg font-semibold">
          Conectá tu primera IA para empezar
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Los agentes y las tareas de IA usan el modelo de una IA. Conectá la tuya con tu propia cuenta (el consumo se factura a tu cuenta) y en esta pantalla vas a encontrar todo listo para usar.
        </p>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {WHAT_YOU_GET.map(({ icon: Icon, title, text }) => (
          <li key={title} className="rounded-lg bg-muted/40 p-3">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Elegí con cuál empezar</h3>
      <AiProviderOptions canConnect={canConnect} />
    </section>
  );
}
