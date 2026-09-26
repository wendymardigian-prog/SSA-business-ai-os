# Bitácora del proyecto

Registro de qué se construyó, qué se decidió y por qué. Se actualiza al cerrar
cada bloque.

---
## Etapa 1 · Fase 3 · Bloques 2e y 3 — Verificación, reglas, dashboards, patrones e intención

**Fecha:** 26 de septiembre de 2026
**Alcance:** el documento `docs/requerimientos-fase3-bloques-2e-3.md` (v1.1), F1 a F26,
en cinco bloques. Corrida autónoma en la rama `oneshot-fase3-2e-3`. El agente
sigue **apagado**.

**Qué se construyó (por bloque):**
- **Bloque 1 (F1-F4):** `messages.origin` con un builder único (`lib/messages/outbound.ts`)
  en los 11 caminos de envío; los broadcasts ahora guardan su saliente; suscripción
  a `message.sent` de Zernio; `workspaces.timezone`; `normalize_for_grouping` con
  paridad exacta SQL/TS. Backfill: 1580 salientes `external`.
- **Bloque 2 (F5-F12):** refresco contra Zernio (`lib/agent/refresh.ts`) y
  verificación en tres momentos (RPC `claim_agent_reply` con advisory lock en el
  momento 2, trigger `messages_discard_answered_drafts` en el momento 3); espera
  externa; modo "Según reglas" con evaluador puro (`lib/agent/rules/`), editor con
  simulación, y visibilidad (oración de decisión, salud del refresco).
- **Bloque 3 (F13-F18):** navegación con Dashboards primero (redirect 308 de
  Analytics); funciones SQL de métricas `SECURITY INVOKER` (00078) con
  `verify-dashboards.mjs`; pantalla del dashboard de Chat.
- **Bloque 4 (F19-F22):** `message_categories`/`message_texts`, `text_norm`, trigger,
  siembra de botones y backfill (533 textos); clasificador con modelo inyectado;
  correcciones; sección Patrones.
- **Bloque 5 (F23-F26):** `ai_background_settings` + página de tareas; ventanas de
  despacho testeadas + rutas cron + interfaz `BatchProvider`; fórmulas de calidad;
  `agent_runs.intent` + herramienta `declarar_intencion` + graduación.

### Decisiones tomadas
| Decisión | Por qué |
|---|---|
| **Builder único de salientes** en vez de tocar 11 inserts sueltos | El `origin` tenía que salir bien de cada camino; un solo lugar testeable |
| **Se sumó `message.sent`** además del refresco | El SDK dice que los ecos de la app nativa llegan por ese evento; el refresco cubre si no |
| **Momento 2 con advisory lock, sin fila `pending`** | Reservar una fila en `messages` contaminaría bandeja, conteos y ráfaga; el lock serializa turno-vs-turno y el momento 3 cubre la respuesta humana |
| **`normalize_for_grouping` nueva, no se tocó `normalize_message_text`** | Redefinir la del opt-out cambiaría la detección de "no contactar" |
| **Categorías de sistema por trigger en `workspaces`** | Un workspace nuevo nace con "Otro" y "Solo emoji o adjunto" |
| **`declarar_intencion` opt-in, no `required`** | Forzarla cambiaba el set por defecto y rompía tests de caracterización |
| **Sin librerías de test de UI ni Playwright** | Decisión de Wendy: lógica en funciones puras + scripts `verify-*`; pantallas a ojo con ella |

### Migraciones
00074 (origin), 00075 (timezone), 00076 (checks + normalize), 00077 (reglas +
routing + RPC + trigger momento 3 + cron drafts-refresh), 00078 (métricas del
dashboard), 00079 (patrones), 00080 (tareas en segundo plano + intent). Todas
aplicadas en producción, idempotentes, funciones con `SET search_path = ''`.

### Verificación
- 1253 tests en verde (de 1059 al empezar). `npm run build`, `tsc` y `eslint`
  limpios (0 errores, 44 warnings preexistentes). `verify-rls.mjs` y
  `verify-dashboards.mjs` en verde (correr de a uno: comparten prefijo `zz-test-`).
- Pantallas no verificadas a ojo (la app pide login): en `docs/PENDIENTE.md`.

