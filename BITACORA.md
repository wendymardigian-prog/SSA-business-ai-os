# Bitácora del proyecto

Registro de qué se construyó, qué se decidió y por qué. Se actualiza al cerrar
cada bloque.

---
## Etapa 4 — Agendamiento (Tanda B: la etapa completa)

**Fecha:** 27 de septiembre de 2026
**Rama:** `etapa4-agendamiento`
**Migraciones:** 00095 a 00100, todas aplicadas. Ninguna borra ni modifica
datos: la etapa entera es aditiva.

### Qué se construyó

Ocho bloques, F1 a F58 (sin F30 ni F31, que la etapa no incluía):

1. **Perfil y calendarios.** Cada persona tiene su usuario público, su zona y
   su formato de hora. Google Calendar se conecta por persona, no por negocio.
2. **Disponibilidades.** Horarios semanales, excepciones por fecha y tiempo
   fuera, con un horario por defecto que se crea solo.
3. **Categorías y eventos.** Dos niveles (área y tipo), precargados, y el
   editor del evento con siete secciones.
4. **Motor en vivo, API pública y el booker.** El lead elige un horario que
   existe y la reunión queda creada en una transacción.
5. **Pantalla de agendas.** Lista, kanban y calendario sobre los mismos datos,
   con el detalle lateral y el agendar a mano.
6. **Embed.** Un script de 13 KB, tres modos, y los eventos hacia la página.
7. **Automatizaciones.** Nueve triggers, dos nodos nuevos, el email como
   acción, y el editor lineal de los flujos del evento.
8. **Habilidad del agente.** Siete herramientas que se prenden juntas.

### Las decisiones que más costaron

**La doble reserva la evita la base, no el código.** `bookings` tiene una
restricción de exclusión por anfitrión y rango. Un `SELECT` antes de un
`INSERT` deja una ventana; la restricción no. `verify-booking-concurrency`
manda diez pedidos a la vez contra la base real y afirma que queda una
reunión.

**Los reintentos de Google los agenda el handler, no la cola.** La cola
reintenta a los 10 segundos y lo haría encima del reintento propio de 1, 5 y
15 minutos. Es la misma decisión que tomó el despachador de contenido.

**El código público de una reunión nunca llega al modelo.** Con esos 22
caracteres se cancela sin sesión. El agente trabaja sobre "la próxima reunión
de este contacto", que resuelve la herramienta.

**Cancelar es definitivo.** Sin vuelta a activa. El historial se lee sin
ambigüedad y no hay que explicar qué significa una reunión que estuvo
cancelada y volvió.

**La categoría queda congelada en cada reunión.** Renombrar un área no cambia
el significado de los informes viejos. La única forma de tocarla es a mano y
queda registrada.

### Cinco cosas que estaban rotas y no se sabía

Ninguna la trajo el plano: aparecieron al construir sobre el código real.

1. **Guardar una conexión OAuth fallaba contra la base.** `saveConnection` hacía
   `upsert` con `onConflict` de columnas, pero el único era de expresión:
   Postgres responde 42P10. Conectar YouTube, LinkedIn o Threads de verdad
   habría terminado en error. Nunca se vio porque la tabla estaba vacía y el
   test usaba un mock.
2. **Un flujo no arrancaba si el contacto no tenía conversación.** El cron
   mandaba el canal vacío y el insert de la sesión fallaba en silencio. Sin
   esto, ningún flujo de agenda habría arrancado nunca.
3. **Los triggers que no son de mensaje nunca se guardaban.** El editor
   ofrecía "Contacto nuevo", "Evento del CRM", "Inactividad" y "Email
   recibido", y al publicar no se escribía ninguna fila.
4. **`tools_config.scheduling` desaparecía al primer guardado.** La pantalla de
   Herramientas borraba toda clave que no fuera el nombre de una herramienta.
5. **Las siete plantillas de flujo guardaban el email con un nombre que el
   motor no conoce.** Se veían bien en el canvas y no mandaban nada.

Cada una quedó con su test.

### Dos arreglos de bundle

El script de embed pesaba **488 KB**: un import arrastraba Zod y dayjs enteros
a un archivo que se carga en la página de cualquiera. Tres módulos chicos sin
dependencias lo dejaron en **13,6 KB**, y un test no lo deja volver a crecer.

El tema forzado del booker (`?theme=`) no llegaba: Tailwind declara los
`--color-*` en la raíz, y una variable se sustituye donde se DECLARA, no donde
se usa. Redefinir solo `--background` abajo no cambiaba nada.

### Lo que queda

En `docs/PENDIENTE.md`, con el formato *qué quedó / por qué / qué se decidió*.
Lo principal:

