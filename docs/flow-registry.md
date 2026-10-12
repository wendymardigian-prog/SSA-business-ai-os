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

## Llamadas: los triggers `call_analyzed` y `call_linked`

Dos tipos de trigger (`lib/flow-engine/registry/call-triggers.ts`), tres campos
de condición (`call-conditions.ts`) y las variables `{{call.*}}`. Las reglas
puras viven en `lib/calls/automation/triggers.ts`; el registro solo declara.

| Trigger | Cuándo | Filtros (`triggers.config`) |
|---|---|---|
| `call_analyzed` | Una llamada **con contacto** queda analizada (análisis nuevo o regenerado; una corrección a mano NO lo dispara) | `call_types[]`, `outcomes[]`, `closer_ids[]`, `closer_score_min/max`, `lead_score_min/max`, `qualifications[]` |
| `call_linked` | Se vincula un contacto a una llamada (automático, importada con contacto o a mano) | `call_types[]`, `closer_ids[]` |

- **Vacío significa "cualquiera"**, nunca "ninguno". Con un límite de puntaje, una
  llamada sin puntaje no entra (no se adivina).
- **El evento** va a `automation_events` con `contact_id` y el payload
  `{ call_id, call_type, outcome, closer_score, lead_score, lead_qualification,
  closer_id, booking_id, analysis_run_id }` (`lib/calls/automation/emit.ts`).
  Emitir NUNCA lanza. **Una llamada sin contacto no emite nada**: cuando después
  se vincula, emite `call_linked`.
- **Idempotencia** (`dedupeKeyFor`, `trigger_fires`): `call:<callId>:<tipo>:<corrida
  o contacto>`. Un análisis regenerado tiene otra corrida y vuelve a disparar; el
  mismo evento procesado dos veces dispara una vez.
- **Condiciones** (todas sobre la última llamada ANALIZADA del contacto; sin
  ninguna devuelven vacío): `last_call_outcome:`, `last_call_lead_score:`,
  `last_call_type:`. Están en el catálogo de la UI (`condition-fields.ts`).
- **Variables** (`lib/calls/automation/context.ts`, todas texto; lo que falta
  queda vacío): `{{call.title}}`, `{{call.date}}`, `{{call.outcome}}`,
  `{{call.next_step}}`, `{{call.closer_name}}`, `{{call.closer_score}}`,
  `{{call.lead_score}}`.
- En el editor (`TriggerPanel`) se configuran tipos, resultados, calificación y
  rangos de puntaje. El filtro por closer (`closer_ids`) existe en el motor pero
  todavía no tiene selector en el panel.
- **Dónde se emite**: `call_analyzed` al terminar `runCallAnalysisJob`;
  `call_linked` en la ingesta (`onLinked`), al importar con contacto y al
  vincular a mano.

## Formularios: los triggers `form_submitted`, `survey_answered` y `contract_signed`

Tres tipos de trigger (`lib/flow-engine/registry/form-triggers.ts`), `scope: "event"`,
prioridad 45. Las reglas puras viven en `lib/forms/automation/triggers.ts` y la
validación de la configuración en `lib/forms/automation/trigger-config.ts`; el
registro solo declara.

| Trigger | Cuándo | Filtros (`triggers.config`) |
|---|---|---|
| `form_submitted` | Se envía un formulario **personalizado** y la respuesta tiene contacto | `form_ids[]`, `answer_conditions` |
| `survey_answered` | Se responde una **encuesta** y la respuesta tiene contacto | `form_ids[]`, `score {operator: lte\|gte\|eq, value}`, `nps_categories[]`, `survey_categories[]`, `answer_conditions` |
| `contract_signed` | Se firma un **contrato** (cuando la firma quedó guardada; no espera al PDF) | `form_ids[]` |

- **Un solo evento por respuesta**, según el tipo del formulario: así un mismo envío
  no dispara dos flujos. Los emite `submit_form_response` (00156; el de contrato lo
  emite la 00157 al registrar la firma).
- **Vacío significa "cualquiera"**, nunca "ninguno". **Una configuración rota no
  dispara para nadie** (al revés que un vacío): es más seguro que mandar a todos.
- **El evento** va a `automation_events` con `contact_id` y un payload de **solo
  escalares**: `{ submission_id, form_id, form_type, score?, nps_category? }`. Nunca
  lleva `booking_id` (el cron trata como "reserva" cualquier payload con `booking_id`
  y se saltearía la marca "no contactar") ni las respuestas: el trigger las lee de
  `form_submissions` para filtrar y para armar las variables.
- **Una respuesta sin contacto no emite nada** (`automation_events.contact_id` es
  obligatorio). Si después se vincula a mano desde su detalle, la casilla "Disparar
  ahora las automatizaciones" emite el mismo evento; tildarla dos veces dispara una
  sola vez porque la clave de idempotencia es la misma.
