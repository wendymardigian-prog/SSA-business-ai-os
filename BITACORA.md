# Bitácora del proyecto

Registro de qué se construyó, qué se decidió y por qué. Se actualiza al cerrar
cada bloque.

---

## Etapa 1 · Fase 3 · Bloque 1 — Persistencia de mensajes

**Fecha:** 11 de septiembre de 2026
**Alcance:** F19, F20 y F21 del documento de requerimientos de la Fase 3.

**Qué se construyó:** los mensajes entrantes de todos los canales ahora se
guardan en la base. Hasta acá los DMs de Instagram no se guardaban —Zernio era
la fuente de verdad y la bandeja le pedía el hilo en vivo—, y eso bloqueaba las
dos cosas que vienen: el agente lee el historial de la base, y los dashboards se
arman con un GROUP BY sobre la tabla local.

Es **dual-write**: se guarda en paralelo y la bandeja sigue leyendo de Zernio.
No se cambió la fuente de lectura.

### El hallazgo que cambió el diseño

Había **tres espacios de identificadores** conviviendo, y elegir mal habría
duplicado todo:

| Camino | Qué id usa |
|---|---|
| `recordSend` al enviar | id de Zernio |
| `toInboxMessage` al leer | id de Zernio |
| El endpoint de historial (backfill) | id de Zernio — **y no devuelve el nativo** |
| El webhook | trae **los dos** |

Si el receptor hubiera guardado `msg.platformMessageId` (el id nativo de Meta),
el índice único no habría servido para nada: el backfill trae el id de Zernio,
así que para Postgres serían dos filas distintas y cada corrida habría insertado
una copia de cada mensaje. **El que deduplica es el de Zernio.**

El nativo igual se guarda, en `platform_native_message_id`: es el único handle
para un pedido de borrado o un reclamo ante Meta, y el endpoint de historial no
lo devuelve — lo que no se guarde cuando entra el webhook se pierde para
siempre.

### Decisiones y por qué

| Decisión | Por qué |
|---|---|
| **`workspace_id` sí**, llenado por un trigger de base | Los dashboards agrupan por día/canal/dirección sobre la tabla que más va a crecer; sin la columna, cada consulta arrastra un join. El trigger y no el código porque hay **seis** inserts dispersos que no pasan por `insertMessage`: confiar en acordarse seis veces es confiar en la séptima |
| **`deleted_at` no**: el borrado es físico | Las FK en cascada ya se llevan los mensajes cuando `purge_soft_deleted` borra el contacto. Y un soft delete sobre un DM deja el texto del lead en la base *aparentando* estar borrado, que es lo contrario de lo que las reglas de retención de Meta piden cumplir |
| La policy **suma** el filtro de workspace, no reemplaza el `EXISTS` | Ese `EXISTS` sobre `conversations` es de donde sale **todo** el scope de leads de los mensajes (una subconsulta dentro de una policy pasa por la RLS de la tabla que consulta). Cambiarlo por `is_workspace_member(workspace_id)` se habría leído como una simplificación equivalente y habría dejado a cualquier Member ver los mensajes de todos los leads |
| UPDATE y DELETE **siguen sin policy** | Con RLS activa y sin policy ya están denegadas, y para una tabla que es un log esa es la postura correcta. La purga corre `SECURITY DEFINER` y no las necesita. Queda documentado en un `COMMENT` para que se lea como decisión y no como olvido |
| El interruptor es una **columna en `workspaces`** | Mismo patrón que `lead_scope_enabled`. Un interruptor que existe por una duda legal tiene que apagar sin deploy — y se lee **sin cachear**, porque tiene que apagar cuando se lo apaga, no cuando venza un TTL |
| El trigger de inactividad **sigue con `last_interaction_at`** | Mide lo que el trigger pregunta, y lo llenan los dos receptores **aunque el guardado esté apagado**. Si contara mensajes, apagar el interruptor rompería una automatización que hoy funciona |
| "No contactar" **no borra** mensajes | Dice que no le escribamos más, no que borremos lo que dijo. El operador necesita ese contexto para no repetir el error |
| El backfill **no trae los mensajes borrados** por el remitente | Zernio conserva el texto aunque la persona lo haya dado de baja. Traerlo a propósito iría contra las reglas de Meta que la política de esta fase se compromete a honrar |

