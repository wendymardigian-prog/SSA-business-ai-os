"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  MessageSquare,
  HelpCircle,
  UserPlus,
  GitBranch,
  Loader2,
  BookmarkPlus,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";

// --- Template types ---

interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

// --- Built-in templates ---

const templates: FlowTemplate[] = [
  {
    id: "welcome-flow",
    name: "Bienvenida",
    description:
      "Saluda a quien escribe por primera vez, espera un minuto y le manda un segundo mensaje para seguir la conversación.",
    category: "Bienvenida",
    icon: MessageSquare,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-100",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: {
          label: "Primer mensaje",
          triggerType: "welcome",
          config: {},
        },
      },
      {
        id: "msg-1",
        type: "sendMessage",
        position: { x: 250, y: 150 },
        data: {
          label: "Saludo",
          messages: [
            {
              text: "¡Hola! Gracias por escribirnos. Somos una agencia de marketing digital y nos encanta ayudar a negocios a conseguir más clientes. ¿En qué te podemos ayudar?",
            },
          ],
        },
      },
      {
        id: "delay-1",
        type: "delay",
        position: { x: 250, y: 300 },
        data: {
          label: "Esperar 1 minuto",
          duration: 1,
          unit: "minutes",
        },
      },
      {
        id: "msg-2",
        type: "sendMessage",
        position: { x: 250, y: 450 },
        data: {
          label: "Seguimiento",
          messages: [
            {
              text: "Por cierto, contanos un poco de tu negocio: ¿qué vendés y qué te gustaría mejorar? Así te recomendamos lo que más te sirve.",
            },
          ],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "delay-1" },
      { id: "e3", source: "delay-1", target: "msg-2" },
    ],
  },
  {
    id: "faq-bot",
    name: "Preguntas frecuentes",
    description:
      "Cuando alguien escribe «precio» o «info», mira el mensaje y le manda la respuesta que corresponde a cada caso.",
    category: "Atención",
    icon: HelpCircle,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-100",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: {
          label: "Palabra clave",
          triggerType: "keyword",
          keywords: [
            { value: "precio", matchType: "contains" },
            { value: "info", matchType: "contains" },
          ],
          config: {},
        },
      },
      {
        id: "condition-1",
        type: "condition",
        position: { x: 250, y: 150 },
        data: {
          label: "¿Pregunta por el precio?",
          conditions: [
            {
              id: "c1",
              field: "variable:message",
              operator: "contains",
              value: "precio",
            },
          ],
        },
      },
      {
        id: "msg-help",
        type: "sendMessage",
        position: { x: 50, y: 350 },
        data: {
          label: "Respuesta sobre precios",
          messages: [
            {
              text: "¡Buenísimo que preguntes! El precio depende de lo que necesite tu negocio:\n- Gestión de redes sociales\n- Campañas de anuncios\n- Automatizaciones y CRM\n\nContanos cuál te interesa y te pasamos una propuesta a medida.",
            },
          ],
        },
      },
      {
        id: "msg-faq",
        type: "sendMessage",
        position: { x: 450, y: 350 },
        data: {
          label: "Respuesta con información",
          messages: [
            {
              text: "Estas son las preguntas que más nos hacen:\n\n1. ¿Cómo empezamos a trabajar juntos?\n2. ¿Qué servicios ofrecen?\n3. ¿Cuánto tarda en verse un resultado?\n\nRespondé con el número y te contamos más.",
            },
          ],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "condition-1" },
      {
        id: "e2",
        source: "condition-1",
        target: "msg-help",
        sourceHandle: "true",
      },
      {
        id: "e3",
        source: "condition-1",
        target: "msg-faq",
        sourceHandle: "false",
      },
    ],
  },
  {
    id: "lead-capture",
    name: "Captación de leads",
    description:
      "Pide los datos del lead paso a paso: el nombre, espera la respuesta y la guarda; después el email, y le pone la etiqueta «lead».",
    category: "Captación",
    icon: UserPlus,
    iconColor: "text-green-600",
    iconBg: "bg-green-100",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: {
          label: "Palabra clave",
          triggerType: "keyword",
          keywords: [
            { value: "me interesa", matchType: "contains" },
            { value: "quiero info", matchType: "contains" },
            { value: "cotización", matchType: "contains" },
          ],
          config: {},
        },
      },
      {
        id: "msg-name",
        type: "sendMessage",
        position: { x: 250, y: 120 },
        data: {
          label: "Pedir el nombre",
          messages: [{ text: "¡Genial, te ayudamos! ¿Cómo te llamás?" }],
        },
      },
      {
        id: "wait-name",
        type: "smartDelay",
        position: { x: 250, y: 240 },
        data: {
          label: "Esperar el nombre",
          waitForInput: true,
          timeout: 300,
        },
      },
      {
        id: "set-name",
        type: "setCustomField",
        position: { x: 250, y: 360 },
        data: {
          label: "Guardar el nombre",
          fieldSlug: "name",
          value: "{{message}}",
        },
      },
      {
        id: "msg-email",
        type: "sendMessage",
        position: { x: 250, y: 480 },
        data: {
          label: "Pedir el email",
          messages: [{ text: "¡Gracias, {{message}}! ¿A qué email te mandamos toda la información?" }],
        },
      },
      {
        id: "wait-email",
        type: "smartDelay",
        position: { x: 250, y: 600 },
        data: {
          label: "Esperar el email",
          waitForInput: true,
          timeout: 300,
        },
      },
      {
        id: "set-email",
        type: "setCustomField",
        position: { x: 250, y: 720 },
        data: {
          label: "Guardar el email",
          fieldSlug: "email",
          value: "{{message}}",
        },
      },
      {
        id: "tag-lead",
        type: "addTag",
        position: { x: 250, y: 840 },
        data: {
          label: "Agregar la etiqueta «lead»",
          tagName: "lead",
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "msg-name" },
      { id: "e2", source: "msg-name", target: "wait-name" },
      { id: "e3", source: "wait-name", target: "set-name" },
      { id: "e4", source: "set-name", target: "msg-email" },
      { id: "e5", source: "msg-email", target: "wait-email" },
      { id: "e6", source: "wait-email", target: "set-email" },
      { id: "e7", source: "set-email", target: "tag-lead" },
    ],
  },
];