- **La redirect URI de Google Calendar no está en Google Cloud.** Sin eso,
  conectar una cuenta falla. Es el primer paso de la verificación en vivo.
- **F42 (dominio propio) y F15 (vista previa del horario)** son nice-to-have y
  no entraron. El código ya respeta la columna del dominio.
- **El e2e del agente no pasa por el modelo:** los cinco guiones llaman a las
  herramientas en orden, contra una base en memoria.
- **Las pantallas internas se revisaron con la sesión abierta**; las públicas
  (booker, confirmación, reagendar, cancelar y el embed) a 1440 y 390 px, en
  claro y en oscuro.

---
## Etapa 1 · Fase 3 · Bloque 2e-bis — Tope del prompt, link de WhatsApp y guardarraíl de salida

**Fecha:** 27 de septiembre de 2026
**Rama:** `claude/system-prompt-32k-limit-78ace7` (worktree). El agente sigue
**apagado** y sin canales; la prueba en vivo la corre Wendy.

**Qué se construyó:**
- **Tope del system prompt a 32.000** (era 20.000; un prompt de 23.013 no
  entraba). En `lib/agent/validate.ts` (`MAX_PROMPT_CHARS`, `promptLengthState`).
  Se sacó el `maxLength` del textarea, que recortaba en silencio: ahora el
  contador avisa (ámbar/rojo) y Guardar se deshabilita por encima del tope, con
  el motivo. Tests del validador y de la Server Action `saveSystemPrompt` directa.
- **Herramienta `generar_link_whatsapp`** (`lib/agent/tools/whatsapp-link.ts`):
  arma el link de WhatsApp de Wendy con un mensaje preescrito para pasar un lead
  calificado. Devuelve el marcador `{{LINK_WHATSAPP}}`; el runner
  (`lib/agent/whatsapp-handoff.ts`, `applyWhatsappMarker`) lo reemplaza por el
  link real sobre las burbujas, antes de persistir. Sanea el contexto del lead,
  recorta en borde de palabra antes de codificar, reúsa el link previo de la
  conversación y dedup en el turno. Campo de texto genérico nuevo en el
  descriptor de config (sin condicionales por nombre).
- **Registro del pase**: `whatsapp_handoff` en `audit_log` cuando el mensaje sale
  con el link (envío directo y borrador aprobado), con `metadata.reason` = texto
  preescrito. Sin botón de revertir. Es lo que permite contar los pases.
- **Guardarraíl de salida** (`lib/agent/output-guardrails.ts`,
  `agents.guardrails`): links fuera de la lista blanca (vacía = no corre),
  palabras prohibidas (ScaleOS), escasez inventada y cifras con `$`. En envío
  directo bloquea, avisa (`agent_output_blocked`) y el lead no ve nada; en
  borrador lo guarda marcado (`guardrail_review`) y no deja aprobar sin editar.
  Editor en la pestaña Configuración.

**Decisiones:** el link generado en el turno pasa el guardarraíl aunque no esté
en la lista (sale del número de Wendy, no del modelo); un borrador marcado no se
envía sin editar; en envío directo bloqueado se avisa pero no se deriva; la
sustitución va sobre las burbujas para no partir nunca una URL.

**Sin migraciones** (`audit_log.action` es texto libre; los jsonb ya existen).

**Estado:** `npx vitest run` 1311 en verde (se sumaron los nuevos), `npm run
lint` 0 errores (44 warnings preexistentes), `npx tsc --noEmit` limpio, `npm run
build` **compila y pasa TypeScript**; el prerender de `/register` falla solo por
falta de credenciales de Supabase en este entorno (no hay `.env`), igual que en
las otras ramas.

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

---

# Etapa 2 — Publicación, métricas, email y roles (26 de septiembre de 2026)

Nueve bloques, 72 funcionalidades, nueve migraciones aplicadas (00081 a 00089)
y una escrita sin aplicar (00090). De 1258 tests a **2413**.

Se hizo en una corrida autónoma sobre la rama `etapa2`, con commit y push por
bloque. El plan está en `docs/requerimientos-etapa2.md`; el estado final, en
`docs/PROGRESS.md`; lo que quedó afuera, en `docs/PENDIENTE.md`.

## Lo que se construyó

**Integraciones rediseñadas.** Una pantalla con el estado de cada conexión y
todos los secretos en Vault. Doce proveedores, cada uno con su tarjeta, su
prueba antes de guardar y su barra de uso.

**Contenido.** Ideas, piezas, tablero, calendario, lista, editor con generación
por IA, versiones, y publicación en cinco redes con reintentos.