### Lo que la exploración corrigió sobre el plano

- **El límite real del historial no es un parámetro nuestro:** Meta replica 500
  conversaciones por cuenta y 500 mensajes por conversación. Lo anterior no lo
  tiene nadie. El backfill conviene correrlo **dos veces con días de
  diferencia**, porque el replay de Meta termina en segundo plano (lo advierte
  el propio SDK).
- **Zernio informa estados que el CHECK de la columna rechaza** (`read`,
  `deleted`). Sin mapearlos, un lote entero del backfill se caía.
- **El Realtime de la bandeja escucha `conversations`, no `messages`**, así que
  el dual-write es invisible para la UI. Era la duda principal sobre si guardar
  en paralelo podía duplicar burbujas.

### Migraciones

| # | Qué crea |
|---|---|
| 00053 | `messages.workspace_id` + trigger + backfill, `sent_by_agent_id` (sin FK: `agents` es del Bloque 2), índices para los dashboards, y `workspaces.persist_zernio_inbound` |
| 00054 | RLS de `messages` con el filtro de workspace **sumado** al `EXISTS` |
| 00055 | `purge_old_messages(12)` + cron a las 5:00 (los seis slots de las 4 ya estaban tomados) |
| 00056 | `platform_native_message_id` |
| 00057 | `purge_zernio_inbound_messages`: la otra mitad del interruptor |

### Scope de leads

Probado en los **dos** sentidos, que es lo que el caso pedía: un Member no ve
los mensajes de un lead ajeno, **y sí ve los de su propia conversación**. El
segundo check se agregó a `verify-rls.mjs` a propósito — una condición de más en
una policy puede negar acceso legítimo tan fácil como una de menos, y sin esa
línea un `workspace_id` mal completado se habría visto como "todo verde".

### Verificación

- 731 tests de vitest (26 nuevos), `npx tsc`, `npm run build` y `npm run lint`
  sin errores.
- `verify-message-persistence.mjs` (nuevo, 16 checks contra la base real): el
  trigger completa la columna, **el mismo mensaje no entra dos veces**, el mismo
  id en otra conversación sí entra, la retención borra el de 13 meses y respeta
  el de 11, y borrar el contacto se lleva sus mensajes.
- `verify-rls.mjs` en verde, con el check nuevo.
- El backfill corrido en seco contra la API real: 20 mensajes de 3
  conversaciones.
- El linter de seguridad de Supabase no reporta ninguna de las tres funciones
  nuevas.

### Deuda anotada

- **El backfill no se corrió en firme.** Queda listo; correrlo con `--apply`
  escribe el contenido de los DMs y los términos de Zernio/Meta siguen sin
  confirmarse. Es una decisión de Wendy, no del código.
- **La pantalla de Ajustes se verificó por compilación, no a ojo.** La app pide
  login y no se ingresan credenciales — el mismo límite que ya tenía anotado el
  Bloque 1 de la Fase 2.
- **`sent_by_node_id` sigue sin escribirse nunca.** Está declarado desde la
  00001. Es del Bloque 2, cuando el agente necesite la trazabilidad fina.
- **Tres sistemas siguen recibiendo los mismos DMs de @wenmardigian.** Ahora
  además este los guarda. Va junto con la confirmación de términos.

### Para el Bloque 2

- La constraint de `messages.sent_by_agent_id` está pedida en un comentario
  dentro de la 00053, para agregarla cuando exista la tabla `agents`.
- `messages.agent_run_id` no se creó: va con la tabla de runs.
- `docs/flujo-de-mensajes.md` documenta el flujo completo, los dos ids, la
  retención y el interruptor.

---

## Etapa 1 · Fase 2 · Bloque 1 — Flow builder y triggers

**Fecha:** 8 de septiembre de 2026
**Alcance:** F1 a F8 del documento de requerimientos de la Fase 2.

### Estado del prerrequisito al arrancar

El receptor único de webhooks ya funcionaba: Zernio entrega en
`https://ssa-business-ai-os-production.up.railway.app/api/webhooks/late`, con el
secreto que coincide, y la cadena `route.ts → runInboundAutomation →
matchTrigger → executeFlow` corre de verdad (verificado contra la API de Zernio
y contra la base, no solo contra el código).

