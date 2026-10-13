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
  `flows.form_id` (00155) y se editan en el editor de pasos compartido
  (`components/automations/step-tree-editor.tsx`, que usa también la Agenda; el
  `linear-flow-editor.tsx` quedó como envoltorio). Cómo se arman con
  condiciones: [formularios.md](formularios.md) y la sección siguiente.

## Condiciones con caminos: el nodo `branch`

Un nodo del registro (`lib/flow-engine/nodes/branch.ts`, alta en `registry/nodes.ts`)
que reparte el flujo por **caminos distintos según un dato**. Se llama "Condiciones"
en la pantalla. **El motor no sabe de él**: sigue `handle:<salida>` como con cualquier
otro nodo. Detalle de uso desde un formulario en [formularios.md](formularios.md).

**Los datos del nodo** (`BranchNodeData`):

```ts
{ label?: string, paths: [{ id, label, logic: "and" | "or", conditions: BranchCondition[] }] }
```

- **Las salidas son handles**: `handle:<id del camino>` y `handle:else` ("Si no", que
  no se guarda: existe siempre y es siempre la última).
- **La regla**: va por **el primer camino, en el orden en que están, cuyas condiciones
  se cumplen**; si ninguno se cumple, por "Si no". En cuanto uno se cumple los de
  abajo ni se miran (`pickPath`). Un camino o un "Si no" sin pasos termina la sesión
  sin error.
- **Los ids de camino** son `p_xxxxxx`, se generan una vez y **no cambian** aunque se
  renombre o se reordene el camino (son la salida). Prohibidos: `else`, `true`,
  `false`, `yes`, `no` (el motor tiene alias para los últimos). De 1 a 10 caminos y
  un nombre de hasta 60 caracteres (`lib/flow-engine/branch-paths.ts`).
- **Nunca lanza.** Un campo que no se puede leer (la pregunta ya no existe, la base no
  responde) hace que esa condición **no se cumpla** y el flujo sigue; datos del nodo
  rotos van por "Si no".

**Una condición** es `{ field, operator, value?, value2?, values?, valueType? }`. El
`field` es la ruta del dato (`answer.facturacion`, `form.name`, `submission.score`,
`booking.status`, `contact.tags`, `variable:ai_response`...).

**Operadores por tipo** (`OPERATORS_BY_TYPE` en `condition-eval.ts`):

| Tipo | Operadores |
|---|---|
| texto | `is`, `is_not`, `contains`, `not_contains`, `is_empty`, `is_not_empty` |
| número | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `is_empty` |
| selección única | `is`, `is_not`, `is_any_of`, `is_empty` |
| selección múltiple | `includes`, `includes_any`, `includes_all`, `not_includes`, `is_empty` |
| fecha | `before`, `after`, `between`, `within_last_days`, `older_than_days`, `is_empty` |
| sí / no | `is_true`, `is_false` |

### Un solo evaluador

`lib/flow-engine/condition-eval.ts` es **el único** que decide si una condición se
cumple. Lo usan el nodo, el simulador, el panel del canvas y "Probar condiciones".
Es puro (sin base, sin React, con el reloj por parámetro), así que corre igual en el
servidor y en el navegador. Reglas que no se discuten:

- **Se compara por tipo, con el valor real**: `"12" > 9`, no como texto. Las
  respuestas de un formulario se leen de la base con su tipo (un número es un número,
  una selección múltiple es una lista), no del texto de `{{answer.x}}`.
- Mayúsculas y espacios no cuentan. Los números no aceptan coma decimal (`"1,5"` no
  es número). Las fechas `YYYY-MM-DD` son UTC y se comparan por día.
- **Un valor que no se puede leer como el tipo** (un "abc" donde va un número) no
  cumple NINGUNA condición de ese tipo, ni siquiera "es distinto de".
- **Una condición incompleta no se cumple** (una lista sin elementos, una fecha sin
  fecha): una regla a medio armar no deja pasar a nadie.
- **Un grupo vacío**: `and` se cumple, `or` no (igual que el nodo viejo).
- **Los seis operadores viejos** del `condition` (`equals`, `not_equals`, `contains`,
  `exists`, `gt`, `lt`) viven en `legacy-operators.ts` y se evalúan con la semántica de
  siempre cuando la condición no trae `valueType`. El registro registra esa misma
  función: un test lo comprueba.

### De dónde sale cada campo