**Métricas.** Cuatro tablas, cinco lectores, y tres dashboards nuevos: contenido
orgánico, anuncios de Meta y unificado. Más la página Social y el análisis
histórico de cada post.

**Email como canal.** Los correos entran a la misma bandeja que los DMs y se
responden desde ahí, con el hilo bien armado del otro lado.

**Roles personalizados.** Treinta y cinco permisos, dos alcances, y una pantalla
para armar roles sin tocar código.

## Las decisiones que más costaron, y por qué son así

**Un metric que la red no dio queda en `null`, no en cero.** Es la regla que
atraviesa todo el módulo de métricas. Un cero escrito en la tabla se lee
después, en un gráfico, como "ese día no pasó nada" — y eso es una afirmación
distinta y falsa. El costo es que medio código tiene que manejar `null`; el
beneficio es que ningún número del dashboard es inventado.

**El alcance único de un período no es la suma de los diarios.** La misma
persona alcanzada el lunes y el martes cuenta una vez. Se pide en vivo a Meta
con caché de quince minutos, en vez de sumar lo guardado. Sin esto, el alcance
del mes daría un número inflado que después nadie entiende por qué no cierra
con lo que muestra Meta.

**El email no es un módulo aparte.** Entra por `channels`, `conversations` y
`messages`. Una bandeja aparte para el email sería una segunda bandeja que
revisar, y el punto del sistema es que haya una sola.

**El agente de IA no contesta emails.** Está hecho para chat: responde corto y
en el momento. Un email contestado así se lee mal, y además nadie lo pidió. Hay
un test con espía que lo verifica, porque es exactamente la clase de cosa que
alguien agrega "por consistencia" con los otros dos receptores.

**Los permisos de Member son los de antes, no los que parecerían razonables.**
Antes de tocar un solo guard se escribió `member-baseline.test.ts`, que recorre
las páginas y las acciones del código real y mira qué guard usa cada una. La
tabla de permisos se deriva de eso. Así lo que un Member puede después es
exactamente lo que podía antes, y cualquier diferencia es una decisión explícita
y no un descuido.

**`workspace_members.role` no se tocó.** Sigue siendo owner/admin/member y sigue
siendo lo que leen las cuarenta policies que ya existían. Un rol personalizado
es siempre un `member` con `role_id`. Esa fue la condición para que el cambio
más delicado del sistema no rompiera nada.

## Tres errores que encontraron los scripts de verificación

Los tres se arreglaron. Valen anotarse porque los tests unitarios no los
habrían visto: viven en la base.

1. **El trigger que protege los roles de sistema frenaba el borrado en cascada
   de un workspace.** Faltaba distinguir "alguien borra un rol a mano" de "el
   workspace se va y sus roles con él". Se descubrió porque la limpieza de
   `verify-rls` dejó de poder borrar sus datos.
2. **La primera versión de la 00089 copió la lógica de leads dentro de
   `can_see_conversation`** en vez de delegar en `can_see_contact`, deshaciendo
   lo que la 00028 había hecho a propósito y perdiendo la exclusión de contactos
   borrados. Un Member volvía a ver la conversación sin asignar de un lead que
   no puede ver.
3. **`has_permission` devolvía `NULL` en vez de `false`** para un rol sin la
   clave `keys`. En una policy Postgres trata `NULL` como falso, así que no era
   un agujero, pero una función booleana que devuelve `NULL` es una trampa para
   quien la llame desde la app.

## Dos fugas al bundle del navegador

Las dos del mismo tipo: un Client Component importó una constante de un módulo
que también hacía trabajo de servidor, y se trajo el servidor con ella.

La primera fue el catálogo de proveedores importando los nombres de los
secretos de `lib/vault.ts`. La segunda, la bandeja importando el nombre del
bucket de `lib/email/inbound.ts`, que arrastró `next/headers` y rompió el build
señalando un archivo que nadie había tocado.

La solución fue la misma las dos veces: un archivo hoja con la constante y nada
más (`lib/secret-names.ts`, `lib/email/buckets.ts`). Y `vault-boundary.test.ts`
ahora vigila los dos módulos, así el próximo caso sale nombrando la cadena de
imports en vez de un error de Turbopack.

## Lo que cambió respecto del plan, y por qué

**Zernio no tiene endpoint de delta ni cursor.** El plano lo daba por hecho;
revisado el SDK instalado, no existe. Se usa `getAnalytics` con ventana de
fechas, que para una recolección nocturna da lo mismo con una pieza menos.

**Postproxy no documenta webhooks.** El receptor quedó escrito y validado con
un secreto, pero el camino real es el trabajo de revisión que pregunta por el
estado.

