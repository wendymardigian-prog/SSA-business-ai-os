# Diagnóstico de autoría de los salientes (F1)

**Fecha:** 26 de septiembre de 2026
**Pregunta:** ¿por qué ningún saliente de los últimos 30 días tiene autor (`sent_by_agent_id` / `sent_by_user_id` / `sent_by_flow_id`)?

## Datos (consulta de solo lectura contra producción)

| Métrica | Valor |
|---|---|
| Salientes totales | 1.580 |
| Con `sent_by_agent_id` | 0 |
| Con `sent_by_user_id` | 0 |
| Con `sent_by_flow_id` | 0 |
| Con `sent_by_node_id` | 0 |
| Con `agent_run_id` | 0 |
| Con `platform_message_id` | 1.580 (100%) |
| Con `platform_native_message_id` | **1.580 (100%)** |
| `platform_message_id` con forma de id de Zernio (`^[0-9a-f]{24}$`) | **0** |
| Estados | `delivered` 1.150, `sent` 430 |
| Rango | 11/04/2026 → 24/09/2026 |

## Conclusión: (a) todos entraron por el historial

Es la hipótesis (a) del plano, y los datos la confirman sin ambigüedad:

1. **Todos los salientes tienen `platform_native_message_id`.** Ese campo lo escribe únicamente el backfill del historial (`lib/backfill-messages.ts`, `toMessageRow`). Ningún camino de envío de la app lo setea: ni la respuesta manual (`app/api/v1/messages/route.ts`), ni el agente (`lib/agent/send.ts`), ni los flows (`lib/flow-engine/send.ts` `recordSend`). Que el 100% lo tenga significa que el 100% entró por el backfill.
2. **Ningún `platform_message_id` tiene forma de id de Zernio.** El id que devuelve `sendInboxMessage` cuando la app manda un mensaje es un id de Zernio (24 hex). Cero salientes lo tienen: todos guardan el `mid` nativo de Meta que devuelve el endpoint de historial. Refuerza lo mismo.
3. **El agente nunca corrió** (`agent_runs` = 0) y **no hay salientes con autor**, coherente con que nunca se envió nada vivo desde la app: lo que hay es el historial de conversaciones que ManyChat y la app de Instagram ya habían respondido antes de conectar el sistema.

Es decir: los 1.437 salientes de los últimos 30 días son **envíos externos** (ManyChat o la app de Instagram) traídos por el backfill. No es que la app esté perdiendo el autor: es que la app todavía no envió nada en firme.

## Pero la lectura del código encontró dos huecos reales (se arreglan en F2)

Aunque la conclusión es (a), revisando los 11 caminos de guardado aparecen dos lugares donde la app **sí** perdería autoría el día que empiece a enviar:

- **Los broadcasts no guardan ningún mensaje.** `app/api/cron/jobs/route.ts` (`send_broadcast`) llama a `sendInboxMessage` y solo actualiza `broadcast_recipients`; nunca inserta en `messages`. F2 agrega ese insert con `origin = 'broadcast'`.
- **Los flows nunca escriben `sent_by_node_id`.** `recordSend` guarda `sent_by_flow_id` pero no el nodo. F2 lo suma para poder atribuir el saliente al paso del flow.

Ninguno de los dos cambia el diagnóstico de los datos actuales (todo historial), pero los dos importan para que el `origin` del Bloque 3 sea correcto cuando el sistema empiece a operar.

## Consecuencia para F2

- El backfill de `messages.origin` marca los 1.580 como `external` (no tienen ningún `sent_by_*`).
- A partir del deploy, cada camino de envío escribe su `origin` explícito; un trigger `BEFORE INSERT` deriva el `origin` de cualquier saliente que llegue sin él (protege la base mientras la versión vieja siga desplegada).
