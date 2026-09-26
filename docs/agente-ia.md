# Agente de IA conversacional

Fase 3, Bloques 2a, 2b y 2c. El motor del agente que conversa con los leads:
el loop, sus límites, sus herramientas con parámetros, su memoria por contacto,
el registro de lo que hace y lo que gasta, la convivencia con los flows, y el
modo borrador (el agente redacta y una persona aprueba antes de que salga).

## La regla corta

- **Un solo respondedor por mensaje, con la automatización primero.** Si un flow
  reclama el mensaje, el agente se abstiene y lo deja escrito.
- **Un turno = un run.** Una ráfaga de mensajes se responde una vez. Toda
  abstención, bloqueo o error deja su run; un "no contestó" sin explicación es
  imposible de depurar.
- **Todo lo barato antes de tocar un proveedor.** Temas vedados, horario, topes
  de respuestas y de gasto se evalúan sin llamar al modelo.
- **El lead nunca ve un error técnico.** Si fallan el modelo y el respaldo, la
  conversación pasa a una persona en silencio, y queda marcada.
- **Toda acción del agente queda auditada y se puede revertir.** Etiquetar,
  cambiar la temperatura, programar un seguimiento, asignar, derivar,
  pausarse y guardar el resumen dejan su entrada en `audit_log` con el agente
  como actor, y se deshacen desde la pestaña Acciones.
- **Aprobar un borrador no es una respuesta manual.** El mensaje sale con las
  dos autorías (agente y quien aprobó) y el agente sigue encendido. Una
  respuesta escrita a mano sí lo apaga.

## Qué pasa con un mensaje entrante

```
webhook (late / evolution)
  → guardar el mensaje (Bloque 1)
  → opt-out
  → runInboundAutomation      ¿lo reclama una automatización?  lib/inbound.ts
  → maybeScheduleAgentTurn    palancas del agente → agendar     lib/agent/dispatch.ts
        (job reprogramable en scheduled_jobs, uno por conversación)
  → cron cada 15 s            /api/cron/agent-bursts
  → runAgentTurn              el turno                          lib/agent/runner.ts
```

`maybeScheduleAgentTurn` es **el único lugar del sistema que agenda un turno**.

## Las palancas y el estado efectivo

| Palanca | Dónde | Quién la toca |
|---|---|---|
| Encendido global | `agents.is_enabled` | Owner/Admin en Agentes. Un tope de gasto con acción "apagar" |
| Maestro por canal | `agents.enabled_channel_ids` | Owner/Admin en Agentes → Canales. Un canal, un agente |
| Modo de entrega por canal (00070) | `agents.channel_modes` | Owner/Admin en Agentes → Canales: "Envía directo" o "Deja borradores para aprobar". Sin entrada = envía directo. Decide **cómo** entrega, no **si** actúa |
| Por conversación, **tres estados** (00066) | `conversations.agent_enabled` | Cualquiera en su scope, desde la bandeja. `NULL` = **heredar del canal** (el default); `true` = forzado prendido; `false` = forzado apagado |
| Pausa de un flow o del propio agente | `conversations.agent_paused_until` | Nodos "Pausar / Reanudar agente IA" y la herramienta `pausarse`. Reanudar nunca prende lo que nadie prendió |