**LinkedIn no da métricas ni comentarios** sin el programa de partners. Se dice
en pantalla; no es un error que alguien pueda arreglar reconectando.

En los tres casos ganó la documentación del proveedor sobre el plan, y quedó
anotado en `docs/PENDIENTE.md`.

## Lo que queda

Está todo en `docs/PENDIENTE.md`, con el formato *qué quedó / por qué / qué se
decidió en su lugar*. Lo principal:

- **La prueba de subida directa a YouTube está construida y no se ejecutó**:
  sube un video a la cuenta real. Se aprieta en la verificación en vivo.
- **La migración 00090 no se aplicó**: borra las columnas donde todavía vive la
  API key de Zernio. El archivo explica el orden correcto para hacerlo.
- **Las pantallas no se revisaron visualmente**: la app pide login y no se
  ingresan credenciales.
- Las tarjetas de desglose del detalle de anuncios y las historias en vivo de
  Instagram quedaron para cuando haya cuentas conectadas contra las cuales
  medir el costo en cuota.

---

# El clasificador de mensajes (28 de septiembre de 2026)

Dos problemas encadenados, y el segundo hacía al primero inofensivo: el handler
de `bg_task` era `async () => {}`, y el despacho lo re-encolaba cada 15 minutos.
229 jobs para 23 ventanas, todos completados sin hacer nada. Mientras el handler
estuvo vacío, eso fue gratis.

## Lo que se construyó

- **00101**: índice único sobre `dedupe_key` acotado a `bg_task`, más la
  limpieza de los 229 jobs y los 20 huérfanos de workspaces borrados.
- **`lib/background/enqueue.ts`**: el encolado sale del cron, donde el 23505 se
  lee como "ya estaba" y donde se puede testear.
- **`lib/patterns/prompt.ts`**: el pedido al modelo y el parseo tolerante.
- **`lib/patterns/classify-run.ts`**: la corrida, con topes, run y encadenado.
- **`lib/jobs/handlers/bg-task.ts`**: el despacho por tarea.

## Las decisiones que más costaron

| Decisión | Por qué |
|---|---|
| **Índice acotado a `bg_task`, no único total sobre `dedupe_key`** | Un único total rompe la ventana de `agent_burst` (la parcialidad de la 00061 **es** el diseño: un mensaje que llega mientras el agente genera necesita insertar una fila `pending` nueva con la misma clave) y el cancel+reinsert de `booking_relative_trigger` en `backfillRelativeJobs`. |
| **El índice y no una consulta previa** | Dos corridas del cron pueden solaparse; un chequeo del lado de la app no es atómico. |
| **Una ventana fallida no se reencola** | Es lo que se pidió. No se pierde trabajo: la selección no mira ventanas, así que la corrida de mañana toma los mismos pendientes. Solo se posterga. |
| **Modo siembra (12 categorías nuevas mientras el catálogo esté vacío)** | Con el tope de 3 de F20, la primera corrida creaba 3 categorías y mandaba ~540 textos a "Otro" con `source='model'`. Ningún lote los vuelve a mirar: el backlog se quemaba de forma irreversible. |
| **El sobrante del tope queda pendiente, no va a "Otro"** | Mismo motivo. F20 dice "Otro"; diferirlo no pierde nada. |
| **`generateText` + parseo tolerante, no `generateObject`** | `generateObject` ante un truncado lanza y se lleva el lote entero. Se pidió rescatar lo válido. |
| **Índices cortos en vez de UUID** | 200 UUID de salida son ~8.000 tokens solo en identificadores, y cada uno es una oportunidad de alucinar. El ahorro (~$0,05) es lo de menos. |
| **Un texto viaja al modelo una sola vez por corrida** | Sin eso, los diferidos vuelven a entrar en la vuelta siguiente y se pagan dos veces por el mismo resultado. |

## Cuatro cosas que el pedido daba por ciertas y no lo eran

1. **`requerimientos-bloque3-dashboards.md` no existe**, y no hay ninguna §8.2
   sobre el clasificador. La especificación es F19–F22 de
   `requerimientos-fase3-bloques-2e-3.md`, y coincide con lo pedido.
2. **`normalize_message_text` no es la función del clasificador**: es la del
   opt-out (00027). La de agrupación es `normalize_for_grouping` (00076). El
   clasificador no necesita llamar a ninguna: la normalización ya está hecha en
   la fila, y los vacíos van a "Solo emoji o adjunto" desde el trigger.
3. **`agent_runs` tenía 1 fila, no 0**, del agente de chat, con
   `status_detail='provider_unavailable'`.
4. **Son 543 textos, no 541**: 310 inbound y 233 outbound, o sea 4 lotes.