Lo que faltaba era retirar la Edge Function, que seguía desplegada pero
huérfana: no estaba registrada en Zernio, así que no recibía nada.

### Qué se hizo

**1. Edge Function retirada.** Se borró `supabase/functions/` (866 líneas), la
entrada de `config.toml` y el despliegue. Se corrigieron los comentarios que
afirmaban lo contrario de la realidad (`lib/zernio-webhook.ts` decía que la URL
registrada "hoy es la Edge Function"). Verificado: el endpoint devuelve 404,
igual que uno inexistente.

**2. Los cron jobs pasaron a pg_cron.** Estaban declarados en `vercel.json`, que
Vercel lee y Railway no. La app está en Railway: **no los corría nadie**. Eso no
era configuración pendiente, era funcionalidad apagada — un nodo Delay paraba el
flow para siempre y las secuencias no avanzaban.

Ahora los agenda `pg_cron` dentro de la base. Las rutas de la app se llaman con
`pg_net` y el secreto en el header `Authorization` (no en la query string, que
queda escrita en los logs del proxy). La purga de borrados se llama directo en
SQL, sin dar la vuelta por HTTP. `private.call_app_cron` solo acepta rutas de
una lista blanca: sin eso sería un trampolín para pegarle a cualquier URL de la
app con el secreto adjunto.

Se sumó la limpieza de `net._http_response`, donde pg_net guarda cada respuesta
HTTP: con dos jobs por minuto son ~2.900 filas por día que nadie vuelve a mirar.

**3. Registro extensible de nodos, triggers y condiciones (F7).** El motor tenía
un switch de dieciocho casos, el simulador otro, y la UI cinco listas de tipos
más. Ahora cada tipo se declara en `lib/flow-engine/registry` y el motor le
pregunta al registro. `engine.ts` pasó de 1076 a 394 líneas.

**4. Se arreglaron los 11 nodos que no se ejecutaban (F1).** Este era el
hallazgo grave del bloque: el panel guarda los nodos de acción como
`type: "action"` con el tipo real en `data.actionType`, y el motor no entendía
esa forma — los tiraba por el `default` del switch. **Add Tag, Remove Tag, Set
Field, HTTP Request, Go To Flow, Human Takeover, Subscribe, Unsubscribe, A/B
Split, Smart Delay y Enroll Sequence pasaban el panel de Test y en producción no
hacían nada.** Se resolvió con alias declarados en el registro, sin migrar
flows. Hay un test por cada uno.

**5. Envío canal-agnóstico, tope horario y errores legibles (F8).** El motor solo
sabía hablar Zernio: un flow sobre WhatsApp cortaba en silencio. Ahora hay una
sola puerta de salida que ramifica por `channels.provider`. Se agregó el tope de
200 mensajes automatizados por hora de Instagram, con el contador reclamado en
la misma sentencia que lo verifica (un SELECT y después un UPDATE dejarían que
dos envíos simultáneos leyeran 199 los dos). Y los rechazos de la API se
traducen a castellano: la causa más común es la ventana de 24 horas, que no es
un error del sistema sino una regla de la plataforma.

**6. BYOK real en el nodo AI Response (F2).** Leía `workspaces.ai_api_key` —una
columna en claro, vacía— y pasaba por el AI Gateway de Vercel. Ahora usa
`integration_configs` + Vault. La key nunca sale de `lib/ai/provider.ts`. Si
falta, el flow no se rompe: corta con un aviso legible y distingue "no hay
proveedor" de "falta la key" de "falló la generación".

**7. Los cuatro triggers nuevos (F3–F6).** Ninguno toca `engine.ts`: se
implementaron a través del registro, que es la prueba viva de que el patrón
sirve.

**8. RLS de `triggers` endurecida.** Las policies que venían de ZernFlow daban
`FOR ALL` a cualquier miembro del workspace: un Member podía crear, editar y
borrar los triggers de cualquier flow. Un trigger decide qué automatización le
contesta a un lead; pasó a ser cosa de Owner/Admin, como publicar un flow.