- **Idempotencia** (`dedupeKeyFor`, `trigger_fires`): `form:<tipo>:<respuesta>`.
- **Variables** (`lib/forms/automation/variables.ts`, todo texto; lo que falta queda
  vacío): `{{form.name}}`, `{{form.url}}`, `{{form.type}}`, `{{form.slug}}`,
  `{{form.category}}`, `{{answer.<clave>}}` (las múltiples, unidas por `, `; las claves
  con guion pasan a guion bajo; un archivo sale como su nombre), `{{submission.url}}`
  (pide sesión: sirve para avisos al equipo, no para el contacto), `{{submission.id}}`,
  `{{submission.created_at}}`, `{{submission.score}}`, `{{submission.nps_category}}`,
  `{{submission.contact_created}}`.
- **`{{form_link.<slug_con_guion_bajo>}}`** en cualquier email o mensaje: el link
  firmado para el contacto del flujo, con `service.id` y `sale.id` si el flujo los
  trae. Se resuelve en un segundo pase dentro de `resolveBankVariables` y **solo si el
  texto trae el token** (`lib/response-assets/bank-variables.ts`); si el formulario no
  existe o no está publicado, el token queda tal cual.
- En el editor (`TriggerPanel` → `FormTriggerPanel`) se eligen los formularios, el
  puntaje y las condiciones. Con varios formularios, las condiciones ofrecen solo los
  campos que tienen la misma clave y el mismo tipo en todos.
- Los flujos creados desde la pestaña **Automatizaciones** de un formulario llevan
  `flows.form_id` (00155) y se editan en el editor lineal compartido
  (`components/automations/linear-flow-editor.tsx`, que usa también la Agenda).

## Ventas (seis triggers, once atajos, tres nodos)

Declarados en `lib/flow-engine/registry/sales-triggers.ts`, `sales-conditions.ts` y `lib/flow-engine/nodes/sales-actions.ts`; la lógica pura de cada filtro vive en `lib/sales/automation/`. Detalle del módulo en [ventas.md](ventas.md); migración del CHECK de `triggers.type`: **00166**.

| Tipo | Cuándo | Evento |
|---|---|---|
| `sale_created` | Se crea una venta | `sale_created` |
| `sale_status_changed` | Cambia el estado de la venta (y al nacer, sin `from_status`) | `sale_status_changed` |
| `payment_created` | Se crea un pago (programado, cobrado o reembolso) | `payment_created` |
| `payment_status_changed` | Cambia el estado de un pago (y al nacer cobrado) | `payment_status_changed` |
| `payment_before_due` | Relativo: X días **antes** del vencimiento | agendado |
| `payment_after_due` | Relativo: X días **después**, si sigue impago | agendado |

- **Los atajos** («Venta cancelada», «Venta saldada», «Pago cobrado», «Pago vencido», «Reembolso registrado») **no son tipos**: son presets del editor (`lib/sales/automation/presets.ts`) que llenan el tipo y el filtro. `consistency.test` exige que el array de tipos de `TriggerPanel` sea igual al registro, por eso los atajos van en una lista aparte.
- **Vacío significa «cualquiera»; una configuración rota no dispara para nadie.** Los filtros leen el **payload del evento** (solo escalares), nunca la venta de hoy.
- **Un cambio dispara una vez por flow**: `eventMatches` incluye `pickCanonicalTrigger`, que entre los triggers activos del mismo flow que coinciden con el mismo `change_id` elige uno por `(prioridad, trigger.id, event.id)`. Los relativos quedan fuera (se agendan, no vienen de un evento).
- **Relativos**: se agendan como `scheduled_jobs` `payment_relative_trigger`, con clave `rel:<trigger>:<pago>:<reprogramaciones>`; un duplicado (23505) se tolera. Mover un vencimiento cambia la clave y vuelve a habilitar el recordatorio.
- **Variables** (`lib/sales/automation/variables.ts`): `{{sale.*}}` y `{{payment.*}}`; `{{form_link.*}}` ya firma el link con la venta del flow.
- **Condiciones** de flow (`sales-conditions.ts`) sobre la venta y el pago del evento; el constructor es `components/conditions/condition-tree-editor.tsx`.
- **Nodos de acción**: cobrar un pago, reprogramarlo y cambiar el estado de la venta, todos por `lib/sales/payments-core.ts` con actor de sistema (la auditoría lleva el nombre del flow). Están en `node-palette.tsx` y en el simulador.
- Los eventos de venta **llevan solo escalares y nunca `booking_id`** (el cron trata como «reserva» cualquier payload con `booking_id` y se saltearía «no contactar»).
- Los flows con triggers de venta que se republican desde el lienzo no duplican filas de trigger (`app/api/v1/flows/[flowId]/publish/route.ts`); para los otros tipos esa duplicación es anterior y se dejó como estaba.
