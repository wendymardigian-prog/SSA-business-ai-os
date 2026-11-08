# Los cron y su guarda

pg_cron corre ~32 trabajos. La mayoría llama a una ruta de la app (`/api/cron/<ruta>`) con `private.call_app_cron`, que descifra la URL y el secreto de Vault y manda un pedido HTTP. La app, al recibirlo, le hace varias consultas a la base para ver si hay algo que hacer.

Hasta la 00327 eso pasaba ~16.500 veces por día aunque no hubiera nada: `agent-bursts` y `send-queue` cada 15 segundos (~5.600 veces cada uno), `jobs`, `sequences` y `automation-events` cada minuto. El 8/11/2026 la base quedó "Unhealthy" con el plan chico. La medición de ese día está en «Antes y después».

## Cómo funciona la guarda (00327)

```
pg_cron (cada 15 s / 1 min)
  └─ private.call_app_cron_if_work('<ruta>', interval '<seguridad>')
       ├─ private.cron_has_work('<ruta>')   -> private.cron_work_<ruta>(now())
       ├─ private.cron_guard_decide(...)   -> ¿hay trabajo, o pasó la llamada de seguridad?
       └─ si sí: private.call_app_cron('<ruta>')   (la de siempre, sin tocar)
```

- **La guarda copia el `WHERE` del handler.** Cada `private.cron_work_<ruta>` mira lo mismo que el código de `app/api/cron/<ruta>` (o la función de `lib/` que llama). Al lado de cada condición dice de qué constante sale.
- **Mira 5 segundos hacia adelante.** La app recibe la llamada un instante después, así que un límite de arriba (`run_at <= ...`) usa `now() + 5 s`. Uno de abajo (lo de los últimos 14 días) usa `now()`, para no quedarse corta.
- **Ante la duda, llama.** Si la guarda falla o devuelve NULL (una ruta sin guarda), se llama a la app.
- **La llamada de seguridad.** Aunque la guarda diga que no hay nada, cada cron llama una vez cada tanto: si la guarda se equivoca, se pierde ese rato, nunca el trabajo. 10 minutos para los que corren cada 15 s, cada minuto o cada 2; 1 hora `whatsapp-health` y `drafts-refresh`; 2 horas `inactivity`; 1 día `bg-collect`.
- **El estado es UNLOGGED** (`private.cron_guard_state`): la última llamada y dos contadores (llamadas y salteadas) por ruta. No escribe WAL; si la base se reinicia de golpe se vacía, y el primer tic de cada cron llama.

## Qué mira cada guarda

| Cron | Cada | Llama si… | Lo cubre la llamada de seguridad |
|---|---|---|---|
| `agent-bursts` | 15 s | hay un turno del agente vencido; uno trabado en `processing` hace más de 6 min; o una corrida de IA (de cualquier origen) abierta hace más de 10 min | — |
| `send-queue` | 15 s | un destinatario en `sending` hace más de 5 min; un broadcast programado cuya hora llegó; o un broadcast enviándose cuyo carril no está en pausa y ya puede mandar (o todavía no tiene carril) | — |
| `automation-events` | 1 min | hay un evento sin procesar | — |
| `sequences` | 1 min | una inscripción activa con el paso vencido y sin reclamar (o reclamada hace más de 5 min) | — |
| `jobs` | 1 min | un job vencido (o reclamado hace más de 5 min) que no sea un turno del agente ni una subida larga; un documento de Conocimiento borrado hace más de 30 días; una publicación colgada en "publicando" hace más de 30 min; una agendada en el proveedor cuya hora pasó hace más de 15 min; una transcripción colgada hace más de 10 min; una conversación para cerrar por inactividad (la misma consulta que la app); un envío de webhook propio sin procesar | borrar `webhook_events` de más de 48 h (casi siempre hay alguno) |
| `content-upload` | 2 min | una subida larga o un agendado en el proveedor vencido (o reclamado hace más de 10 min) | — |
| `drafts-refresh` | 5 min | hay un borrador pendiente o fallido | el aviso de salud del refresco (avisa a lo sumo una vez por día) |
| `whatsapp-health` | 5 min | hay algún número de Evolution | — |
| `inactivity` | 15 min | hay algún disparador de inactividad activo en un flujo publicado | — |
| `bg-collect` | 15 min | nunca: la ruta todavía no hace nada | — |