### Decisiones y por qué

| Decisión | Por qué |
|---|---|
| Los eventos de CRM se detectan en la **base**, con triggers de Postgres | Un contacto se crea por tres caminos y los tags se agregan desde cuatro lugares. Emitirlos en el código significa acordarse en cada lugar, hoy y en cada camino nuevo. En la base se captura una vez. |
| Pero **no** disparan el flow desde la base: encolan | El motor manda mensajes y llama a la IA; nada de eso se puede hacer desde plpgsql. Y si fuera sincrónico, un flow lento frenaría el guardado del contacto. |
| F6 no es un tipo de trigger nuevo | Es un filtro dentro del config del trigger de palabra clave, como pide el requerimiento. Un tipo aparte duplicaría el matcher. |
| Idempotencia con una sola tabla `trigger_fires` | Los tres triggers nuevos necesitan lo mismo; cambia solo qué es "el mismo motivo". El índice único es lo que decide, así que dos corridas del cron chocan en la base y no en la lógica. |
| Inactividad se mide por `contacts.last_interaction_at` | Los mensajes entrantes de Instagram no se guardan localmente: contar la tabla `messages` daría siempre cero. |
| Anthropic como proveedor de IA | Decisión de negocio. Sirve para el nodo AI Response. Los embeddings del Bloque 3 van con **Voyage AI**, ya decidido. |

### Scope de leads

El disparo lo hace el sistema, sin usuario. Se respeta el scope porque **el
evento solo puede nacer de un cambio que la RLS ya permitió**: un Member no
puede tocar un lead que no ve, así que no puede generar un evento sobre él. La
barrera está antes, en la escritura.

### Migraciones

| # | Qué crea |
|---|---|
| 00036 | pg_cron, pg_net, `private.system_config`, `call_app_cron()`, los jobs |
| 00037 | tope de envíos por canal y por hora |
| 00038 | tipos nuevos de trigger, `workspace_id`, RLS endurecida, `trigger_fires` |
| 00039 | `automation_events` y los triggers de Postgres del CRM |
| 00040 | arreglo: un trigger de la 00039 escuchaba una columna generada y nunca iba a dispararse |

Todas aplicadas y verificadas contra la base real.

### Deuda anotada (fuera del alcance de este bloque)

- **`scheduled_jobs` tiene la RLS abierta.** Las policies de la migración 00009
  permiten a *cualquier usuario autenticado* leer, insertar y actualizar la cola
  entera, y la tabla no tiene `workspace_id`. Hoy los payloads incluyen
  variables de flow. **No se tocó porque está fuera del alcance del bloque**,
  pero conviene cerrarlo: agregar `workspace_id` y limitar las policies.
- **`goToFlow` no vuelve al flow original** y abre una segunda sesión para el
  mismo contacto. El campo `returnAfter` está declarado y se ignora. Volver
  requiere usar la columna `flow_stack` de `flow_sessions`, que existe y está sin
  usar: es más que un arreglo puntual.
- **Tres sistemas reciben los mismos DMs de @wenmardigian**: este OS, `WenOS` y
  `Agente Chat`. Antes de dejar automatizaciones encendidas en serio hay que
  decidir qué hacer con los otros dos.
- **La verificación visual de la bandeja** (aviso de conversación enfriada,
  burbuja de envío rechazado) quedó sin hacer: la app pide login y no se ingresan
  credenciales.

---

## Etapa 1 · Fase 2 · Bloque 2 — Secuencias

**Qué se construyó:** F9 a F15. Los seguimientos automáticos: pasos con
intervalos, pasos generados con IA, auto-pausa cuando el lead contesta,
detección de colisión, inscripción manual, y la condición "¿está en la
secuencia X?" en el flow builder.

### Lo que el plano daba por hecho y no estaba

El documento marca F9, F11, F12 y F15 como "verificación". El módulo del fork
estaba bastante más crudo:

