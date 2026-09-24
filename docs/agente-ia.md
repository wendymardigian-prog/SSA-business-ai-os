# Agente de IA conversacional

Fase 3, Bloques 2a y 2b. El motor del agente que conversa con los leads: el
loop, sus límites, sus herramientas con parámetros, su memoria por contacto,
el registro de lo que hace y lo que gasta, y la convivencia con los flows.

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
| `etiquetar_contacto` | Lista blanca de tags (solo de `tags`, **nunca crea**); si puede quitar. Sin tags en el workspace, no se puede habilitar y la pantalla dice por qué |
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

## Lo que no está resuelto

- **Respuestas dadas fuera del sistema.** Si alguien contesta desde la app de
  Instagram (no desde la bandeja), el sistema no se entera: el webhook de Zernio
  descarta los salientes. El agente no se apaga solo en ese caso.
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
