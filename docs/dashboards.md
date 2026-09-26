# Dashboards de Chat (Fase 3, Bloque 3)

Métricas de la operación de chat. Todo se calcula con funciones SQL
`SECURITY INVOKER` (migración 00078): se llaman con el cliente del usuario, así
la RLS aplica el scope de leads sin lógica extra en la app. Un Member ve solo
sus conversaciones; Owner y Admin, todo el workspace.

## Funciones

| Función | Qué devuelve |
|---|---|
| `chat_episodes(ws, channel)` | Un episodio por (conversación, tramo). Un episodio arranca con un entrante que es el primero o viene tras una inactividad mayor que `close_after_inactive_hours`. Da `first_inbound_at`, `first_outbound_at`, `first_outbound_origin`. |
| `chat_dashboard_numbers(ws, from, to, channel, author)` | Conversaciones nuevas, recibidos, enviados (filtrados por autor), mediana de primera respuesta. |
| `chat_waiting_now(ws, channel)` | Conversaciones abiertas con último mensaje entrante de hace más de 1 h, sin `do_not_contact` ni etiqueta que apague al agente. |
| `chat_dashboard_agent(ws, from, to, channel)` | Sobre las conversaciones nuevas: actuó, tomó desde el primer mensaje, derivó. |
| `chat_dashboard_team(ws, from, to, channel)` | Una fila por autor (agente, external, cada persona): salientes, medianas de primera respuesta y de respuesta, % < 1 h. |
| `chat_dashboard_trends(ws, from, to, channel, author, tz)` | Serie diaria: recibidos, enviados, conversaciones nuevas. La app agrupa a semanal si el período supera 62 días. |
| `chat_author_match(author, origin, sent_by_user)` | Helper del filtro "respondido por". |

El período anterior se calcula en la app (`lib/dashboards/period.ts`
`previousPeriod`) y se pide como otro rango de igual duración.

## Verificación

`node scripts/verify-dashboards.mjs` crea un workspace con Owner, Member A,
Member B, un agente, un canal y 6 conversaciones con fechas fijas, llama a las
funciones reales y compara contra los valores calculados a mano (incluido el
caso del Member A, que ve solo las conversaciones 1 y 3). Limpia al terminar.
Correr los scripts `verify-*` de a uno: comparten el prefijo `zz-test-` y la
limpieza de uno colisiona con el arranque del otro si se encadenan.

## Episodios vs. conversaciones

Al 26/9/2026 la base tiene 593 conversaciones. La cantidad de episodios reales
(que es la base de "conversaciones nuevas") se mide con `chat_episodes` cuando
el agente esté prendido y haya datos de operación; con el volumen actual la
diferencia viene sobre todo de conversaciones reabiertas tras inactividad.

## Rendimiento

Las funciones recorren `messages`/`conversations` con índices por
`(workspace_id, created_at)` y `(conversation_id, created_at)`. Con el volumen
actual (~2.400 mensajes) responden muy por debajo del objetivo de 1,5 s. Si al
crecer no se cumpliera, se mide y se anota antes de construir agregados (§14);
no se crean tablas de agregados todavía.