| # | Qué encontramos | Consecuencia real |
|---|---|---|
| 1 | **La auto-pausa al responder no existía.** Solo se pausaba con una frase de baja ("stop") o con la marca "no contactar" | Si el lead contestaba "gracias, lo veo mañana", el drip le seguía mandando pasos |
| 2 | El procesador mandaba **por Zernio hardcodeado**, sin pasar por `sendChannelMessage` | Sin tope de 200 msg/hora, sin WhatsApp, con los errores de la API crudos |
| 3 | Un envío fallido **avanzaba el paso igual** (`return` sin `throw`) | El mensaje se perdía sin traza y el lead no lo recibía nunca |
| 4 | El cron **no reclamaba** lo que procesaba | Dos corridas solapadas mandaban el mismo DM dos veces |
| 5 | Pausar una secuencia **cancelaba** sus inscripciones, irreversible | Y con el `UNIQUE` viejo tampoco se podía re-inscribir al contacto |
| 6 | **Cero chequeo de rol**, ni en código ni en RLS | Un Member podía activar, editar o borrar cualquier secuencia |
| 7 | El nodo Condition dibujaba `yes`/`no` y el motor buscaba `true`/`false` | Las condiciones armadas a mano nunca ramificaban. Bloqueaba F14 |
| 8 | El panel del Condition guardaba `tag` y el registro busca `tag:<nombre>`, sin campo para el argumento | **Ninguna** condición del builder resolvía |

Todo eso se arregló: eran las condiciones para que F9–F15 funcionen de verdad.

### Decisiones tomadas

| Decisión | Por qué |
|---|---|
| Re-inscripción permitida | El `UNIQUE(sequence_id, contact_id)` pasa a índice único **parcial** sobre `active`/`paused`. Un contacto que ya terminó puede volver a entrar; no puede estar dos veces a la vez |
| Pausar la secuencia **pausa** sus inscripciones | Reversibles, con motivo visible y botón Reanudar. Tocar un botón no puede matar el seguimiento de todos |
| El opt-out no se reanuda nunca | Volver a escribirle a quien pidió que no lo contacten es una decisión explícita: se re-inscribe, no se destraba |
| La generación con IA se extrajo a `lib/ai/generate-reply.ts` | El nodo AI Response dependía de `FlowExecutionContext` + `sessionId`. Una secuencia no tiene ninguno, y `messages.sent_by_flow_id` tiene FK a `flows`: un contexto inventado rompe el insert |
| Un solo mensaje por (contacto, canal) por tick | Varias secuencias a la vez son deliberadas (F12); que coincidan en el mismo minuto es casualidad del cronograma. La segunda espera |
| Un paso de IA que falla se reintenta y se saltea | Perder un paso es malo; matar el seguimiento entero por una key vencida es peor |
| El tope horario reprograma **sin** gastar intento | No es culpa del paso |
| La colisión se resuelve por query, con columnas y sin tabla | No es una entidad con vida propia: es una propiedad de la inscripción en el momento en que se creó |
| `collision_with` guarda un **snapshot** con el nombre | Para que el aviso siga siendo legible después de que la otra inscripción se cancele o la secuencia se renombre |
| El nodo Enroll **inscribe igual** ante una colisión | Una automatización no puede frenarse a preguntarle a una persona. Deja la marca para que un admin decida |
| La condición usa el **ID** de la secuencia, no el nombre | Los nombres se editan; un flow no puede romperse porque alguien renombró algo |

### Enganche para el Bloque 3

El centro de notificaciones **no** se adelantó. La colisión se ve hoy en la
pantalla de secuencias (aviso ámbar con las tres decisiones, badge por fila y
contador en la tarjeta). Quedan dos costuras listas:

- `listOpenCollisions(supabase, { workspaceId })` — la consulta que el centro
  va a querer, escrita una vez.
- Cada detección escribe `analytics_events` (`sequence_collision_detected`) y
  `audit_log` (`collision_detected`).

### Scope de leads

`sequence_enrollments` colgaba de `sequences`, así que había quedado fuera del
scope de la 00018/00024: un Member veía y cancelaba inscripciones de contactos
que la RLS le esconde en todas las demás pantallas. Ahora las policies exigen
además `can_see_contact` sobre el contacto de la inscripción.

### Migraciones