### Deuda anotada
Todo en `docs/PENDIENTE.md`: rollout de la barra de 56 px a las 21 páginas, 4
pestañas de tendencias, "qué le responden" (§11.7) y drilldown de correcciones,
pipeline de lote real + recolección + UI de calidad/versiones, API por lote,
unificación de zona horaria, y la recorrida de pantallas en vivo (§19 del plano).

---


## Etapa 1 · Fase 3 · Bloque 2d-A — Aprobar desde el teléfono y etiquetas con efecto

**Fecha:** 26 de septiembre de 2026
**Alcance:** las Tareas 1 y 4 del prompt del Bloque 2d, más el candado de solo
lectura en la regeneración. Las Tareas 2 y 3 (backfill manual, reglas botón →
etiqueta y propuestas de etiqueta) pasan a **2d-B**, después de una semana con
el agente prendido: el estimador de costos del backfill necesita runs reales y
la similitud de etiquetas se diseña mejor viendo qué propone el agente. Es lo
único que falta para prender el agente con seguridad: aprobar desde el
teléfono y que un conocido nunca reciba un pitch. El agente sigue **apagado**.

**Qué se construyó:** Borradores sale del menú y queda como número sobre Inbox,
pestaña en la bandeja, chip por conversación y "Volver a Inbox"; la versión
para el teléfono (barra de arriba con menú, bandeja lista → hilo, datos del
contacto como hoja, cola en tarjetas con Enviar/Descartar al pie); las
etiquetas con efecto sobre el agente (00073) con su pestaña en Agentes, las
acciones rápidas del panel y la ficha, y el etiquetado masivo en Contactos; y
la regeneración que no vuelve a tocar el CRM.

### Decisiones tomadas

| Decisión | Por qué |
|---|---|
| **Borradores fuera del menú** | El modo borrador es una rampa para confiar en el agente. Con un canal de vuelta en envío directo, el ítem quedaría para siempre apuntando a una pantalla vacía. El número sí queda a la vista: la lógica de ventanas existe por la presión de tiempo |
| **Cascarón mobile completo**, no solo la cola | No había nada mobile (el sidebar eran 240 px fijos). Un borrador con tres horas de ventana un domingo se aprueba desde el teléfono o no se aprueba |
| **Tarjetas abajo de 980 px** (variante `queue:`), botones `sticky` y no `fixed` | La tabla de cinco columnas no se comprime. `sticky` dentro del scroll: el teclado no tapa Enviar |
| **Etiqueta con efecto genérica**, no dos casos especiales | `es-conocido` y `no-es-lead` piden lo mismo y solo difieren en si asignan. Dos columnas en `tags` y triggers |
| **El efecto vive en la base** | Seis caminos ponen etiquetas y no comparten una función de TypeScript |
| **La marca se limpia solo si el estado del agente cambia de verdad** | Revisión de Wendy: limpiarla en cada escritor la borraba en la primera respuesta a mano a un conocido, y sacar la etiqueta después no la prendía nunca. Un trigger en la base vale para cualquier escritor y los cuatro archivos de TypeScript no se tocaron |
| **Sacar la etiqueta no revierte la asignación** | Decisión de Wendy: la persona sigue siendo la responsable |
| **Permisos por policies, no por privilegio de columna** | Todos los usuarios son el rol `authenticated`: revocar la columna se la sacaba también a Wendy |
| **El agente nunca usa una etiqueta con efecto** | Se apagaría a sí mismo en medio del turno y el lead quedaría sin respuesta ni aviso |
| **Regenerar sin mensajes nuevos es de solo lectura** | Con round-robin, regenerar tres veces paseaba la conversación por tres personas; el único freno era una línea del prompt. Derivar y pausarse siguen: en borrador solo sugieren |
| **Backfill y propuestas de etiqueta a 2d-B** | Sin runs no hay con qué calibrar el costo, y el vocabulario de etiquetas se ve mejor con el agente corriendo |

### Lo que la exploración corrigió sobre lo que se asumía

- El aviso del dashboard "N respuestas esperando aprobación" no existía: la
  página redirige a Flows.
