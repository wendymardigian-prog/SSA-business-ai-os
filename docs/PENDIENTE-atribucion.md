# Pendiente · Webhooks entrantes, atribución y anuncios (Extra L)

Formato de cada entrada: **qué quedó**, **por qué**, **qué se decidió**.
Avance: [PROGRESS-atribucion.md](PROGRESS-atribucion.md).

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar.** Un caso, "todos los contactos reales tienen
  first_touch" (775 de 834). Es una comprobación de datos del backfill de la 00115 sobre contactos reales:
  los contactos creados después no tienen toque. Ya lo había anotado Formularios. **Decidido:** se anota y
  no puede empeorar; los demás casos pasan. El conteo sube solo con cada contacto nuevo sin toque.
- **`verify-sales.mjs` falla antes de empezar.** Un caso, "con todas las reglas en manual, crear un
  contacto NO encola nada" (00161). **Decidido:** no es de este módulo; se anota y no puede empeorar.
- **`verify-knowledge.mjs` no se corre** (llama a Voyage de verdad, con costo) y **`verify-webhook.mjs`
  tampoco** (necesita la app corriendo en local). Mismo criterio que Formularios.
- **`verify-rls`, `verify-roles` y `verify-workspace-isolation`** se corren con los flags
  `--despues-de-00143`, `--despues-de-00136` y `--despues-de-00147`, como dejó Llamadas. Ojo con zsh: una
  variable con varios flags sin comillas llega como UN solo argumento; pasarlos escritos a mano.

## Decisiones tomadas con Wendy (12/10/2026)

- **#254 → "solo el último".** Un contacto que ya existía y no tenía toques recibe antes un toque ancla
  `manual` (fecha de creación del contacto) y después el toque del webhook, así `record_contact_touch` no
  se toca.
- **"Asistió"** = `status_group = 'outcome'` de la agenda (el estado "asistió" no existe).
- **Ventas "no canceladas"** = se excluyen `cancelled` y `refunded`.
- **#260** reprocesar vuelve a mandar mensajes, con aviso y confirmación.

## Verificación en vivo (la hace Wendy, §11 del plano)

Pendiente hasta el final de la corrida; se completa con el resultado de cada punto.

- Formulario externo real (Framer, Typeform o Tally) → webhook → contacto con UTMs; repetir el envío no duplica.
- Respuesta a una historia, mención en una historia, anuncio de mensaje a Instagram (**pendiente desde la
  Fase 3**), anuncio de clic a WhatsApp, comentario en un anuncio.
- Agenda desde una landing con `?utm_content={{ad.id}}`; la misma persona navegando a la agenda sin
  parámetros usa la cookie.
- Parámetros de URL de los anuncios en Meta (`utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`).
- Revisión visual en la app con sesión, si no se pudo hacer en la corrida.

## Entradas de la corrida

### WH1 — decisiones que se apartan del plano (qué quedó, por qué, qué se decidió)

- **Las dos tablas de webhooks no tienen policies de INSERT, UPDATE ni DELETE para `authenticated`.** El plano
  decía "INSERT, UPDATE y DELETE con `flows.edit`". **Por qué:** el token se genera en el servidor y no tiene que
  pasar por el navegador, y `has_permission` devuelve false para el Member de sistema (sus claves viven en
  `lib/auth/permissions.ts`) aunque tenga `flows.edit`. **Decidido:** escribe solo el servidor (Server Actions con
  `getPermissionAction("flows.edit")`), la lectura de la pantalla también va por el servidor después de chequear
  el permiso en TypeScript, y la RLS (`has_permission`) queda como segunda barrera más estricta. Lo prueba
  `verify-inbound-webhooks.mjs`.
- **No hay columna `rejected_count_24h`.** El plano dejaba elegir entre esa columna y el limitador. **Decidido:** los
  rechazos por tope los cuenta `bump_rate_limit` (clave `hooks:<endpoint>`, 600 por hora); no se guardan.
- **`webhook_endpoints` suma `last_error_alert_at`** (el último aviso de errores, para avisar una vez por hora) e
  **`inbound_webhooks` suma `processing_started_at`** (el reaper rescata los `processing` colgados: los marca `error`
  para que una persona los reprocese, no los vuelve a correr solos porque ya pudieron mandar mensajes).
- **La retención a 12 meses (borrar la fila) necesita, desde M2, borrar antes las sesiones de flujo terminadas sin
  contacto de ese envío** (su FK es `ON DELETE SET NULL` y dejaría una sesión que viola el CHECK). Hoy no hay
  ninguna; se agrega en WH2 junto con M2.
