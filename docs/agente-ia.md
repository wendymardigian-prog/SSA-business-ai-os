# Agente de IA conversacional

Fase 3, Bloque 2a. El motor del agente que conversa con los leads: el loop, sus
límites, su acceso a la base de conocimiento, el registro de lo que gasta y la
convivencia con los flows.

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

## Las tres palancas y el estado efectivo

| Palanca | Dónde | Quién la toca |
|---|---|---|
| Encendido global | `agents.is_enabled` | Owner/Admin en Agentes. Un tope de gasto con acción "apagar" |
| Maestro por canal | `agents.enabled_channel_ids` | Owner/Admin en Agentes → Canales. Un canal, un agente |
| Por conversación | `conversations.agent_enabled` | Cualquiera en su scope, desde la bandeja. Se apaga solo al derivar o al responder a mano |
| Pausa de un flow | `conversations.agent_paused_until` | Nodos "Pausar / Reanudar agente IA". Reanudar nunca prende lo que nadie prendió |

El estado efectivo **no se guarda**: se deriva en `resolveAgentState`
(`lib/agent/config.ts`). `is_automation_paused` gobierna los flows, no al agente.

## Los tiempos

- **Ventana de silencio** (`bundle_window_seconds`, 60 s): cada mensaje nuevo la
  reinicia.
- **Demora** (`response_delay_seconds`, 20 s): después de que cierra la ventana.
- **Tope de espera** (`max_wait_seconds`, 300 s): se congela en el primer mensaje.

El job se agenda un tic (15 s) antes de que cierre la ventana. El turno espera en
proceso hasta el **objetivo absoluto** `último mensaje + ventana + demora`: la
demora absorbe el tic del cron y la generación. El total es exactamente
ventana + demora (±1 s) mientras el tic más la generación entren en la demora; si
no, sale apenas termina, nunca antes. Si el lead escribe durante esa espera, se
envía ya.

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

Cada entrada declara nombre, descripción, schema de entrada y schema de su
configuración. El paso del run lo escribe el wrapper; la herramienta escribe el
efecto de negocio en `audit_log` con `performed_by_agent_id`.

| Herramienta | Bloque |
|---|---|
| `derivar_a_humano` (obligatoria) | 2a |
| `buscar_en_conocimiento` (si la KB está prendida) | 2a |
| etiquetar, temperatura, seguimiento, asignar, buscar en CRM, pausarse | 2b: una entrada nueva cada una |

## Runs y costos

- Toda llamada a IA pasa por `openAiRun` (`lib/ai/run.ts`): agente, nodo AI
  Response (`flow_ai_node`), pasos de secuencia (`sequence_ai_step`), indexación
  (`kb_indexing`).
- El costo se congela al cerrar con el precio vigente de `model_pricing`. Sin
  precio, el run se guarda con costo null y el aviso. **La tabla se siembra con
  `supabase/seeds/00_model_pricing.sql` y hay que revisarla al cambiar de modelo.**
- Costos: privilegio de columna (00060). Con el cliente de un usuario nunca
  `select("*")` sobre `agents` ni `agent_runs`: usar las constantes de
  `lib/agent/public.ts`. Los costos se leen del servidor con service role.

## Visibilidad de errores

`conversations.last_agent_error_at / _run_id` + aviso en la campana + run, cuando
el turno termina en error, se descarta (job vencido, timeout) o fallan los dos
modelos. Se borra con una respuesta buena del agente, un mensaje de una persona o
el cierre de la conversación. En la bandeja: filtro "Con error del agente" y un
punto rojo que lleva al run.

## Lo que no está resuelto

- **Respuestas dadas fuera del sistema.** Si alguien contesta desde la app de
  Instagram (no desde la bandeja), el sistema no se entera: el webhook de Zernio
  descarta los salientes. El agente no se apaga solo en ese caso.
- **WhatsApp:** los ecos de lo que manda el propio sistema llegan como `fromMe`,
  y no se distinguen de forma confiable de una respuesta desde el teléfono. Hoy
  un `fromMe` no apaga el agente. Revisar cuando se conecte el número.
- **Zona horaria:** el agente corta días y horarios en Costa Rica
  (`BUSINESS_TIMEZONE`); los filtros de fecha de la bandeja siguen en Buenos
  Aires (`APP_TIMEZONE`). Unificar, idealmente con `workspaces.timezone`.