- La bandeja no tenía versión mobile (el prompt lo daba por hecho, sacado de
  los requerimientos de la Fase 1).
- En modo borrador las herramientas del CRM se ejecutan de verdad (solo
  derivar y pausarse se difieren). Pesa en el backfill (2d-B) y en regenerar.
- `push_debounced_job` solo empuja el `run_at` hacia adelante, y el tope de
  gasto con acción "apagar" corre antes del corte de modo borrador. Los dos
  pesan en el backfill: quedan resueltos en el diseño de 2d-B.
- Las respuestas de botón llegan con payloads opacos (`ACT::…`) y solo en un
  tercio de los mensajes: la regla botón → etiqueta de 2d-B se casa por texto.
- Con las 18 etiquetas reales, `ya-usa-ia`/`no-usa-ia` y
  `tiene-negocio`/`sin-negocio` se habrían fusionado en el diseño de
  similitud: 2d-B lleva polaridad `no`/`sin`.

### Migraciones

| # | Qué crea |
|---|---|
| 00073 | `tags.disables_agent` y `tags.assigns_to`; policies de `tags` por comando; `conversations.agent_disabled_by_tag_id`; triggers en `contact_tags` (poner, sacar, fusión), `tags` (borrar, prender o apagar el efecto) y `conversations` (heredar en las nuevas y movidas; limpiar la marca si una persona cambia el estado). **Aplicada en producción el 26/9/2026** |

La 00073 se probó con diez escenarios contra producción dentro de un lote que
se deshace (verificado después que no quedó nada): etiquetar, contestar a mano
con una marca de error previa, prender a mano, sacar, apagado a mano no
reclamado, conversación nueva, dos etiquetas con efecto, apagar el efecto,
borrar la etiqueta y fusión.

### Verificación

- 1059 tests en verde (de 1055): el agente no aplica etiquetas con efecto ni
  con una configuración vieja; regenerar sin mensajes nuevos no ofrece
  asignar ni reasigna en tres regeneraciones seguidas; con un mensaje nuevo del
  lead las herramientas corren; los links de notificación usan `?c=`.
- `verify-rls.mjs` suma los casos de la 00073 (Member no crea ni toca
  etiquetas con efecto, pero puede aplicarlas a sus leads; el caso etiquetar →
  contestar a mano → sacar; prender a mano gana; conversación nueva apagada;
  borrar la etiqueta libera). En verde con la 00073 aplicada.
- `npm run build`, `tsc` y `eslint` limpios.
- Las pantallas no se verificaron a ojo: la app pide login y no se ingresan
  credenciales. La lista en vivo está en `docs/agente-ia.md`.

### Deuda anotada

- **`approveDraft` no mira `agent_enabled`**: un borrador en cola se puede
  enviar aunque el contacto acabe de marcarse `no-es-lead`. La fila lo avisa.
- **Un Member no ve en Acciones los `tag_effect` que dispara el agente.**
- El resto de las pantallas del dashboard (Flows, Secuencias, Agentes) no
  tiene versión mobile: tienen el menú nuevo, pero sus tablas no se adaptaron.
- **2d-B** (después de una semana con el agente prendido): backfill manual,
  reglas botón → etiqueta, propuestas de etiqueta con similitud. Diseño y
  correcciones en el plan del bloque.
- Siguen las del 2c: la regla de pertenencia, la 00072, las respuestas desde
  la app de Instagram.

---

## Etapa 1 · Fase 3 · Bloque 2c — Modo borrador del agente

**Fecha:** 25 de septiembre de 2026
**Alcance:** el documento `requerimientos-bloque2c-modo-borrador.md` (v1.1),
más los ajustes de las dos rondas de revisión del plan (estados `sending` y
`failed`, medición en los dos modos, trabajo de varias personas en la misma
cola). El agente sigue **apagado y sin canales**: lo prueba Wendy con la lista
de verificación en vivo de `docs/agente-ia.md`.