**Sin guarda, a propósito:** `bg-dispatch` y `metrics-sync` deciden por la hora de cada negocio con reglas de TypeScript (`planDispatch`, `isSyncHour`); copiarlas al SQL sería una gemela más para 120 llamadas por día. `social-token-refresh` y `content-media-cleanup` corren una vez por semana y por día.

## Lo que no se puede romper

- **Si un handler cambia, cambia su guarda.** `lib/cron/guards.test.ts` lo controla de tres maneras: cada umbral del SQL sale de la constante del código (`STALE_CLAIM_MS`, `STUCK_AFTER_MINUTES`…); los tipos de job excluidos son los del código; y una "alarma" lista lo que llama cada handler (`await algo(...)`, `.from("tabla")`, `.rpc("funcion")`). Si un handler suma un barrido o una cola, el test falla hasta que alguien lo agregue a la guarda (en una migración nueva) o anote por qué lo cubre la llamada de seguridad (`coveredBySafetyCall` en `lib/cron/guards.json`).
- **Un cron nuevo que llama a la app** va con guarda (en `lib/cron/guards.json` y en su migración) o en `UNGUARDED_CRONS` con el motivo. El test exige que cada ruta de `call_app_cron` esté en una de las dos listas.
- **`private.call_app_cron` no se reescribe para esto**: la guarda la envuelve.
- **La decisión tiene gemelas**: `private.cron_guard_decide` y `shouldCallCron` (`lib/cron/guards.ts`), con `lib/cron/guard-decide.cases.json`.
- **En la plantilla de estudiantes** `private.cron_work_jobs_extra` (lo que suman los módulos opcionales al cron de `jobs`) devuelve `false`: la poda la redefine.

## Realtime

La publicación `supabase_realtime` tiene exactamente las tablas que escucha la interfaz con `postgres_changes`: la lista es `lib/realtime/tables.ts`, y `lib/realtime/tables.test.ts` la compara con el código. Cada cambio de una tabla publicada lo decodifica Realtime aunque nadie la escuche. **`messages` salió en la 00327**: la bandeja escucha `conversations` y vuelve a pedir el hilo. Sumar una tabla: agregarla a la lista, escucharla y publicarla en una migración.

## Purgas

- `scheduled_jobs`: `private.purge_scheduled_jobs(30, 90)` cada día a las 04:35 UTC. Borra completados y cancelados de más de 30 días, y fallidos de más de 90. Los pendientes y los que están corriendo, nunca. Ningún código consulta jobs terminados viejos: las claves de dedupe que se miran llevan la fecha o la ventana de hoy.
- `cron.job_run_details`: 1 día (antes 3). Con la purga diaria quedan entre 24 y 48 horas, suficiente para medir un día entero.

## Antes y después

`node scripts/measure-cron-load.mjs` (solo lee; desde la carpeta vinculada con la CLI) muestra las corridas de cada cron, las llamadas a la app y las que salteó la guarda, los pedidos HTTP y lo que lleva Realtime.

Antes (24 h hasta el 8/11/2026 04:45 UTC):

| | |
|---|---|
| Corridas de pg_cron | 18.039 (11.612 s en total) |
| Llamadas a la app | 16.551 |
| `send-queue` / `agent-bursts` | 5.606 / 5.598 |
| `jobs` / `automation-events` / `sequences` | 1.437 cada uno |
| `content-upload` | 719 |
| Realtime leyendo cambios | ~2 por segundo, 8 ms cada una |

Estimación con lo que hubo ese día (tics con trabajo + llamadas de seguridad): ~2.400 llamadas por día, un 85 % menos.

La 00327 se aplicó el 8/11/2026 a las 05:08 UTC. En los primeros 10 minutos todas las corridas salieron bien. Llamadas a la app sobre corridas: `agent-bursts` 2 de 41, `send-queue` 2 de 41, `jobs` 2 de 10, `automation-events` y `sequences` 1 de 10, `content-upload` 1 de 5. Las corridas de pg_cron siguen siendo las mismas (cambia lo que hace cada una: una consulta de milisegundos en vez de un pedido HTTP).

## Verificación

```
node scripts/verify-cron-guards.mjs     # la decision SQL = TS, los comandos de cada cron, permisos, Realtime, y cada guarda con y sin el dato justo
node scripts/measure-cron-load.mjs      # antes y despues (solo lee)
```

`verify-cron-guards` arma sus datos de prueba en una transacción que se deshace (con fecha del año 2000, para que los datos reales no se vean): no deja nada y no necesita el candado de los otros `verify-*`.