El estado efectivo **no se guarda**: se deriva en `resolveAgentState`
(`lib/agent/config.ts`), el único lugar que combina las palancas. Devuelve
también `inherited`, para que la bandeja diga qué está heredando ("el agente
atiende Instagram, así que esta conversación sí").

**Forzado apagado es lo que dejan Human Takeover (nodo y herramienta) y una
respuesta manual del operador**: si una persona tomó la conversación, el agente
no vuelve solo aunque el maestro esté prendido. Se vuelve a "heredar" o a
"prendido" solo desde la bandeja.

**Qué pasa el día que se prenda el maestro de Instagram:** todas las
conversaciones en "heredar" (el 24/9/2026, las 583) pasan a estar atendidas
ante el **próximo mensaje entrante**. No es retroactivo: nadie recibe nada por
prender el maestro. La ráfaga que responde el primer turno ignora los mensajes
más viejos que `agents.burst_max_age_hours` (default 6): en una conversación
nunca respondida, no contesta la pregunta de hace tres semanas junto con la de
hoy. El contexto de ~20 mensajes sigue entrando entero al prompt.

**Qué runs deja el despacho.** Forzado apagado: ninguno. Heredar con el maestro
apagado: ninguno (es el estado de todas las conversaciones; sería ruido).
Forzado prendido sin poder actuar: un run `skipped` con el motivo (alguien lo
pidió y no pudo). Automatización que reclamó el mensaje con el agente activo:
un run `skipped_automation`.

## Los tiempos

- **Ventana de silencio** (`bundle_window_seconds`, 60 s): cada mensaje nuevo la
  reinicia.
- **Demora** (`response_delay_seconds`, 20 s): después de que cierra la ventana.
- **Tope de espera** (`max_wait_seconds`, 300 s): se congela en el primer mensaje.
- **Antigüedad máxima de la ráfaga** (`burst_max_age_hours`, 6 h): lo anterior
  no se responde, pero se lee.

El job se agenda un tic (15 s) antes de que cierre la ventana. El turno espera en
proceso hasta el **objetivo absoluto** `último mensaje + ventana + demora`: la
demora absorbe el tic del cron y la generación. Si el lead escribe durante esa
espera, se envía ya.

Validación: `demora + timeout + 30 < 300` (el `maxDuration` de la ruta).

## Coexistencia con los flows

- `runInboundAutomation` devuelve quién reclamó: palabra clave global, sesión de
  flow esperando respuesta, flow, flow que falló.
- Un flow con **trigger por defecto** reclama todos los mensajes. Para que el
  agente conteste, el trigger tiene que tener marcada la puerta **"Solo si el
  agente de IA está apagado"**. La pestaña Canales lista los flows que no la tienen.
- Tres capas contra la respuesta doble: el despacho no agenda si alguien reclamó;
  el turno re-verifica todo antes de generar y antes de enviar; el índice único
  parcial de `scheduled_jobs` impide dos turnos pendientes por conversación.

## Guardarraíles (`agents.guardrails`, esquema en `lib/agent/schemas.ts`)

En este orden, antes del modelo: temas vedados → enojo → urgencia → horario
(Costa Rica) → tope de respuestas (se reinicia cuando escribe una persona) →
turnos sin resolver → topes de gasto. Los que derivan no marcan error.

**El tope de respuestas por conversación es opcional desde la 00070** y por
defecto está vacío (sin tope). La columna y el guardarraíl quedan: volver a
tenerlo es escribir un número. El freno contra un agente en loop son los topes
de gasto y la regla de turnos sin resolver. Los dos contadores
(`countAgentReplies`) suman los runs `responded` **y** los borradores enviados:
sin lo segundo, en modo borrador no subirían nunca.

## Base de conocimiento

- El agente responde con su prompt. Si le falta un dato y tiene la KB prendida,
  usa `buscar_en_conocimiento`. Una búsqueda vacía **no deriva sola**: decide el agente.
- Con la KB apagada la herramienta no existe para el modelo.
- El filtro de tags e `internal_only` va **dentro del SQL**
  (`match_knowledge_chunks_filtered`, 00062). Verificado contra la base en
  `scripts/verify-rls.mjs`.

## Herramientas (tool registry, `lib/agent/tools/`)

Cada entrada declara nombre, descripción, schema de entrada (zod), schema de
su configuración (zod) **y `configFields`**, el descriptor con el que la
pestaña Herramientas renderiza sus parámetros sin un solo condicional por
nombre. Sumar una herramienta es un archivo y una línea en `index.ts`.

Todas corren en modo **"aplica solo"**. El paso del run lo escribe el wrapper
(`build.ts`); el efecto de negocio lo escriben los ejecutores de
`tools/effects.ts` en `audit_log` con `performed_by_agent_id` y una metadata
uniforme (`origin`, `run_id`, `conversation_id`, `contact_id`, `channel_id`).
Los mismos ejecutores los usa la clasificación al cierre, así las reglas
valen las dos veces. La configuración se guarda en `agents.tools_config` y se
valida server-side contra el schema de cada una (`updateAgentTools`).

| Herramienta | Qué se configura además del on/off |
|---|---|
| `derivar_a_humano` (obligatoria) | Si reabre la conversación |
| `buscar_en_conocimiento` (se prende desde Conocimiento) | Fragmentos por búsqueda, similitud mínima |
| `etiquetar_contacto` | Lista blanca de tags (solo de `tags`, **nunca crea**, **nunca una etiqueta con efecto**: ver "Etiquetas con efecto"); si puede quitar. Sin tags en el workspace, no se puede habilitar y la pantalla dice por qué |
| `cambiar_temperatura` | Si puede bajarla (default: solo sube) |
| `programar_seguimiento` | Máximo de días (90); si puede pisar una fecha puesta a mano por una persona (se detecta por el audit) |
| `asignar_conversacion` | Usuarios habilitados; criterio: round-robin (sin estado nuevo, por el audit), usuario fijo, o el setter del contacto |
| `buscar_datos_del_contacto` | Qué campos lee; email y teléfono apagados por defecto. Es lectura: deja paso en el run, **no** entrada en `audit_log` |
| `pausarse` | Máximo de minutos; si se reanuda sola al vencer (usa `agent_paused_until`) |

## Cierre de la conversación, memoria y clasificación (F33, F34)

Dos caminos cierran una conversación y los dos encolan el job
`conversation_close` (`lib/agent/closing.ts`):

- **A mano**, desde la bandeja: `closeConversation` (server action).
- **Por inactividad**: `sweepInactiveConversations` corre en el cron de jobs
  (cada minuto, lote de 50). Cierra solo conversaciones abiertas donde el
  agente está **efectivamente activo y ya participó** (tiene al menos un run
  con `source = agent`), sin mensajes desde hace `agents.close_after_inactive_hours`
  (default 12). El backlog de conversaciones anteriores al agente queda
  abierto a propósito: se cierra a mano.

El job (`lib/agent/summary.ts`) hace **una sola llamada al modelo** que
devuelve el resumen integrado del contacto y una propuesta de clasificación:

- **Resumen acumulativo con reconciliación.** El resumen previo entra al prompt
  como dato (bloque `memoria`) con la instrucción de integrar y **corregir lo
  que cambió**, no acumular contradicciones. Lo guardado **reemplaza**
  `contacts.ai_conversation_summary`, con audit `summary` (reversible). Tope
  de ~2000 tokens (8.000 caracteres): si se pasa, una segunda llamada condensa
  lo viejo; si igual se pasa, se recorta. Sin mensajes nuevos desde
  `conversations.summarized_at`, no se llama al modelo ni se abre run.
- **Clasificación.** Tags (solo la lista blanca), temperatura y seguimiento se
  aplican con los mismos ejecutores y límites de las herramientas; una
  herramienta apagada para el agente no aplica esa parte. Todo con
  `origin: close_classification`, en el run y en Acciones.
- Pasa por `openAiRun` con `source = conversation_summary`: su costo entra al
  total. Un entrante reabre la conversación (`increment_unread`); si el job la
  encuentra abierta, no hace nada.

Se configura en Configuración → "Cierre de la conversación y memoria"
(`close_after_inactive_hours`, `summary_on_close`, `classify_on_close`).

## Runs, Acciones y Costos (la pantalla)

- **Runs**: una fila por turno del agente y por cada otra llamada a IA. Filtros
  en la URL (`lib/agent/runs-query.ts`, mismo patrón que la bandeja): período,
  agente (preseleccionado el de la pestaña; "todos" y "sin agente"), canal,
  contacto o conversación, resultado, modelo, herramienta ejecutada, rango de
  costo. Detalle expandible: pasos, fragmentos de KB con su documento, error,
  tokens y costo. El detalle suelto sigue en `agents/runs/[runId]`.
- **Acciones**: una fila por acción del agente, sobre `audit_log`
  (`lib/agent/actions-query.ts`), con el antes/después en palabras, origen (en
  la conversación o al cierre), link al run y a la conversación. Filtro
  principal por tipo de acción, más período, contacto, canal, agente y
  revertida. **Revertir** (`lib/agent/revert.ts`): aplica el inverso con el
  cliente de quien revierte (la RLS decide), deja una entrada `revert` firmada
  y el servidor marca la original (`reverted_at`, `reverted_by_audit_id`,
  00068). `audit_log` sigue sin UPDATE para usuarios.
- **Costos** (solo Owner/Admin, service role): totales del período, promedio
  por run, por conversación y por derivación, top 10 de conversaciones más
  caras, desglose por fuente, agente y modelo (`ai_cost_report`, 00069), topes
  del agente y del workspace, y la tabla de precios editable por Owner
  (siempre como fila nueva con vigencia). La cabecera muestra runs de hoy,
  gasto del mes y % de derivaciones.
- **Roles**: un Member entra a la pantalla de Agentes solo para Runs y Acciones,
  acotadas a su scope por RLS (00060, 00068) y sin ninguna columna de costo.
  La configuración, los topes y Costos son de Owner/Admin.

## Costos

- Toda llamada a IA pasa por `openAiRun` (`lib/ai/run.ts`): agente, nodo AI
  Response (`flow_ai_node`), pasos de secuencia (`sequence_ai_step`), indexación
  (`kb_indexing`), resumen de cierre (`conversation_summary`).
- El costo se congela al cerrar con el precio vigente de `model_pricing`. Sin
  precio, el run se guarda con costo null y el aviso. **La tabla se siembra con
  `supabase/seeds/00_model_pricing.sql` y se edita desde Costos.**
- Costos: privilegio de columna (00060). Con el cliente de un usuario nunca
  `select("*")` sobre `agents` ni `agent_runs`: usar las constantes de
  `lib/agent/public.ts`. Toda columna nueva de `agents` que la pantalla lea
  con el cliente del usuario va al GRANT (00066, 00067 lo hacen).

## Visibilidad de errores

`conversations.last_agent_error_at / _run_id` + aviso en la campana + run, cuando
el turno termina en error, se descarta (job vencido, timeout) o fallan los dos
modelos. Se borra con una respuesta buena del agente, un mensaje de una persona o
el cierre de la conversación. En la bandeja: filtro "Con error del agente" y un
punto rojo que lleva al run.

## Modo borrador (Bloque 2c)

Cuando el canal de la conversación está en modo borrador, el turno es idéntico
hasta el final (guardarraíles, contexto, KB, herramientas, formato), pero en vez
de enviar **deja la respuesta en `agent_drafts`** y el run cierra `drafted`. Una
persona la revisa en **Borradores** (o arriba del campo de escritura de la
conversación) y decide: enviar, editar y enviar, regenerar o descartar.

### Por qué una tabla aparte y no un mensaje "borrador"

Una fila en `messages` la contarían los dashboards como enviada, el contexto del
agente la leería como algo que dijo, y `extractBurst` la tomaría como la salida
que cierra la ráfaga. **El borrador no es un mensaje: no cierra la ráfaga.** El
turno siguiente responde todo lo acumulado desde la última salida real. Tampoco
lo leen la memoria ni el resumen de cierre: un borrador descartado no contamina
nada.

### Qué cambia en el turno (`lib/agent/runner.ts`)

| | Envío directo | Modo borrador |
|---|---|---|
| Demora deliberada | sí | **no**: no hay nadie del otro lado esperando que parezca humano |
| Horario de atención | aplica | **no**: si hay una persona para aprobar, no está fuera de horario (queda `outside_hours` en el run) |
| Guardarraíl que deriva, tope de gasto, fallo del proveedor, salida vacía | deriva y apaga el agente | **fila sin texto** con el motivo y la sugerencia de derivar; el agente no se apaga. La cola es el único lugar de "lo que necesita respuesta" |
| `derivar_a_humano` y `pausarse` | se ejecutan | **no se ejecutan**: quedan como sugerencia en el borrador y se aplican si alguien lo aprueba |
| Etiquetar, temperatura, seguimiento, asignar, leer CRM, KB | se ejecutan | se ejecutan igual; quedan listadas en el borrador. Si se descarta, se revierten desde Acciones |

Un run nuevo: **`drafted`**. El costo existe igual (se descarte o no).

### El ciclo de vida

| Estado | Cuándo |
|---|---|
| `pending` | El agente terminó su turno. Espera decisión |
| `sending` | Alguien lo aprobó y está saliendo en este instante |
| `sent` | Salió (al menos una parte; las que ya salieron no se reenvían nunca) |
| `failed` | El envío falló. Se puede reintentar |
| `discarded` | Alguien lo descartó, o hubo una salida real por otro lado (motivos `auto:`) |
| `superseded` | El lead escribió antes de que se aprobara: el turno nuevo genera otro |
| `regenerated` | Alguien pidió otra versión: hay un borrador nuevo con `previous_draft_id` |

**Un solo borrador vivo por conversación** (`pending`, `sending` o `failed`),
garantizado por el índice único parcial `agent_drafts_one_open_per_conversation`.

- **Un entrante nuevo** marca `superseded` el pendiente o fallido, en los dos
  webhooks, antes de las automatizaciones. **Nunca uno en `sending`**: ese está
  saliendo y lo termina el servidor.
- **Una salida real lo descarta**: una respuesta a mano (`applyManualReply`), un
  mensaje desde el celular por WhatsApp (`fromMe`), o cerrar la conversación.
- **Un turno lento no pisa uno más nuevo**: si al guardar ya hay un entrante o
  un borrador más reciente, el suyo nace `superseded`.
- **Si hay uno en `sending`, el turno no revienta**: cierra `skipped` /
  `draft_blocked_by_send` y se reprograma en 60 s con la misma clave del burst.
- El barrido de inactividad **no cierra** conversaciones con un borrador vivo.

### La trampa: aprobar no es una respuesta manual

`sendDraft` (`lib/agent/drafts/actions.ts`) envía por `sendAgentParts` con
`sent_by_agent_id` **y** `sent_by_user_id`, y nunca pasa por `applyManualReply`.
Además `lastHumanReplyAt` ignora los mensajes con `sent_by_agent_id`, así un
borrador aprobado no reinicia los guardarraíles ni hace abortar el turno
siguiente. Si cualquiera de las dos cosas se rompe, el modo borrador funciona
una sola vez por conversación.

### Las acciones (`lib/actions/agent-drafts.ts`)

Leen y toman con el **cliente del usuario** (la RLS aplica el scope de leads: un
Member decide solo sobre los suyos, y el `WITH CHECK` exige
`decided_by = auth.uid()`); envían y marcan `sent`/`failed` con el service role.

- **Enviar**: bloqueo optimista (`pending|failed → sending`). Antes recalcula la
  ventana contra el último mensaje del lead, y si el lead volvió a escribir o ya
  hubo una respuesta, no sale. "No contactar" pide confirmación. Las
  sugerencias se aplican con el agente como actor y `approved_by` en metadata.
- **Editar y enviar**: guarda `sent_body` distinto de `body` (esa diferencia es
  la métrica de calidad). El texto editado no se recorta ni se le sacan emojis.
- **Regenerar**: si ya hay un turno agendado para la conversación, no encola
  otro. Si no, toma el borrador y encola un turno **con la clave del burst**
  (`agent_burst:<conv>`): nunca corren dos turnos a la vez. La instrucción es
  una clave **volátil** (`push_debounced_job`, 00070): si el lead escribe
  mientras espera, la instrucción se descarta (era sobre el borrador viejo) y
  se conserva la cadena.
  **Regenerar sin mensajes nuevos no toca el CRM** (Bloque 2d-A): el turno se
  arma con `readOnly` y las herramientas que escriben (etiquetar, temperatura,
  seguimiento, asignar) no se ofrecen; derivar y pausarse sí, porque en
  borrador solo dejan una sugerencia. Sin esto, con asignación en round-robin,
  regenerar tres veces paseaba la conversación por tres personas. Si el lead
  escribió después del borrador, es un turno normal y las herramientas corren.
- **Descartar**: con motivo opcional. Es una decisión, no una ventana perdida.

### La ventana de mensajería

El SDK de Zernio no la expone por conversación. Se usa lo que documenta Meta:
**24 h desde el último mensaje del lead** para Instagram y Facebook, sin ventana
para WhatsApp por Evolution. Configurable por canal en
`channels.messaging_window_hours` (NULL = default, 0 = sin ventana). La regla
vive en `lib/messaging-window.ts` y en SQL como `messaging_window_hours()`.

"No enviable" no es un estado: es el cálculo sobre `sendable_until`. La cola lo
muestra en cinco niveles, derivados de la ventana del canal (mitad, cuarto,
octavo; con 24 h son 12, 6 y 3 h), con leyenda. Pasada la ventana la fila ofrece
**responder a mano**. Nada se autovence: el borrador sigue `pending`.

El barrido de la 00070 (cada 5 minutos) marca `window_missed_at` y congela de
quién era (`missed_while_assigned_to`), y pasa a `failed` los `sending`
colgados más de 5 minutos. **Los avisos a las personas son la 00072**, que está
escrita y probada pero **sin aplicar** (ver abajo).

### La cola (`/dashboard/drafts`)

**No está en el menú** (Bloque 2d-A). El modo borrador es una rampa para
confiar en el agente, no una sección permanente: el día que un canal vuelve a
envío directo, un ítem de menú quedaría para siempre apuntando a una pantalla
vacía. La ruta sigue existiendo (enlazable, y a donde apuntan los avisos) y se
llega por cuatro lados:

- el **número sobre Inbox** en el menú (y en la barra del teléfono): los míos;
  Owner/Admin ven además el total. Con cero no aparece.
- la pestaña **Borradores (N)** en la bandeja, junto a Todas/Abiertas/…; con
  cero no aparece.
- el chip **Borrador esperando** en cada conversación de la lista, que entra
  directo al hilo (el borrador está arriba del campo de escritura).
- las notificaciones de ventana (00072).

La pantalla de la cola tiene **← Volver a Inbox** arriba de todo.

**En el teléfono** (abajo de 980 px, variante `queue:` en `globals.css`) la
tabla pasa a tarjetas: contacto y canal, **el estado de la ventana** (lo
primero que decide si vale la pena leer el resto), lo que escribió, la
respuesta, lo que hizo el agente y, pegados al pie de la tarjeta, **Enviar y
Descartar** (44 px, `sticky`, no `fixed`: el teclado no los tapa). Editar y
Regenerar van en "Más". `⌘↵` sigue como atajo, nunca como única vía. La barra
de arriba del teléfono reemplaza al menú lateral, y la bandeja es lista → hilo
a pantalla completa con "Volver".

- **De quién es un borrador**: del setter del contacto; sin setter, del
  vendedor; sin ninguno, "sin asignar" (visible, no escondido). Se resuelve por
  el contacto, sin campo propio. **La regla la confirma Wendy.**
- Por defecto muestra **los míos**; filtros: sin asignar, una persona, todos,
  historial, por vencer, canal. El contador del menú coincide con esa vista
  (Owner/Admin ven además el total).
- Cinco columnas: contacto, lo que escribió el lead, la respuesta propuesta, lo
  que hizo el agente (columna propia), la decisión. Ordenada por ventana: lo
  que vence antes primero, cerrados y sin ventana al fondo.
- **Cmd/Ctrl + Enter** envía la fila activa. Realtime sobre `agent_drafts`.

### La medición

Arriba de la cola, cinco números, de `draft_queue_metrics` (00071):

| Número | Qué mide |
|---|---|
| Respuesta | `responded_at − inbound_at`: lo que percibe el lead, **desde su último mensaje** |
| Lo que tarda el agente | `completed_at − inbound_at`: **incluye la espera de la ráfaga**, no es la velocidad del modelo |
| Lo que tarda la aprobación | `responded_at − completed_at`, **solo sobre runs con borrador**. El único que se puede mejorar |
| Ventanas perdidas (7 días) | Borradores que quedaron pendientes hasta que cerró la ventana. Descartar no cuenta |
| Aprobados sin editar (7 días) | El dato para decidir cuándo pasar a envío directo |

`agent_runs.inbound_at` y `responded_at` se llenan **en los dos modos**, así el
número compara envío directo contra borrador. La función se llama con el
cliente del usuario y **se defiende sola**: a un Member le devuelve siempre sus
números, pase el id que pase. El desglose por persona
(`draft_queue_metrics_by_person`) es solo Owner/Admin. En Costos: gasto en
borradores descartados y porcentaje enviado sin editar.

## Etiquetas con efecto sobre el agente (Bloque 2d-A, 00073)

Wendy tiene contactos personales en el mismo Instagram por el que entran los
leads. **El peor error posible es que el agente le ofrezca la academia a un
amigo.** Una etiqueta que solo queda guardada no alcanza: el agente igual
redactaría la respuesta de venta. Tiene que tener efecto.

Una sola regla genérica, configurable por etiqueta desde **Agentes → Etiquetas**
(solo Owner/Admin):

- **Apaga el agente** (`tags.disables_agent`): las conversaciones del contacto
  pasan a forzado apagado, también las que se abran después. No se genera
  borrador ni corre turno: no se gastan tokens.
- **Asigna a** (`tags.assigns_to`): setter y vendedor pasan a esa persona al
  poner la etiqueta.

`es-conocido` (apaga + asigna a Wendy) y `no-es-lead` (apaga) son dos filas de
esa pantalla, no dos casos especiales en el código.

**Vive en la base, no en una Server Action**, porque son seis los caminos que
ponen etiquetas (ficha, panel de la bandeja, acción masiva, CSV, nodo de flow,
herramienta del agente) y no comparten una función. Los triggers:

| Cuándo | Qué hace |
|---|---|
| Se pone la etiqueta (`contact_tags` INSERT) | Apaga las conversaciones del contacto que **no** estaban apagadas y les deja la marca `conversations.agent_disabled_by_tag_id`. Si asigna, pasa setter y vendedor (solo si algo cambia). Una fila `tag_effect` en `audit_log` con quién, las dos consecuencias y el estado previo de cada conversación. |
| Se saca (`contact_tags` DELETE) | Vuelven a **heredar** solo las conversaciones con la marca de esa etiqueta. La asignación queda (decisión de Wendy). Si el contacto conserva otra etiqueta con efecto, la marca pasa a esa y nada se prende. |
| Conversación nueva o movida por una fusión | Nace apagada con la marca. |
| Una persona cambia el estado del agente en la conversación | La marca se limpia sola (`BEFORE UPDATE OF agent_enabled`), **solo si el estado cambia de verdad**. |
| Se borra la etiqueta de `tags` o se le apaga el efecto | Libera sus conversaciones. Prenderle el efecto a una etiqueta en uso lo aplica ya (la pantalla pide confirmación con el número). |

**La marca** es lo que permite revertir solo lo que apagó la etiqueta y nunca
un apagado a mano (Human Takeover, respuesta manual, el toggle). La regla del
trigger — limpiar solo si el estado cambia — resuelve el caso principal:
etiquetar a un conocido, **contestarle a mano** (que reescribe `false` sobre
`false` cuando había una marca de error vieja) y sacar la etiqueta meses
después: la conversación **vuelve a heredar**. Y prender el agente a mano en un
hilo gana sobre la etiqueta: la marca se limpia y sacarla después no toca ese
hilo. No depende de que cada archivo de TypeScript se acuerde de limpiarla.

**Permisos**: policies de `tags` por comando. Un Member crea y usa etiquetas
comunes, y **puede aplicarle** una con efecto a un lead suyo; solo Owner/Admin
crea, edita o borra una con efecto. No se usa privilegio de columna: todos los
usuarios son el mismo rol `authenticated`.

**El agente nunca usa una etiqueta con efecto**: no aparece en su lista blanca
(pantalla, `updateAgentTools`, `applyTags` y la clasificación al cierre la
excluyen, también de configuraciones viejas). Si pudiera poner "es-conocido",
se apagaría a sí mismo en medio del turno y el lead quedaría sin respuesta ni
aviso.

**Dónde se pone**: "Acciones rápidas" en el panel de la bandeja y en la ficha
(un clic, con la consecuencia escrita), y la **acción masiva** de Contactos
(selección por fila o por página, tope 200, con el cliente del usuario: la RLS
decide qué contactos puede tocar; los que ya la tenían no se tocan, así una
conversación prendida a mano no se vuelve a apagar). La cola y el hilo avisan
"Apagado por etiqueta".

## Verificación en vivo pendiente (los ocho casos)

El agente no corrió nunca con un mensaje real. Cuando el system prompt esté
completo (hoy tiene `[[ COMPLETAR: link de agenda ]]`), se prende el maestro de
Instagram y se corren estos ocho casos con la pestaña Runs abierta. Salen de
los criterios "(en vivo)" del documento de requerimientos (F22, F23, F25, F28,
F30, F31, F32, F33):

1. **Respuesta simple** (F22): un DM en una conversación en "heredar" recibe
   respuesta; el run queda `responded` con su costo. Mandar 2-3 DMs seguidos y
   ver que hay **un** run para la ráfaga.
2. **Forzado apagado** (F31): poner una conversación en "Apagado" desde la
   bandeja y escribir: no responde y no hay run. Responder a mano en otra:
   queda forzado apagado sola.
3. **Etiquetar dentro y fuera de la lista blanca** (F23): crear dos tags,
   habilitar una sola; pedirle al agente que etiquete con las dos: aplica una,
   rechaza la otra, y Acciones muestra la fila con el antes/después.
4. **Temperatura y seguimiento con límites** (F23): sube a caliente; pedirle
   bajar sin permiso → no lo hace. Seguimiento a 200 días con máximo 90 → lo
   rechaza; a 7 días → lo guarda.
5. **Derivar a una persona** (F23/F25): pedir "quiero hablar con alguien":
   `escalated`, aviso en la campana, conversación forzada apagada, fila
   "Derivó" en Acciones. Y con una palabra vedada: deriva sin llamar al modelo.
6. **Abstención con rastro** (F28/F30/F32): apagar el maestro de Instagram en
   una conversación forzada prendida y escribir → run `skipped: channel_off`.
   Un flow con trigger por defecto sin la puerta → run `skipped_automation`.
7. **Cierre, memoria y clasificación** (F33/F34): cerrar la conversación a
   mano → run `conversation_summary`, resumen en la ficha del contacto,
   clasificación en Acciones. Volver a escribir desde el mismo contacto → el
   agente "recuerda" (el prompt lleva el resumen). Corregir un dato y volver a
   cerrar → el resumen se reconcilia.
8. **Reversión** (F28): revertir una etiqueta y una temperatura desde
   Acciones → el contacto vuelve atrás, la fila queda marcada como revertida y
   aparece la entrada `revert` en el historial del contacto. Con un Member:
   ve solo lo de sus leads y ninguna columna de costo.

## Verificación en vivo del modo borrador (Bloque 2c)

Con el system prompt completo y el agente encendido **solo en modo borrador**
en Instagram, con Borradores y la pestaña Runs abiertas:

1. **Poner el canal en borrador y volver**: en Agentes → Canales, "Deja
   borradores para aprobar"; volver a "Envía directo" con un clic y otra vez a
   borrador. Queda en el historial de la configuración.
2. **Un DM genera un borrador y no sale nada**: el lead no recibe nada, la fila
   aparece sola en Borradores (sin recargar), y el run queda `drafted` con sus
   tokens y su costo. En la conversación, el borrador arriba del campo de
   escritura con borde punteado y "no enviado".
3. **Enviar**: sale tal cual; el mensaje de la bandeja es del agente y de quien
   aprobó; **el interruptor de la conversación sigue igual** (no pasa a
   "Apagado"). Mandar otro DM: vuelve a dejar un borrador (la trampa).
4. **Editar y enviar**: cambiar el texto; en Costos, "enviados sin editar" no
   lo cuenta.
5. **Regenerar** con "más corto": aparece un borrador nuevo en segundos, con un
   run nuevo `trigger: manual`; el anterior queda "Se pidió otra versión".
6. **Descartar**: sale de la cola; en Costos aparece el gasto descartado.
7. **`superseded` en vivo**: con un borrador pendiente, escribir otra cosa desde
   la cuenta de prueba: el viejo desaparece y el nuevo responde los dos
   mensajes.
8. **Responder a mano con un borrador pendiente**: el borrador se descarta y el
   agente queda "Apagado" en esa conversación (esto sí es manual).
9. **Guardarraíl a la cola**: un DM con "descuento": fila sin texto, "Tema
   vedado", sin llamar al modelo, y el agente sigue encendido.
10. **Derivar y pausarse como sugerencia**: pedir "quiero hablar con alguien y
    no me escribas hasta el lunes": chips de sugerencia en la fila; al enviar,
    la conversación pasa a una persona y queda la entrada en Acciones con
    `approved_by`.
11. **No enviable**: dejar un borrador más de 24 h (o bajar la ventana del
    canal para probar): la fila pasa por amarillo, naranja y rojo con la
    leyenda, y al cerrar ofrece "Responder a mano". La franja suma una ventana
    perdida.
12. **Member real**: con un Member setter de un solo lead, ve y aprueba solo
    ese borrador, su contador del menú coincide con "míos", y su franja muestra
    sus números.
13. **Panel del contacto**: editar temperatura, seguimiento, setter, notas y
    etiquetas desde la bandeja; todo queda en el historial de la ficha con
    quién lo cambió. "No contactar" pide confirmación y pausa las secuencias.

La 00072 (avisos de ventana) se aplica después de un par de días de cola, y se
verifica con un borrador que cruce la mitad de la ventana: un solo aviso, para
el setter, que no se repite.

## Verificación en vivo del Bloque 2d-A

Con la 00073 aplicada, el agente apagado, desde la computadora y desde un
teléfono (o Chrome device toolbar a 390 px):

1. **El caso de la etiqueta, en este orden**: marcar un contacto de prueba
   `es-conocido` desde el panel de la bandeja → **contestarle a mano** desde la
   bandeja → sacar la etiqueta → la conversación **vuelve a heredar** (el
   toggle dice "hereda" y el chip "Apagado por etiqueta" desaparece).
2. `es-conocido` desde el panel: el toggle queda en "forzado apagado", setter y
   vendedor pasan a Wendy, y el historial de la ficha muestra dos entradas.
   Prender el agente a mano en ese hilo, sacar y volver a poner la etiqueta:
   el hilo prendido a mano queda prendido.
3. **Acción masiva** sobre 3 contactos con `es-conocido`: pide confirmación con
   la consecuencia, los 3 quedan etiquetados y cada uno con su historial.
4. **Agentes → Etiquetas**: prender "Apaga el agente" en `no-es-lead` con un
   contacto que ya la tiene: pide confirmación con el número y la conversación
   se apaga en el acto.
5. **Teléfono (390 px)**: sin scroll horizontal ni texto cortado. Menú de la
   barra de arriba; número de borradores sobre Inbox; pestaña "Borradores (N)"
   en la bandeja con un borrador de prueba; en la cola, la tarjeta con la
   ventana arriba y **Enviar/Descartar al pie**, Editar sin que el teclado tape
   el botón, y aprobar de punta a punta con una mano. En la bandeja, lista →
   hilo → Volver, y los datos del contacto como hoja.
6. **Regenerar** un borrador con la asignación en round-robin habilitada, tres
   veces: la conversación no cambia de asignado y Acciones no suma entradas.

## Lo que no está resuelto

- **Respuestas dadas fuera del sistema.** Si alguien contesta desde la app de
  Instagram (no desde la bandeja), el sistema no se entera: el webhook de Zernio
  descarta los salientes. El agente no se apaga solo en ese caso. **En modo
  borrador pesa mucho más**: un borrador vive horas, en esas horas es muy
  probable contestar desde el celular, y ni se descarta el borrador ni lo ve la
  guarda de "ya hubo una respuesta" de Enviar. Contestar desde la bandeja, o
  descartar el borrador a mano.
- **Aprobar un borrador no mira si el agente quedó apagado por una etiqueta.**
  Un borrador que ya estaba en la cola se puede enviar aunque el contacto
  acabe de marcarse `no-es-lead`: decide una persona, y la fila lo avisa en
  rojo. Si hace falta bloquearlo, es un cambio en las cuatro acciones.
- **Un Member no ve en Acciones los `tag_effect` que dispara el agente** (sin
  `performed_by_agent_id`); los ve un Admin.
- **Avisos de ventana (00072)** escritos y probados, sin aplicar: se enchufan
  cuando la cola tenga un par de días y se sepa su volumen.
- **WhatsApp:** los ecos de lo que manda el propio sistema llegan como `fromMe`,
  y no se distinguen de forma confiable de una respuesta desde el teléfono. Hoy
  un `fromMe` no apaga el agente. Revisar cuando se conecte el número.
- **Zona horaria:** el agente corta días y horarios en Costa Rica
  (`BUSINESS_TIMEZONE`); los filtros de fecha de la bandeja siguen en Buenos
  Aires (`APP_TIMEZONE`). Los filtros de Runs y Acciones usan la de la app; los
  de Costos y los topes, la del negocio. Unificar, idealmente con
  `workspaces.timezone`.
- **El backlog de 578 conversaciones inactivas** sigue abierto a propósito.
  Cerrarlas a mano las resume una por una (una llamada al modelo cada una):
  conviene hacerlo de a pocas o con un script puntual.