**Qué se construyó:** el modo por canal (envía directo / deja borradores); la
rama del turno que deja la respuesta en `agent_drafts` y cierra el run
`drafted`; el ciclo de vida del borrador (reemplazo por un entrante nuevo,
descarte por una salida real, un solo vivo por conversación garantizado en la
base); las cuatro decisiones (enviar, editar y enviar, regenerar, descartar)
con bloqueo optimista; la pantalla Borradores con su contador en el menú, la
franja de medición y Realtime; el borrador dentro de la conversación; la
métrica de gasto descartado en Costos; el panel del contacto ampliado; y los
avisos de ventana (00072, sin aplicar).

### Decisiones tomadas

| Decisión | Por qué |
|---|---|
| **Aprobar un borrador no es una respuesta manual** | Si pasara por `applyManualReply`, el agente quedaría apagado y el modo funcionaría una vez por conversación. El mensaje lleva las dos autorías, y `lastHumanReplyAt` lo ignora (era un segundo lugar, silencioso, que envenenaba los guardarraíles) |
| **Tabla aparte**, nunca un mensaje "borrador" | Un mensaje lo contarían los dashboards, lo leería el contexto y cerraría la ráfaga |
| **Estados `sending` y `failed`**, además de los cinco del plano | Un envío en varias partes que falla a mitad no puede quedar `sent` ni volver a `pending` (chocaría con el índice único). `failed` es vivo: entra en el índice y se reemplaza con un entrante nuevo |
| **Un entrante nuevo reemplaza `pending` y `failed`, nunca `sending`** | Lo que está saliendo lo termina el servidor. Si el turno nuevo encuentra uno saliendo, no falla: se reprograma en 60 s |
| **Un turno lento no pisa uno más nuevo** | Sin salida que cierre la ráfaga, dos turnos pueden terminar en cualquier orden. El que responde una ráfaga más vieja nace `superseded` |
| **Regenerar usa la clave del burst** y la instrucción es volátil | Nunca corren dos turnos sobre la misma conversación. `push_debounced_job` descarta en un conflicto las claves que le dicen (genérico, no sabe de borradores): la instrucción era sobre el borrador viejo, la cadena se conserva |
| **En modo borrador no aplican la demora ni el horario de atención** | No hay nadie esperando que parezca humano; si hay una persona para aprobar, no está fuera de horario |
| **Guardarraíles, fallos y derivaciones dejan una fila sin texto** | La cola es el único lugar de "lo que necesita respuesta". En modo borrador el agente no se apaga y no hay marca de error: la fila es la señal |
| **Las herramientas de clasificación se aplican al redactar** (decisión del plano) | Un borrador descartado ya etiquetó: se revierte desde Acciones. Al regenerar, el prompt dice lo que ya aplicó |
| **Ventana: 24 h desde el último mensaje del lead** (Instagram/Facebook), configurable por canal | El SDK de Zernio no la expone por conversación; es el plazo que documenta Meta. WhatsApp por Evolution no tiene ventana |
| **Nada se autovence** | Un borrador pendiente queda pendiente; la ventana cerrada es un cálculo, y la acción pasa a "responder a mano" |
| **De quién es un borrador: setter, si no vendedor, si no "sin asignar"**, por el contacto | Un campo propio se desincronizaría al reasignar. **La regla la confirma Wendy** |
| **Cola en "míos" por defecto**, sin lock ni presencia | Dos personas no abren el mismo borrador si cada una ve el suyo; el bloqueo optimista cubre el resto |
| **Tres tiempos separados**; el de aprobación solo sobre borradores | Con un solo número no se ve cuál se puede mejorar; con los de envío directo, la mediana se llenaría de ceros |
| **Las métricas se defienden solas** en la base | Se llaman con el cliente del usuario; un Member recibe sus números pase el id que pase. `ai_cost_report` sigue solo service role porque son costos |
| **Tope de respuestas vacío = sin tope**, y es el default | Lo que protegía contra un loop lo cubren los topes de gasto y la regla de escalamiento. La fila existente pasó a vacío porque tenía el default 12 |
| **Los avisos de ventana (00072) se aplican después** | Es lo único que notifica a una persona; conviene enchufarlo sabiendo el volumen. Las ventanas perdidas y los envíos colgados ya los cubre el barrido de la 00070 |

### Lo que la exploración corrigió sobre lo que se asumía