Y una buena: el CHECK `agent_runs_source_check` ya admitía
`message_classification`, así que el run no necesitó migración.

## El costo, con los números reales

543 textos, 51.142 caracteres normalizados, `claude-haiku-4-5` a US$ 1/Mtok de
entrada y US$ 5/Mtok de salida: **≈ US$ 0,06** la primera corrida, con techo de
US$ 0,15 si hay una segunda pasada.

La especificación estimaba "menos de un centavo" y se equivocaba por ~7×: le
faltaba contar la salida, que a US$ 5/Mtok es dos tercios del costo. Sigue
siendo trivial. Los centavos nunca fueron el problema; las 96 corridas del mismo
día, sí.

## Lo que queda

En `docs/PENDIENTE.md`. Lo principal: la API de lote real de Anthropic (a seis
centavos el histórico, el 50% de descuento no paga el pipeline asincrónico),
`bg-collect` sigue sin trabajo porque no hay lotes en vuelo, y la pantalla de
calidad del clasificador es del Bloque 5 — por ahora los resultados se miran por
SQL.

## La primera corrida real (28/9/2026, 18:00 UTC)

Migración aplicada, main mergeado, Railway desplegado a las 17:56:53 — cuatro
minutos antes del tick del cron. Lo que pasó:

- **El cron encoló UN job**, no 96. La idempotencia funciona contra la base real.
- El runner lo tomó, abrió el run con `source='message_classification'` y llamó
  al proveedor.
- **`API key is invalid.`** Tres intentos, job en `failed`, tres runs con el
  error registrado y `cost_usd` en 0. Los 543 textos siguen sin clasificar.

La clave de Anthropic guardada en Vault no sirve. No es del clasificador: el run
del agente de chat de las 17:08 del mismo día falló igual. La card de la
integración está en verde, que es el riesgo que el CLAUDE.md ya nombraba.

La corrida también destapó un incumplimiento propio: eligió `claude-sonnet-5`
porque `getWorkspaceModel` sin preferencia cae al `default_model` del catálogo,
y F20 pide **el más barato** del proveedor configurado. Corregido: ahora se
consulta `model_pricing` y gana el menor por entrada + salida. Era el doble de
precio por token para decidir a cuál de cinco cajones va un "dale, mandámelo".

Que el pipeline entero corriera hasta el proveedor, registrara el run, guardara
el error y frenara sin ensuciar nada es, en sí, la verificación de punta a punta
que faltaba.

---

# La pantalla de Chat, completada (28 de septiembre de 2026)

El bloque 2e + 3 había quedado con la estructura y lejos del prototipo aprobado.
Esta corrida replica el diseño decidido, completa lo que faltaba del plano y
arregla seis cosas que estaban mal. Rama `feature/chat-completar`, en paralelo
con la sesión de multimedia, sin tocar sus archivos.

## Lo que estaba mal, y por qué importaba

| Qué pasaba | Por qué era grave |
|---|---|
| "Borradores (1)" abría una cola que decía "No hay borradores esperando" | El contador de Owner/Admin es el total del workspace; la cola abre en "míos". El número era cierto y la pantalla también: estaba mal el destino. Una Owner sin contactos propios no podía llegar a sus borradores desde ningún acceso |
| Las columnas "Primera respuesta" y "Respuesta" mostraban el mismo número | Salían de la **misma consulta** (00078:217-218). Dos columnas distintas con el mismo dato no se puede notar mirando: parece que la persona contesta igual de rápido siempre |
| Filtrar por Automatizaciones dejaba el dashboard en blanco | Flows, secuencias y broadcasts salían como tres filas y al tocarlas se filtraba por `author=flow`, que `chat_author_match` no reconoce. Devolvía false para todo |
| Una función caída se veía como un período sin actividad | `lib/dashboards/load.ts` no miraba el `error` de ninguna consulta. Todo en cero, que es una afirmación ("no pasó nada") y era falsa |
| Un día sin mensajes faltaba en el gráfico | La serie traía solo los días con actividad, así que el gráfico mentía la forma de la semana |
| Un borrador vacío por falla del modelo era una fila en blanco | Decía "Fallaron el modelo principal y el de respaldo": cierto, y no dice qué hacer. Es exactamente lo que faltó el día que una API key revocada dejó al agente sin contestar |
| `dark:` seguía al sistema operativo y no al conmutador del perfil | Con el sistema en claro y la app en oscuro, todo lo escrito con `dark:` quedaba texto oscuro sobre fondo oscuro. Venía de la Etapa 1 |

## Lo que se construyó

