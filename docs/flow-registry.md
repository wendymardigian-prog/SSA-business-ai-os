# Registro de nodos, triggers y condiciones

El motor de flows no sabe qué tipos de nodo existen. Le pregunta al registro y
ejecuta lo que le devuelve. Sumar un tipo nuevo es escribir un archivo y
registrarlo: `engine.ts` no se toca.

Esto existe para que las etapas siguientes (contenido, ventas, agendamiento,
tareas) puedan sumar lo suyo sin abrir el core.

## Por qué

Antes había un `switch` de dieciocho casos dentro del motor, otro en el
simulador, y cinco listas de tipos repartidas por la UI. Se desincronizaron sin
que nada avisara: el panel guardaba los once nodos de acción como
`type: "action"` con el tipo real en `data.actionType`, el motor no entendía esa
forma y los tiraba por el `default` del switch. Add Tag, Set Field, Human
Takeover y compañía pasaban el panel de Test y en producción no hacían nada.

## Dónde está

```
lib/flow-engine/registry/
├── types.ts       # los contratos (NodeDefinition, TriggerDefinition, ...)
├── registry.ts    # el registro y las funciones de consulta
├── nodes.ts       # alta de los tipos de nodo
├── triggers.ts    # alta de los tipos de trigger
├── conditions.ts  # alta de operadores y campos del nodo Condition
└── index.ts       # importar esto da de alta todo
```

Cada nodo vive en `lib/flow-engine/nodes/<nombre>.ts` y exporta su definición.

## Agregar un nodo

1. Creá `lib/flow-engine/nodes/mi-nodo.ts`:

```ts
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";

export const miNodo: NodeDefinition<MiNodoData> = {
  type: "miNodo",
  label: "Mi nodo",
  // Solo si el canvas lo guarda con otro `type` (los de acción lo hacen):
  aliases: [{ nodeType: "action", actionType: "miNodo" }],
  // Solo si escribe en context.variables y tienen que sobrevivir a una pausa:
  persistsVariables: true,
  async execute({ supabase, data, context, sessionId, runtime }) {
    // "pause" corta el recorrido, "handle:x" sigue por esa salida,
    // no devolver nada sigue por la única salida.
  },
};
```

2. Registralo en `registry/nodes.ts`.
3. Si va en el panel visual, sumalo a `components/flow-builder/node-palette.tsx`.
   El test de consistencia falla si el panel ofrece algo que el registro no
   conoce, así que no se puede olvidar.

**Nunca importes `engine.ts` desde un nodo.** Si necesitás arrancar otro flow,
usá `runtime.executeFlow` — está para eso, y evita el ciclo de imports.

## Agregar un trigger

En `registry/triggers.ts`:

```ts
registerTrigger({
  type: "mi_trigger",
  label: "Mi trigger",
  scope: "message",   // message | comment | event | scheduled
  priority: 50,       // mayor gana; la escala deja huecos a propósito
  matches: (args) => args.text.includes("algo"),
});
```

Si el tipo se guarda en la tabla `triggers`, hay que sumarlo también al CHECK de
`triggers.type` con una migración (el patrón está en `00016`, que hizo lo mismo
con `channels.platform`).

Los triggers de scope `event` o `scheduled` no usan `matches` —los dispara un
cron o un evento del CRM— pero se registran igual para que el editor los ofrezca
y para que la prioridad valga.

## Agregar una condición

En `registry/conditions.ts`. Un **operador** compara dos valores:

```ts
registerConditionOperator({
  operator: "starts_with",
  label: "empieza con",
  evaluate: (actual, expected) => actual?.startsWith(expected) ?? false,
});
```

Un **campo** dice de dónde sale el valor a comparar. Los que llevan `:` reciben
lo que viene después como `argument`:

```ts
registerConditionField({
  prefix: "secuencia:",
  label: "Está en la secuencia",
  resolve: async ({ supabase, argument, context }) => {
    // "secuencia:abc-123" llega acá con argument = "abc-123"
  },
});
```

Un campo sin resolver registrado se trata como campo personalizado del contacto,
que es el caso por defecto.

## Lo que viene en la Fase 3

`TriggerDefinition` tiene un campo `guard` opcional que hoy no usa nadie. Se
evalúa después del match y antes de disparar, y está puesto para las condiciones
de arranque del agente de IA: "ejecutar solo si el agente está apagado en esta
conversación", apoyado en `conversations.is_automation_paused`.

Del mismo modo, las acciones "pausar agente" y "reanudar agente" entran como dos
nodos más sobre esa misma columna. Nada de eso requiere tocar el motor ni
cambiar estos contratos.

## Etapa 4: los triggers y nodos de agenda

Nueve tipos de trigger (`lib/flow-engine/registry/booking-triggers.ts`) y tres
nodos (`send_email`, `cancel_booking`, `set_booking_status`). Tres cosas que
conviene saber antes de sumar algo:

- **El enrutado lo decide el registro.** Un trigger declara qué eventos de
  `automation_events` atiende (`eventTypes`), cómo se filtra (`eventMatches`) y
  cuál es su clave de idempotencia (`dedupeKeyFor`). El cron
  (`app/api/cron/automation-events`) ya no mapea a mano: sumar un tipo es
  declararlo y agregarlo al CHECK con una migración. Un tipo que nombra el
  evento le gana al comodín `crm_event`, que declara `"*"`.

- **Los triggers que no son de mensaje ahora SÍ se guardan.** Hasta la Etapa 4,
  `buildDesiredTriggers` descartaba todo lo que no fuera palabra clave o botón:
  `new_contact`, `crm_event`, `inactivity` y `email_received` se podían elegir
  en el canvas y al publicar no se escribía ninguna fila. Ahora la lista sale
  del registro (todo lo que tenga alcance `event` o `scheduled`).

- **Un flow puede correr sin canal.** `flow_sessions.channel_id` admite null
  desde la migración 00100. Un lead que agenda desde la página pública no tiene
  conversación: antes el insert de la sesión fallaba en silencio y el flujo no
  arrancaba. Los nodos que envían por un canal se saltean con motivo;
  `send_email` no lo necesita.