`resolveBranchFields` resuelve **cada campo una sola vez** y carga el contacto
**solo si algún campo lo necesita** (una condición sin `valueType`, la que viene del
nodo viejo, siempre lo necesita). Cada campo del registro puede declarar
`resolveTyped` (valor con su tipo) además del `resolve` de siempre.

- `answer.<clave>` (las claves con guion pasan a guion bajo): se lee `form_submissions`
  por `submission.id` y se usa la definición **de la versión con la que se respondió**
  (`answerValueOf`). Si la pregunta no está en esa versión: "la pregunta ya no existe"
  (no se cumple, y queda en el log). Si está pero no se respondió: vacía (`is_empty`
  se cumple). Sin `submission.id` cae al texto de la variable.
- `form.*`, `submission.*`, `booking.*`, `sale.*`, `payment.*`: las variables que dejó
  el disparador, por su ruta (no necesitan contacto).
- `contact.tags`, `contact.sequences`, `contact.lead_temperature`, los campos
  personalizados y los datos de llamadas y ventas que ya tenía el `condition`.

### Qué se puede comparar: `variableSchema` y `outputs`

El editor ofrece solo campos que existen, con su tipo y sus opciones:

- **`TriggerDefinition.variableSchema?(config, ctx)`** (asincrónico, corre en el
  **servidor**, devuelve `ConditionFieldSpec[]`): lo que aporta el disparador.
  Formularios (`formVariableSchema`): cada pregunta con su tipo, `form.name` y, en
  encuestas, `submission.score` y `submission.nps_category`; con varios formularios
  solo las preguntas con la misma clave y el mismo tipo en todos. Agenda: `booking.*`
  como texto. Ventas: solo las variables que son texto en serio. El canvas y el editor
  de pasos lo piden con la acción `getConditionCatalogInputs`.
- **`NodeDefinition.outputs?(data)`** (puro, en `node-outputs.ts`): lo que un nodo le
  deja a los pasos siguientes. Hoy solo `httpRequest` (`variable:<responseVariable>`)
  y `aiResponse` (`variable:ai_response`). **Solo cuentan los nodos que están ANTES
  en el mismo camino** (`upstreamNodesOf`): un camino no ve lo de otro.
- **`availableConditionFields`** (`condition-catalog.ts`, puro) junta todo en grupos
  ("Del formulario", "De pasos anteriores", "Del contacto"...) y `staleConditions`
  avisa de las condiciones sobre campos que ya no existen.

Sumar un trigger que aporte campos es declarar `variableSchema`; sumar un nodo que
deje una variable es declarar `outputs` y sumarlo a `node-outputs.ts`. El motor y el
catálogo no se tocan.

### `branch_taken`: lo que queda en el historial

Cada vez que el nodo corre inserta en `analytics_events` un `branch_taken` con
`{ nodeId, sessionId, pathId, pathLabel, checks: [{ pathId, field, operator, ok, missing?, error? }] }`.
**Nunca guarda valores** (pueden ser datos personales): solo el camino y, por
condición mirada, qué campo y si se cumplió. Si el insert falla, el flujo sigue. La
ficha del contacto (`lib/contacts/history.ts`) lo muestra como "en la automatización X
fue por el camino Y".

### Convertir el `condition` viejo

`conditionToBranch` (`convert-condition.ts`) arma un camino con las condiciones viejas
tal cual, `true` → ese camino, `false` → "Si no". Da las mismas salidas que el
original (misma tabla de contextos en los tests). **Única diferencia documentada**: un
nodo sin NINGUNA condición y sin contacto (el `condition` da `false`; el `branch`
convertido se cumple, porque un `and` vacío se cumple). No se da en la práctica: el
motor siempre corre sobre un contacto. El `condition` viejo **no se toca**.

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

## Flujos sin contacto: `subject`, `needsContact` y `notify_team` (EOD, E15–E16)

Un reporte de fin de día es de una persona del equipo, no de un lead. En vez de inventar un
contacto, el registro declara sobre quién es cada flujo:

- **`TriggerDefinition.subject`**: `"contact"` (por defecto, todos los de siempre) o
  `"member"`. Hoy el único `member` es `eod_submitted` (`registry/eod-triggers.ts`), que
  además declara `auditEntityFor` (el disparo queda en el historial del reporte).
- **`NodeDefinition.needsContact`** (obligatorio). Los que sirven sin contacto reciben
  `NodeExecutionArgs<Data, FlowExecutionContext>` (`contactId: string | null`); los demás
  reciben `ContactFlowContext` (`contactId: string`) y el motor nunca los corre sin uno.
  La lista que usa el navegador es `lib/flow-engine/contact-free.ts`, y
  `consistency.test.ts` exige que coincida con el registro.