- **Dos migraciones sin aplicar** (00110 y 00111): arreglan lo de arriba y suman
  las funciones que la pantalla necesitaba y no existían (quién respondió
  primero, por qué derivó, acciones del agente, resultados por regla, aprobación
  de respuestas, las tasas por semana, "qué le responden", el volumen por texto y
  el estado de la clasificación).
- **La pantalla de Chat de nuevo**, con carga por bloque: una promesa por bloque,
  su skeleton, y un error con Reintentar que no arrastra a los demás.
- **Los filtros del prototipo**: canal con punto de color y estado, "Respondido
  por" en tres grupos con avatares, y período con los 11 atajos y calendario de
  dos meses.
- **Settings con pestañas** y la pantalla de Tareas en segundo plano entera:
  tabla con botones segmentados, calidad, revisión rápida y textos de botón.
- **Filtros de runs por regla y por qué pasó**, que eran los que faltaban para
  poder contestar "¿qué hizo la regla 3?".

## Las decisiones que más costaron

| Decisión | Por qué |
|---|---|
| **Una promesa por bloque, y ningún loader que lance** | Si un loader rechaza, `use()` tira la pantalla abajo y Node loguea una promesa sin manejar. Devolviendo `{ ok: false }` siempre, un bloque roto es un bloque roto y nada más. Con tope de 15 s: una consulta colgada dejaría la respuesta HTTP abierta |
| **Los flags del agente salen de UNA función SQL** | Los tres números grandes y la mini línea de 8 semanas miden lo mismo. Calculado dos veces, un día uno dice 86 % y el otro 84 % y nadie sabe cuál creer |
| **DROP + CREATE en tres funciones** | Cambia el tipo de retorno y `CREATE OR REPLACE` no puede (42P13). Los GRANT mueren con la función y se vuelven a dar en el mismo archivo |
| **Mismo nombre para `chat_dashboard_patterns`, no una sobrecarga** | Dos versiones que solo difieren en parámetros con default dejan a PostgREST sin poder elegir: "Could not choose the best candidate function" |
| **Confirmar en la revisión rápida NO cambia `source`** | El texto lo sigue habiendo clasificado el modelo, y por eso cuenta como acierto en la precisión. Si pasara a `human`, el mismo texto quedaría afuera del cálculo que acaba de alimentar |
| **Ninguna función nueva toca `cost_usd`** | `authenticated` no puede leer esa columna (GRANT por columna de la 00060). Una función `SECURITY INVOKER` que la mirara fallaría con "permission denied" para cualquier persona real. El gasto se lee en Settings, en el servidor, detrás de `requireWorkspaceAdmin` |
| **El banner de ahorro no promete un descuento** | El lote real del proveedor todavía no está en uso: el modo económico agrupa pedidos. Decir "ahorrás el 50 %" sería mentir sobre la factura |
| **Versiones del clasificador en solo lectura** | La versión vive en una constante del código y evaluarla necesita llamar al proveedor. Mostrar botones que no hacen nada es peor que explicar por qué no están |
| **El arreglo de `dark:` es global, y se preguntó antes** | Cambia el comportamiento de todos los `dark:` de la app. Es lo correcto y lo que la gente espera, pero no es un cambio que una sesión deba hacer sola |

## Cuatro cosas que el pedido daba por ciertas y no lo eran

1. **La semilla de textos de botón tiene 12 textos, no 5.** La 00079 sembró los
   doce de §10.6; el prompt hablaba de cinco.
2. **`components/settings/settings-view.tsx` no existe.** El archivo vive en
   `app/(dashboard)/dashboard/settings/`, así que no era uno de los archivos de la
   otra sesión y no hubo que negociar nada.
3. **`response_rules` ya está concedida a `authenticated`** (00077), así que los
   nombres de las reglas se pueden leer con el cliente del usuario.
4. **El lint venía rojo en `main`** por un ref escrito durante el render en el
   booker (`use-embed-bridge.ts`), que no tiene nada que ver con esta corrida.
   Se arregló: si no, "lint sale 0" no se podía cumplir nunca.

## Cómo se probaron las funciones sin aplicarlas

Dos pasadas, porque una sola no alcanza:

1. **Sintaxis**, con el parser real de PostgreSQL 17 (`libpg-query`), y no solo
   sobre el archivo: el cuerpo de una función vive entre `$$` y para el parser es
   un string cualquiera. Se extrae cada cuerpo y se parsea aparte.
2. **Semántica**, corriendo cada cuerpo como un `SELECT` de solo lectura contra
   la base real, con los parámetros sustituidos por literales y las funciones que
   todavía no existen puestas en línea. Es la única forma de ver un nombre de
   columna mal escrito o una ruta de jsonb que no existe.