- El resultado de un run es la columna `status`, no "resultado".
- `manual-reply.ts` no detecta nada: lo llama la ruta de envío manual. La
  detección para los guardarraíles era otro lugar (`lastHumanReplyAt`).
- `countAgentReplies` contaba solo runs `responded`: en modo borrador el tope y
  la regla de turnos sin resolver no habrían subido nunca.
- Marcar "no contactar" a mano no pausaba las secuencias (solo la detección
  automática). Ahora sí.
- No existía la fecha de actualización de la memoria del agente.
- Al reintentar un envío fallido, el mensaje fallido del primer intento se
  contaba como "ya hubo una respuesta". Lo encontró un test; ahora los envíos
  fallidos no cuentan.

### Migraciones

| # | Qué crea |
|---|---|
| 00070 | `agent_drafts` (RLS por scope de leads, índice único de un vivo por conversación, Realtime, retención de 12 meses); `agents.channel_modes`; tope de respuestas opcional; run `drafted` e `inbound_at`/`responded_at`; `channels.messaging_window_hours`; `contacts.ai_summary_updated_at`; `messaging_window_hours()`; barrido cada 5 minutos; `push_debounced_job` con claves volátiles |
| 00071 | `ai_cost_report` con borradores; `draft_queue_metrics` y `draft_queue_metrics_by_person` |
| 00072 | Avisos de ventana por persona y corte. **Aplicada en producción el 26/9/2026** |

00070 y 00071 aplicadas en producción el 25/9/2026. Idempotentes, funciones con
`SET search_path = ''`.

### Verificación

- 1050 tests en verde (de 978 al empezar): el turno en modo borrador no envía
  y deja el run `drafted`; aprobar **no** apaga el agente (el test de la
  trampa); un entrante nuevo marca `superseded`; dos vivos en la misma
  conversación son imposibles; el borrador no cierra la ráfaga; derivar y
  pausarse quedan como sugerencia y se aplican al aprobar; un guardarraíl deja
  fila sin texto; un envío en vuelo no hace reventar el turno; la regeneración
  con y sin instrucción; los cinco estados de la ventana; el cálculo de
  enviable.
- `verify-rls.mjs` en verde con un Member real: ve y aprueba solo los
  borradores de sus leads, no crea, no cambia el texto, no decide a nombre de
  otro, no marca `sent`; dos vivos se rechazan; las métricas le devuelven sus
  números aunque pida los de otra persona; las claves volátiles en los dos
  sentidos; edita el estado de sus leads y no el de ajenos.
- El barrido de la 00070 y la 00072 completa, probados dentro de transacciones
  que se deshacen (la 00072 corrida dos veces: la segunda no avisa).
- `npm run build`, `tsc` y `eslint` limpios.
- Las pantallas se verificaron por compilación, no a ojo: la app pide login y
  no se ingresan credenciales.

### Deuda anotada

- **Respuestas desde la app de Instagram** no llegan por webhook: no descartan
  el borrador ni las ve la guarda de "ya hubo una respuesta". En modo borrador
  pesa mucho más que en envío directo, porque un borrador vive horas y en esas
  horas es muy probable contestar desde el celular. No se arregla en este
  bloque.
- **El eco de WhatsApp desde el celular** (`fromMe`) no lleva
  `sent_by_user_id` ni apaga el agente (sí descarta el borrador).
- **Dos enlaces usan `?conversation=`** y la bandeja lee `?c=`: el de la campana
  (`lib/notifications/types.ts`) y el de la ficha del contacto.
- **La 00072** se aplica cuando la cola tenga un par de días.
- **La regla de pertenencia** (setter → vendedor → sin asignar) espera la
  confirmación de Wendy.
- **El índice de la cola** no cubre la expresión con la que empieza el orden; a
  este volumen no importa.
- Siguen las del 2b: el hueco del system prompt, los ocho casos en vivo, la
  zona horaria, el backlog de 578 conversaciones y la segunda pasada del
  backfill.

---

## Etapa 1 · Fase 3 · Bloque 2b — Herramientas, memoria, cierre y observabilidad del agente