| # | Qué crea |
|---|---|
| 00041 | CHECK de los dos `status`, RLS por rol en `sequences`, scope de leads en `sequence_enrollments`, unique parcial para la re-inscripción |
| 00042 | Columnas de corrida (`paused_reason`, `attempt_count`, `locked_at`…) y `claim_sequence_enrollments()` con `FOR UPDATE SKIP LOCKED` |
| 00043 | Columnas de colisión y los dos índices parciales (el del aviso y el de la detección) |
| 00044 | `pause_sequences_on_reply(contacto, canal)` — la auto-pausa de F11, con su entrada en el audit log en la misma transacción |

### Deuda anotada (fuera del alcance de este bloque)

- **El cron de secuencias acepta el secreto por query string** (`?key=`) y lo
  compara con `!==`, no en tiempo constante. El webhook de Evolution ya usa
  `constantTimeEquals`; conviene unificar.
- **`goToFlow` sigue sin volver al flow original** (heredado del Bloque 1).
- **`scheduled_jobs` sigue con la RLS abierta** (heredado del Bloque 1).
- El editor de secuencias no avisa si salís con cambios sin guardar.

---

## Etapa 1 · Fase 2 · Pasada de seguridad y deuda técnica

**Qué se hizo:** ni features ni pantallas. Se corrió el linter de seguridad de
Supabase, se verificó **cada hallazgo contra la base real** (`has_function_privilege`,
`pg_policies`, `pg_get_functiondef`) y se cerró lo que era un agujero de verdad.
Más los cuatro ítems de deuda que quedaron anotados en los Bloques 1 y 2.

El linter pasó de **40 hallazgos a 15**, y los 15 están documentados en
[docs/seguridad-advertencias-aceptadas.md](docs/seguridad-advertencias-aceptadas.md).
Las dos categorías que importaban quedaron en cero: ninguna función
`SECURITY DEFINER` es ejecutable por `anon`, y ninguna tiene el `search_path` sin fijar.

### Agujeros reales que se cerraron

| Qué | Gravedad | Qué permitía |
|---|---|---|
| **`scheduled_jobs` con RLS abierta** (migración 00046) | Alta | Sus 3 policies decían `auth.uid() IS NOT NULL`: *cualquier usuario logueado*, no "de este workspace" — la tabla no tiene `workspace_id`. El payload de los jobs `resume_flow` lleva `contactId`, los ids de Zernio y `variables`, que arrastra **el texto del DM del lead**: fuga de conversaciones entre negocios distintos. El UPDATE abierto además dejaba colgar todos los flows con un nodo de espera |
| **`increment_unread` + los dos contadores de broadcast** (00045) | Media | `SECURITY DEFINER`, sin guard, ejecutables por `anon` — la key pública que va en el frontend. Reabrir conversaciones ajenas y escribir texto arbitrario en `last_message_preview`, que es lo que se pinta en la bandeja |
| **`find_or_link_contact` sin control de permisos** (00047) | Baja-media | Un Member podía llamarla por REST directo para crear o vincular contactos, salteándose el scope de leads |
| **`POST /api/v1/channels/sync` sin chequeo de rol** | Baja-media | Cualquier Member podía sincronizar los canales del workspace. Su hermana `test-key` sí exigía Owner/Admin |
| **Crons con `?key=` y comparación con `!==`** | Baja | El secreto podía terminar en los logs del proxy y en la tabla de pg_net |

### Dos cosas que la verificación corrigió

1. **Casi rompo la app.** El plan inicial revocaba `is_workspace_member` de
   `authenticated`, razonando que no tenía consumidores porque no aparece en
   ningún `.rpc()`. Falso: **37 policies sobre 23 tablas la llaman dentro de su
   propia expresión**, y una expresión de policy se evalúa con el rol de la
   sesión, no como definer. Revocarla habría hecho fallar toda lectura de la app
   con `permission denied`. Quedó un comentario en la migración 00045 y un
   canario en `verify-rls.mjs` para que nadie lo intente de nuevo.
2. **Apareció un hallazgo que no estaba en la lista**: el guard de `sync`.

### Deuda de los bloques anteriores