Las 15 corren. La segunda pasada encontró una: "También: …" venía con un `null` y
una cadena vacía adentro, porque un mensaje sin texto comparte el normalizado
vacío con otros. Un detalle, y de los que se ven en pantalla.

También dejó claro qué se va a ver al abrir: los 1.597 salientes de la base
tienen `origin = 'external'`, así que "Quién responde" muestra **una sola fila**
y la sección del agente dice que todavía no respondió nada. Es cierto: el agente
estuvo apagado y todo se contestó desde ManyChat o la app de Instagram.

## Las migraciones aplicadas, y lo que eso dejó ver

Se aplicaron la **00110** y después la **00111** (en ese orden: la segunda usa una
función de la primera). Las 19 funciones quedaron con una sola sobrecarga cada
una, `SECURITY INVOKER`, ejecutables por `authenticated` y cerradas para `anon`.
Como ya están aplicadas, **no se renumeran al mergear**: el número es parte del
registro, y los huecos 00102–00109 son la banda que se reservó para la sesión de
multimedia.

`verify-dashboards.mjs` se extendió con todo lo nuevo y salió **Todo verde**,
igual que `verify-rls.mjs`. Correrlo fue lo más útil de la tanda: encontró ocho
expectativas escritas a mano que ya no eran ciertas, **ninguna por un error de las
funciones**. Cinco eran del set fijo, que creció a siete conversaciones para poder
fijar la fila única de automatizaciones. Las otras tres eran mías, y las tres
enseñaron algo que conviene no volver a olvidar:

- **Un segundo episodio aparece solo**, en cuanto pasan más de 12 h sin mensajes.
  El bloque de patrones le suma entrantes a la conversación 1 seis días después, y
  eso es un episodio nuevo que nadie contestó: "sin respuesta" son dos, no una.
- **Los días de las tendencias se cortan en la zona del negocio.** Un rango que
  arranca a las 00:00 UTC empieza el día anterior en Costa Rica, así que del 5 al
  12 son nueve días y no ocho.
- **Un Member ve los episodios de sus conversaciones, no sus conversaciones.**
  Dos conversaciones pueden dar tres episodios.

## La revisión visual, con Wendy logueada

Wendy inició sesión y se recorrió Dashboards › Chat, Settings › Tareas y la cola
de borradores a 1440 y 390 px. Se probaron con clics reales, no solo mirados:
filtrar "Quién responde" por una fila (cambia la URL, oculta la sección del
agente con el aviso), tocar una categoría de Patrones (pide "Qué le responden" a
la Server Action nueva), y los dos accesos a Borradores desde el menú (van a
`?quien=todos` y el "Ver todos (5)" trae los cinco borradores reales).

**Ningún bug.** Lo único fuera de lo común son los datos reales: el agente actuó
en 3 % de 187 conversaciones, tal como se anticipó — estuvo apagado y ManyChat
contestó casi todo.

## Lo que queda

En `docs/PENDIENTE.md`. Lo principal: `knownButtonExtra` se conecta en
`runner.ts` después de mergear multimedia, y las versiones del clasificador
siguen en solo lectura.

---
## Contenido v3 — desatasque, atribución, modelo de la pieza, drawers y medición

**Fecha:** del 3 al 6 de octubre de 2026
**Rama:** `contenido-v3` (mergeada a `main` al final, una sola vez)
**Migraciones:** 00113 a 00117 **aplicadas** (con la CLI, porque el MCP de Supabase lo denegó el sistema de permisos); la **00118 escrita y sin aplicar, a propósito**.

### Qué se construyó

Cinco bloques, F73 a F105, con el plano en `docs/requerimientos-contenido-v3.md` y el avance paso a paso en `docs/PROGRESS-CV3.md`:

1. **B10 · Desatasque (F73 a F80).** Las cuentas sociales salen de la lista de Zernio; se sincronizan solas al guardar la clave, al desconectar y con los botones; el perfil trae las cifras reales; los comentarios huérfanos se vinculan cuando aparece la publicación; lo que se programa se valida en el servidor con la misma función que el editor (más el tope de TikTok); Social y las métricas pasan a permisos; y `e2e-zernio.test.ts` prueba de punta a punta que publicar sigue funcionando.
2. **B11 · Atribución (F81 a F88).** Un vocabulario cerrado, la tabla `contact_touches`, `record_contact_touch` en la base (recalcula primer y último toque desde la tabla), los receptores de mensajes y de comentarios que anotan toques, el alta manual, la importación y la reserva, y la ficha, el panel y los filtros que lo muestran. Backfill de 647 contactos.
3. **B12 · Modelo de la pieza (F89 a F94).** Pilares y ofertas (Ajustes → Contenido), un solo texto en la idea y guion + notas de grabación en la pieza, clasificación, biblioteca de archivos con formato y archivos por red, y la IA al modelo nuevo.
4. **B13 · Drawers y pantallas (F95 a F101).** El drawer de la idea (con galería) y el de la pieza, que reemplazan al editor y al detalle; la barra superior única; las rutas viejas redirigen; Social con perfil real y "Próximas"; y la cantidad de contactos por pieza en el tablero.
5. **B14 · Medir (F102 a F105).** El rendimiento por red de cada pieza (con edad, comparación a la misma edad, índice y leads) y el dashboard de contenido agrupado y filtrado por pieza, oferta, pilar y etapa del embudo.