- **Revisión visual a 1440 px solo en tema oscuro**; el tema claro se miró a 390 px. Los componentes usan solo
  tokens de color (`bg-card`, `border-border`, `text-muted-foreground`…), sin `dark:`.
- **Reprocesar usa `confirm()` del navegador**, como otras confirmaciones simples del sistema.


### WH2 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **`verify-forms.mjs` es intermitente** (pasa al reintentar): el job que genera el PDF de un contrato lo toma el cron
  de producción en paralelo y el script ve «already». No es de este módulo y no se tocó; en el punto de partida pasó
  a la primera por suerte. Al cierre se corre hasta que pase y se muestra la salida.
- **Los pasos con contacto después de «Crear o actualizar contacto» toman la conversación MÁS RECIENTE del contacto**
  (igual que un flujo de agenda o del CRM). Un contacto recién creado no tiene ninguna: «Enviar mensaje» se saltea
  con motivo hasta que haya una conversación. Es lo que hace el motor hoy para esos casos; no se inventó otro canal.
- **Los tags «desde el payload» solo suman tags que ya existen** (comparación sin mayúsculas); el resto se ignora y
  queda anotado como nota (`tag_inexistente:<nombre>`). No se crean tags desde datos de afuera. Los tags fijos son
  ids de tags del negocio.
- **El conflicto de identidad** (teléfono de uno, email de otro): se usa el contacto del teléfono, no se fusiona, el
  dato en conflicto no se escribe, y queda en el resultado del envío y en el historial del contacto (`contact.linked`
  si no cambió nada, `contact.updated` si sí).
- **La sesión de un flujo y el aviso de «Esperar» llevan una copia del payload** (`flow_sessions.variables` y el payload
  del job `resume_flow`). La retención de 90 días vacía el envío, no esas copias: si hace falta, sumarlas a la purga.
- **El resultado de un flujo en «Esperar» queda como «En curso»**; lo que pase después de la espera (la reanudación la
  hace el cron de jobs) no se vuelca al historial del envío.
- **El panel del disparador queda abajo de la lista de tipos** (mismo patrón que Formularios y Ventas): conviene un
  rediseño del selector de disparadores en otra pasada.
- **Teléfono sin país conocido:** si la zona horaria del negocio no da un país, un número sin prefijo queda «solo
  dígitos» (como pide el plano). El negocio no tiene un campo de país por defecto.
- **Flujos `zz-test` viejos:** al limpiar los datos de la revisión visual se borraron 7 flujos con el prefijo
  `zz-test` que ya estaban en la base real (datos de pruebas de módulos anteriores).


### AT1 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **F20 (respaldo desde la conversación de Zernio) no se construyó.** Es nice-to-have y para probarla de verdad
  hace falta leer una conversación real de Zernio, cosa que esta corrida no puede hacer (nada externo real). Queda
  para una pasada con una cuenta conectada. El toque del mensaje ya guarda `origin_context`, así que no se pierde
  el dato desde ahora: lo que falta es recuperar el de mensajes viejos.
- **`verify-attribution.mjs` sigue con el mismo caso de datos** ("todos los contactos reales tienen first_touch",
  776 de 835; en el punto de partida eran 775 de 834). El contador crece solo porque entra un contacto nuevo sin
  toque; no es un cambio de código. El resto de sus casos pasa.
- **`verify-message-persistence.mjs` no verifica nada acá**: dice «No hay un canal de Zernio en este workspace». La
  columna `messages.origin_context` y el reintento sin ella (si la base no la tuviera) se cubren con los tests de
  `lib/inbound.test.ts`.
- **`buildDesiredTriggers` nunca persistió `storyReply`** (es anterior a este módulo). Solo se persisten los dos
  filtros nuevos (`fromAdOnly`, `storyMentionOnly`) y `storyReply` quedó como estaba. Conviene revisarlo aparte.
- **La ficha del contacto muestra ids crudos** (campaña, conjunto y anuncio) hasta que AT2 y AT3 traigan el
  catálogo de Meta: ahí pasan a ser nombres y miniatura.
- **Clic en la agenda con `gbraid`/`wbraid` y otras claves**: la agenda ahora acepta todas las claves de
  `TOUCH_KEYS`, así que dejan de precargarse como respuesta del formulario (cambio menor, previsto en el plan).
- **`create_booking` sigue poniendo `medium = 'booking'`** siempre; no se tocó (fuera del plano).