| Ítem | Qué se hizo |
|---|---|
| Cron con `?key=` y `!==` | Cerrado. Helper compartido (`lib/cron-auth.ts`) para las seis rutas, solo header, comparación en tiempo constante. `CRON_SECRET` ausente pasa de 401 a **500**: el 401 mentía |
| RLS de `scheduled_jobs` | Cerrado (arriba) |
| `goToFlow` / `returnAfter` | **Parcial.** Se cerró la fuga: el nodo dejaba la sesión del flow original `active` para siempre, sin que la despertara ni el cron ni un mensaje entrante. Ahora se cierra al saltar. El toggle `returnAfter` se deshabilitó, porque prenderlo no hacía nada más que producir esa sesión huérfana. **`returnAfter` de verdad sigue pendiente** — ver abajo |
| Editor sin aviso de cambios sin guardar | Cerrado, y también en el flow builder |

### Decisiones

| Decisión | Por qué |
|---|---|
| `scheduled_jobs` va a service-only, sin `workspace_id` | Ninguna pantalla lee la cola ni está planificado que lo haga. Una columna con backfill y policies que nadie usa es costo sin consumidor. Deny-all es la postura correcta por defecto: el día que se sume un job con payload sensible, ya está cerrada |
| Las funciones de Vault **no** se tocan | Su control está adentro y funciona (verificado). Sus llamadores usan cliente de usuario a propósito: es el usuario quien tiene que estar autorizado |
| Los dos clientes viajan como parámetros con nombre | En `scheduleBroadcastDelivery` y en el backfill del Inbox. Son del mismo tipo: posicionales e invertidos, TypeScript no diría nada y el bug sería justo el que la separación viene a arreglar |
| La lógica de "cambios sin guardar" va en un módulo puro | Vitest corre en `environment: node` sin jsdom, así que un hook de React no se puede testear hoy. Lo que merece test quedó afuera del hook |
| La huella del flow normaliza el grafo | React Flow escribe `selected`, `dragging` y `measured` sobre los mismos objetos, y reordena el array al seleccionar. Sin normalizar, el aviso aparecería con el primer click y alguien lo terminaría sacando |

### Migraciones

| # | Qué |
|---|---|
| 00045 | `search_path` y service-only en las RPC heredadas de la 00003; `anon` fuera de las trigger functions y de `is_workspace_member`; comentarios que explican qué NO tocar |
| 00046 | `scheduled_jobs` vuelve a deny-all, como la había dejado la 00002 |
| 00047 | `find_or_link_contact` solo para service role (desplegada aparte: su rotura sería silenciosa) |
| 00048 | `authenticated` fuera de las trigger functions, para que el linter quede legible |

### Deuda que queda anotada, a conciencia

- **`returnAfter` de `goToFlow`.** Volver al flow original necesita: reusar la
  sesión en vez de crear otra, ampliar la interfaz `FlowRuntime`, reescribir
  `completeSession` y sus **cinco** llamadores en `engine.ts`, tocar
  `resumeSession`, propagar el presupuesto de profundidad entre flows, y decidir
  qué pasa con las variables en el cruce (¿el sub-flow ve las del padre? ¿las
  que escribe vuelven?) — que es una decisión de producto sin respuesta obvia.
  La columna `flow_stack` existe desde la 00001 y nunca se leyó ni escribió; es
  ahí donde iría la pila. Toca el camino caliente del Inbox, donde un bug no se
  ve en tests: se ve como DMs que no salen. **Es su propio bloque.**
- **El aviso de cambios sin guardar no cubre la navegación interna.** Next 16 no
  expone una API estable para bloquear el App Router, así que un click en el
  sidebar sigue perdiendo los cambios. Cubierto: cerrar la pestaña, recargar,
  salir del sitio y los botones de volver. La salida correcta, si algún día
  molesta, es un provider en el layout del dashboard que el sidebar consulte.
- **Leaked password protection** sigue desactivada: es un setting del panel de
  Auth, no versionable, y activarla cambia el flujo de registro. Decisión de
  producto, anotada en el checklist de despliegue.
- **`pg_net` sigue en el schema `public`**, y así se queda: moverla exige un
  `DROP EXTENSION CASCADE` que se llevaría los seis crons por delante.
- **Tres sistemas siguen recibiendo los mismos DMs de @wenmardigian** (este OS,
  WenOS y Agente Chat). Sigue sin resolverse y sigue siendo lo primero a
  resolver antes de dejar automatizaciones encendidas en serio.