// --- Component ---

export function TemplatesView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function handleUseTemplate(template: FlowTemplate) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setCreating(template.id);

    try {
      const res = await fetch("/api/v1/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          categories: [template.category],
          nodes: template.nodes,
          edges: template.edges,
        }),
      });

      if (!res.ok) {
        throw new Error("No se pudo crear la automatización");
      }

      const flow = await res.json();
      router.push(`/dashboard/flows/${flow.id}`);
    } catch (err) {
      console.error("No se pudo crear la automatización desde la plantilla:", err);
      pendingRef.current = false;
      setCreating(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/flows/templates"
        backHref={
          <Link
            href="/dashboard/flows"
            aria-label="Volver a Automatizaciones"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        right={
          <button
            disabled
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm font-medium text-muted-foreground opacity-60"
            title="Próximamente"
          >
            <BookmarkPlus className="h-4 w-4" />
            <span className="hidden lg:inline">Guardar la automatización actual como plantilla</span>
          </button>
        }
      />

      {/* Template gallery */}
      <div className="flex-1 overflow-auto p-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isCreating = creating === template.id;
            const Icon = template.icon;
            const nodeCount = template.nodes.length;

            return (
              <div
                key={template.id}
                className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
              >
                {/* Icon + category */}
                <div className="flex items-start justify-between">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      template.iconBg
                    )}
                  >
                    <Icon className={cn("h-5 w-5", template.iconColor)} />
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {template.category}
                  </span>
                </div>

                {/* Name + description */}
                <h3 className="mt-4 text-sm font-semibold group-hover:text-primary transition-colors">
                  {template.name}
                </h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {template.description}
                </p>

                {/* Node count */}
                <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  <span>
                    {nodeCount} {nodeCount === 1 ? "paso" : "pasos"}
                  </span>
                </div>

                {/* Use template button */}
                <button
                  onClick={() => handleUseTemplate(template)}
                  disabled={!!creating}
                  className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isCreating ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Creando…
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5" />
                      Usar plantilla
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