- **`FlowExecutionContext.memberUserId`**: la persona del flujo sin contacto. Viaja por
  "Esperar" (payload del job y `flow_sessions.member_user_id`).
- **El cron** (`lib/flow-engine/automation-events.ts`) hace `switch (eventSubject(...))`: la
  rama `contact` es la de siempre; la `member` solo mira disparadores `member` (nunca el
  comodín `crm_event`) y arranca el flujo sin conversación ni canal.
- **El motor**: un nodo con `needsContact` en un flujo sin contacto se saltea y se anota en
  `analytics_events` como `node_skipped`. Es la red de seguridad: el editor de pasos
  (pantalla `eod`) y la paleta del canvas no los ofrecen, y guardar o publicar uno se rechaza
  (`member-flow.ts` / `member-flow-db.ts`).
- **Campos de Condiciones**: `eod.`, `member.`, `metrics.`, `channel.` y `report.` se leen de
  las variables (`registry/conditions.ts`) y son "sin contacto" en el nodo `branch`. Los
  campos que solo tienen sentido con un contacto (secuencias, agendas, ventas del contacto)
  usan `requireContactId`: sin contacto, "no se cumplen".

### `notify_team` ("Avisar en la campana")

`{ to: "users" | "reporter" | "both", userIds, title, body }`. Título y texto con variables.
Solo llega a miembros del workspace. Con un reporte en las variables, abre el reporte; si no,
el flujo. Sirve también en flujos con contacto.

### `send_email` sin contacto

Destinos nuevos: `member` (quien envió el reporte) y `users` (personas elegidas). Sin
contacto no se lee el contacto ni se aplica "no contactar" (con contacto, igual que siempre:
lo fija su test).

## Webhooks entrantes: el trigger `webhook_received`, el nodo `upsert_contact` y el sujeto `webhook` (Extra L, WH2)

Detalle de producto en `docs/webhooks.md`. Lo que importa para el registro:

- **`webhook_received`** (`registry/webhook-triggers.ts`): `scope: event`, **`subject: "webhook"`** y **sin `eventTypes`**, asi que el cron de
  `automation_events` nunca lo levanta: corre directo desde el procesamiento del envio (`lib/webhooks/run-flows.ts`), con el mismo reclamo en
  `trigger_fires` (`webhook:<envio>:<flujo>:<reproceso>`). Su `variableSchema` sale del ejemplo del endpoint (`webhook.payload.*`, `webhook.query.*`).
  `triggers.type` pasa a 32 valores (00187).
- **`TriggerSubject`** suma `"webhook"` (ademas de `contact` y `member`). `FlowExecutionContext` suma `inboundWebhookId`; `flow_sessions` admite
  `contact_id` null **si** hay `member_user_id` o `inbound_webhook_id` (CHECK de tres vias).
- **`upsert_contact`** (`nodes/upsert-contact.ts`): `needsContact: false`, salidas `handle:ok` / `handle:fail`, `outputs` `contact_result` y
  `contact_fail_reason`. Escribe `context.contactId` y `flow_sessions.contact_id`: **es el unico paso que cambia de contacto a mitad de sesion**.
  Un «Esperar» toma el `contactId` del contexto *al momento de esperar*, asi que si el paso va antes, el contacto sobrevive a la espera.
- **El motor saltea (no corta) un paso con `needsContact` en un flujo sin contacto** y lo anota (`node_skipped`, «paso salteado: no habia contacto»).
- **Regla por camino** (`lib/flow-engine/contact-requirement.ts`, pura): para el sujeto `webhook`, un paso con `needsContact` solo es valido si en
  **todos los caminos** desde el disparador lo precede la salida «Listo» de un `upsert_contact` (maneja ciclos). Un `branch` que lee `contact.*` cuenta
  como «necesita contacto». La regla frena la **publicacion** (rutas `publish`), no el guardado a medias; EOD (`member`) no cambia.
- **Condiciones** `webhook.*`: se registran en `registry/webhook-conditions.ts` sin tocar `conditions.ts`, `branch.ts` ni `condition-eval.ts`.
- **Disparadores de mensaje** (AT1): `keyword` suma los filtros `fromAdOnly` y `storyMentionOnly`; las variables `message_origin.*` se siembran en el
  motor al correr un flujo por un mensaje.