### Las decisiones que más costaron

**Instagram no crea un contacto por cada comentarista.** Se vincula el comentario solo si la persona ya es contacto o si la automatización la creó. Crear uno por comentario llenaría el CRM de gente que solo opinó y dispararía "contacto nuevo" para cada una. TikTok sí crea un contacto anónimo, porque no tiene mensajes directos y el comentario es la única señal que va a haber. (Decisión de Wendy.)

**De los mensajes solo se anota el toque que suma información.** Un contacto activo manda cientos; una fila "Instagram · mensaje directo" por cada uno haría que el "último toque" cambie con cada "ok". Cuenta el primero, una respuesta a historia, un dato de anuncio y la vuelta tras 7 días. (Decisión de Wendy.)

**Medir por edad y contra la mediana.** Un Reel de 10 días y un Short de 3 no se comparan con los números de hoy. El índice usa el engagement a 7 días contra la mediana de la misma red y el mismo formato de los 90 días previos, con un mínimo de 3 comparables: con menos, "base insuficiente" y los crudos a la vista. Es el mismo criterio que el salto de seguidores: dos reglas para el mismo problema confunden. Y **nunca un cero inventado**: lo que la red no da es un guion, y LinkedIn muestra su aviso.

**La base se migra antes que el código.** Las migraciones son aditivas, así que el código viejo sigue andando; la 00118 (la única que borra) quedó escrita y sin aplicar, con dos consultas en la cabecera que tienen que dar 0 antes de correrla. Todas se ensayaron antes en una transacción que se deshace sola, sembrando filas de prueba.

**Un solo merge a `main`, al final.** Hasta que todo estuvo en verde no se tocó `main`.

### Lo que encontraron las pruebas, y por qué importó

- **`savePostDraft` no validaba nada:** las redes y la media se escribían tal cual llegaban. Ahora se validan con Zod y los ids se limpian contra la biblioteca real.
- **El aviso "alguien más editó esta pieza" saltaba de mentira** desde el segundo autoguardado: se comparaba con la fecha de la primera carga. Se arregló con la fecha de la última escritura, y el drawer conserva esa lógica.
- **Un test llegó a hacer pedidos reales a Zernio** con una clave falsa. No salió ninguna credencial real, pero rompía la regla de no llamar a un proveedor: ahora los tests de ese camino hacen fallar cualquier `fetch` real.
- **Los tests de mutación** (quitar una pieza y ver si el test se pone rojo) encontraron un hueco en B14: ningún test distinguía "el total de leads de la pieza" de "la suma de las filas". Con el test nuevo, los 14 mutantes quedan en rojo; los siete de B10 también.
- **La revisión en vivo** encontró textos mal conjugados ("Nombre del oferta nuevo") y el desborde de una tabla a 390 px.
- **`CLAUDE.md` estaba desactualizado:** decía que la 00105 y la 00106 no estaban aplicadas (sí lo están) y que la próxima migración era la 00107 (es la 00119).

### Lo que queda

En `docs/PENDIENTE.md`. Lo principal:

- **Aplicar la 00118** cuando la v3 esté funcionando con piezas reales (con respaldo y las dos consultas de la cabecera en 0).
- **Volver a correr la 00115** después del despliegue, para dar toque a los contactos que entren entre la migración y el despliegue (es idempotente).
- **Las migraciones 00113 a 00117 no están en el historial de Supabase** (la CLI no lo registra y el sistema de permisos negó el INSERT). Nada del código lo lee.
- **Verificar en vivo con cuentas conectadas:** los datos de anuncio en un DM, el webhook de Zernio, la versión de la API de LinkedIn y el índice con métricas reales: hoy no hay cuentas conectadas.
- **Cosmético:** los nombres "Youtube", "Linkedin" y "Tiktok" salen de `platformLabel`, que un test fija a propósito.