**Fecha:** 24 de septiembre de 2026
**Alcance:** F23 (completa), F24, F28, F29 (completas), F33 y F34 del documento
de requerimientos de la Fase 3, más el interruptor de tres estados (decisión
tomada con Wendy). El agente sigue **apagado y sin canales**: la verificación
en vivo se hace después, con los ocho casos listados en
`docs/agente-ia.md`.

**Qué se construyó:** las seis herramientas que faltaban, con parámetros y
límites validados en el servidor; la memoria acumulativa por contacto y la
clasificación al cierre; el cierre por inactividad; el interruptor de tres
estados por conversación; y las cuatro pestañas de la pantalla de Agentes que
quedaban (Herramientas, Runs, Acciones, Costos), con acceso de un Member a
Runs y Acciones acotado por RLS.

### Decisiones tomadas

| Decisión | Por qué |
|---|---|
| **Interruptor de tres estados** (`agent_enabled` NULL = heredar) y las 583 conversaciones pasan a heredar | Con el default `false` el agente nunca atendía a un lead nuevo. Ninguna conversación había sido apagada a propósito. La migración solo lo hace la primera vez (chequea que la columna todavía sea NOT NULL) |
| Heredar con el maestro apagado **no deja run** | Es el estado de todas las conversaciones: un run por mensaje sería ruido. Forzado prendido sin poder actuar sí deja run: alguien lo pidió |
| **La ráfaga ignora entrantes más viejos que 6 h** (`burst_max_age_hours`) | 137 conversaciones sin una sola respuesta: "lo posterior a la última salida" era todo el historial y el primer turno contestaría preguntas de hace semanas. Condición de Wendy |
| **El barrido de inactividad solo cierra conversaciones donde el agente ya participó** (tiene un run) | 578 conversaciones inactivas de antes del agente: cerrarlas y resumirlas el día que se prenda el maestro serían 578 llamadas al modelo. Condición de Wendy. El backlog se cierra a mano |
| **Una sola llamada al modelo al cierre** devuelve resumen + clasificación | Las dos salen de leer lo mismo y cada llamada cuesta. La clasificación pasa por los mismos ejecutores que las herramientas |
| `configFields` en cada herramienta, además del zod | Introspectar zod para adivinar que un `string[]` es "tags" es frágil. El descriptor es explícito y la pestaña no tiene condicionales por nombre |
| La lectura del CRM no escribe en `audit_log` | No hay nada que revertir en una lectura; llenaría Acciones de ruido. Deja su paso en el run |
| Runs/Acciones/Costos muestran datos del workspace con el agente preseleccionado | Los runs de flows, secuencias e indexación no tienen agente; Costos pide desglose por fuente |
| Revertir: inverso con el cliente del usuario, marca con service role | La RLS decide si puede tocar ese lead; `audit_log` sigue sin UPDATE para usuarios, así nadie desmarca una reversión |

### Lo que la exploración corrigió sobre lo que se asumía

- **No existía ningún cierre automático** de conversaciones; el cierre manual
  era un update desde el navegador. Ahora pasa por una server action.
- **La RLS de `audit_log` no dejaba a un Member ver las acciones del agente**
  (solo sus propias filas). Sin la policy nueva la pestaña le quedaba vacía.
- **La pantalla de Agentes era solo admin.** Para que un Member vea Runs y
  Acciones en su scope, el detalle se abre por rol y no le manda topes,
  prompt ni configuración.

### Migraciones

| # | Qué crea |
|---|---|
| 00066 | `conversations.agent_enabled` nullable (tres estados) + migración única de las filas; `agents.burst_max_age_hours` |
| 00067 | `agents.close_after_inactive_hours / summary_on_close / classify_on_close`; `conversations.closed_at / summarized_at`; índice del barrido |
| 00068 | `audit_log.reverted_at / reverted_by_audit_id`; policy para que un Member vea las acciones del agente sobre sus leads; índices de la vista de Acciones |
| 00069 | `ai_cost_report()` para la pestaña Costos (solo service role) |

Las cuatro aplicadas en producción el 24/9/2026. Todas idempotentes, funciones
con `SET search_path = ''`, columnas nuevas de `agents` sumadas al GRANT de la
00060.

### Verificación

- 971 tests en verde (de 904 al empezar): cada herramienta respetando sus
  parámetros (el tag fuera de la lista blanca no se aplica), el resumen
  reconciliando un dato que cambió, la clasificación al cierre con límites, el
  estado efectivo en los tres estados, la ráfaga con antigüedad máxima, el
  barrido que no toca el backlog, y la reversión auditada.
- `verify-rls.mjs` en verde con un Member real: ve las acciones del agente
  sobre sus leads y no sobre ajenos, no puede marcar una reversión, no lee
  ninguna columna de costo; las columnas nuevas de `agents` son legibles.
- `npm run build`, `tsc` y `eslint` limpios en cada commit.
- Las pantallas se verificaron por compilación, no a ojo: la app pide login y
  no se ingresan credenciales (mismo límite de bloques anteriores).

### Deuda anotada

- **El system prompt sigue con `[[ COMPLETAR: link de agenda ]]`.** El agente
  no se prende hasta que Wendy lo corrija y se corran los ocho casos en vivo.
- **Los ocho casos en vivo** están en `docs/agente-ia.md`; la verificación
  contra Instagram real es de la próxima sesión.
- **Zona horaria:** Runs y Acciones filtran en la de la app (Buenos Aires),
  Costos y topes en la del negocio (Costa Rica). Unificar con
  `workspaces.timezone`.
- **El backlog de 578 conversaciones** queda abierto; cerrarlo a mano dispara
  un resumen por conversación.
- **Segunda pasada del backfill** en la semana del 1 de octubre de 2026.

---

## Etapa 1 · Fase 3 · Backfill de Zernio corrido en firme

**Fecha:** 24 de septiembre de 2026
**Alcance:** la deuda "el backfill no se corrió en firme" del Bloque 1 (F20).

**Qué pasó:** se corrió `scripts/backfill-zernio-messages.mjs` primero en
seco y después con `--apply`. El primer dry-run destapó dos cosas que había
que arreglar antes de escribir:

| Hallazgo | Consecuencia si se aplicaba tal cual | Arreglo |
|---|---|---|
| **El historial de Zernio devuelve en `id` el id nativo de Meta**, no el ObjectId corto de Zernio que guarda el webhook en `platform_message_id`. El Bloque 1 asumió lo contrario y su dry-run (20 mensajes de 3 conversaciones) no se contrastó con filas guardadas | 0 "ya estaban" sobre 234 mensajes guardados por webhook: **se habría duplicado todo lo que entró por webhook** | Dedup contra las dos columnas de id (`platform_message_id` y `platform_native_message_id`) y, como red de seguridad, dirección + fecha al milisegundo + texto. Las filas del backfill llevan el id del historial en las dos columnas cuando tiene forma de id de Meta |
| **Rate limit de Zernio** a partir de las ~220 conversaciones seguidas ("retry after N seconds"), sin reintento | 366 de 583 conversaciones quedaban sin leer | Espera lo que pide la API y reintenta hasta 3 veces por página |

**Cifras de la corrida en firme** (583 conversaciones de Instagram, 0 errores):

| Dato | Valor |
|---|---|
| Mensajes que devolvió la API | 2.448 |
| Guardados | **2.206** |
| Ya estaban (webhook) | 236 |
| Descartados (borrados por el remitente o sin id) | 6 |
| `messages` después de la corrida | 2.444 filas (852 entrantes, 1.592 salientes) en 582 conversaciones |
| Dobles (misma conversación, dirección, fecha y texto) | 0, verificado contra la base |

**Dos cosas a tener presentes:**

- **44 mensajes son anteriores al 24 de septiembre de 2025** (el más viejo,
  de marzo de 2024). La retención de 12 meses (`purge_old_messages`, cron
  diario a las 5:00 UTC) los borra en la próxima corrida. Es la política
  vigente, no un error: quedan a propósito fuera.
- **Hay que volver a correrlo en la semana del 1 de octubre de 2026.** El
  replay de Meta hacia Zernio corre en segundo plano y el SDK recomienda no
  confiar en una sola pasada. La segunda corrida es gratis: solo suma lo que
  apareció en el medio.

Los términos de Zernio/Meta sobre persistir DMs siguen como pendiente
explícito; la decisión de correrlo en firme es de Wendy (24/9/2026).

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
