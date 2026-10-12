# Pendiente · Módulo Formularios

Formato: **qué quedó · por qué · qué se decidió**.

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar.** Un caso, "todos los contactos reales tienen first_touch" (732 de 791). Es una comprobación de datos del backfill de la 00115 sobre los contactos reales: los contactos creados después no lo tienen. No es del módulo; se anota y no puede empeorar. Los demás casos (toques, RLS, triggers de alta) pasan.
- **`node scripts/export-template.mjs` falla antes de empezar.** Su control de nombres encuentra 12 restos identificables en tests de Llamadas (`lib/calls/**/*.test.ts`, `lib/flow-engine/registry/call-triggers.test.ts`, `lib/knowledge/index-text.test.ts`). La definición de listo pide que el export deje el sitio por defecto, así que se arreglan esos 12 datos de ejemplo en F30 (un cambio de texto en los tests, sin tocar código de Llamadas).
- **`verify-knowledge.mjs` y `verify-webhook.mjs` no se corren en esta entrega.** El primero llama a Voyage de verdad (un proveedor de IA real, con costo); el segundo necesita la app corriendo en local. Formularios no toca Conocimiento ni los webhooks. Decidido con Wendy (11/10/2026).
- **`verify-rls`, `verify-roles`, `verify-audit-visibility` y `verify-workspace-isolation`** se corren con los flags `--despues-de-00143`, `--despues-de-00136` y `--despues-de-00147`, como dejó Llamadas.

## Diferencias entre el plano y el código real (gana el código)

| # | El plano supone | Lo real | Qué se hizo |
|---|---|---|---|
| D-1 | `lib/contacts/dedup.ts` busca teléfono → email | Hace una sola consulta `.or()` sin orden. Teléfono → email lo hacen `create_booking` y `find_or_link_contact` | `find_contact_by_phone_or_email` copia el criterio de `create_booking` (00129). `dedup.ts` no se toca |
| D-2 | `MEMBER_KEYS` y tabla del Member en `member-baseline.test.ts` | `MEMBER_KEYS` es interno; la lista escrita a mano está en `member-permissions-characterization.test.ts` | Se suma `forms.view` ahí, con comentario; `member-baseline.test.ts` suma páginas, acciones y nombre del menú |
| D-3 | Ítem de menú sin `adminOnly` | `NavItemMeta` exige `adminOnly`; los títulos salen de `PAGE_META` | `adminOnly: false` y entradas en `PAGE_META` |
| D-4 | Tipo `TouchEntry` | Es `TouchInput`; `RAW_KEYS` no se exporta | `formTouch` devuelve `TouchInput`; F33 solo suma claves |
| D-5 | El toque de la Agenda pasa por `sanitizeRaw` | Se arma en SQL y no pasa por `sanitizeRaw` | La caracterización fija la forma de su `raw` y las dos de Zernio |
| D-6 | `answerToText` en `booking-fields.ts` | Está en `lib/scheduling/automation/variables.ts` | Se importa de ahí |
| D-7 | Sección "Seguridad" en Integraciones | `ProviderSection` es `connections \| ai` | Se suma `security` |
| D-8 | Sumar archivos a `vault-boundary.test.ts` | Un `it` por destino | Se generaliza para que recorra todo `SERVER_ONLY` |
| D-9 | `crm-triggers.ts`; handlers en `lib/jobs/handlers/index` | No existe; los handlers se registran en `registerPublishing()` | `form-triggers.ts` copia `call-triggers.ts`; los jobs se registran en `lib/publishing/bootstrap.ts` |
| D-10 | `buildDesiredTriggers` copia la config entera | Copia clave por clave | Las claves de formulario no chocan con `NODE_ONLY_KEYS`; lo fija un test |
| D-11 | — | `linearToFlow` pierde `fixedEmail` | Arreglo aditivo en `linear-flow.ts` (F21) |
| D-12 | — | El cron trata como "booking" cualquier payload con `booking_id` y aplana el payload con `String(v)` | El payload de formulario son solo escalares y nunca lleva `booking_id` |
| D-13 | `TriggerPanel` agrupado | Array fijo y config escrita a mano | 3 entradas y un bloque `FORM_TRIGGERS` |
| D-14 | `robots.ts` "suma el sitemap" | Bloquea todo | Sigue bloqueando todo y permite solo las rutas de `lib/site/pages.ts` |
| D-15 | `/` con sesión | `app/page.tsx` redirige a `/login` | Se mueve a `app/(sitio)/page.tsx` |
| D-16 | `export-template.mjs` testeable | Ejecuta `main()` al importarse | Test por proceso; en F30 se extiende |
| D-17 | Tests de componentes | Vitest solo corre `**/*.test.ts` en node | No se portan los `.test.tsx` de prevxcrm; la lógica va a funciones puras |
| D-18 | shadcn | SSA no tiene shadcn, Radix, sonner, dnd-kit ni date-fns | Se traduce a los componentes de SSA; orden con flechas |
| D-19 | Buscador de contactos reutilizable | No hay | `searchContactsForForm`, mismo patrón que Llamadas |
| D-20 | `email-retry-utils` con tests | No tiene | Se portan y se escriben los tests |
| D-21 | `<Historial>` | Props `{entityType, entityId, names?, timeZone?, pageSize?}` | Se usa tal cual |
| D-22 | `{{contact.first_name}}` en el armador de links | Solo se resuelven `display_name`, `email` y `phone` | El armador ofrece solo esas tres; `first_name`/`last_name` queda como mejora transversal |

## Decisiones de la corrida

- **Turnstile, Resend e IA siempre simulados**, también en `verify-forms` (que corre el envío real contra la base con un `fetch` simulado).
- **`verify-forms` corre con `vite-node`** (como `verify-publishing`): ejecuta el código real de `lib/forms/submit.ts`.
- **Backup:** alcanza el backup diario de Supabase Pro (decidido con Wendy).
- **Validación de respuestas sin Zod:** `validateSubmission` (en `lib/forms/submission-schema.ts`) es una función que devuelve errores por clave, no un esquema Zod: la visibilidad encadenada hace que el esquema dependa de las propias respuestas. La misma función corre en el navegador y en el servidor. Zod valida la forma de la definición y de la config.
- **`renderSuccess` escapa por defecto** (como pide el plano); la API de envío lo llama con `escape: false` porque React ya escapa los nodos de texto.
- **`lib/attribution/collect.ts` trae su propio `safeUrl`** en lugar de importar `safeReferrer` de la Agenda: ese módulo importa `node:crypto` y la atribución tiene que poder ir en el bundle del embed. Un test verifica que ambos dan lo mismo.

## Bloque FO1 · decisiones y pendientes

- **`get_public_form` devuelve además `contract.title` y `contract.accept_label`.** La página pública del contrato los necesita (título y texto de la casilla) y el plano solo nombraba `text` y `version_number`. Siguen siendo datos públicos del formulario; la lista blanca de claves prohibidas no cambia.
- **`submit_form_response` tiene un octavo parámetro `p_extra jsonb default '{}'`.** Lleva lo propio de cada tipo (la carpeta de archivos hoy; la firma del contrato en FO3) para no tener que cambiar la firma de la función en cada migración.
- **El test del beacon vive en `lib/forms/beacon.test.ts`** (no en `app/api/public/forms/beacon.test.ts`): la lógica está en `lib/forms/beacon.ts` con puertos inyectables y la ruta es un envoltorio de 20 líneas. Lo mismo con el envío (`lib/forms/submit.ts` y `submit.test.ts`).
- **Las métricas por día se dibujan con barras propias (sin `recharts`).** Son dos series y hasta 366 días; evita sumar un chunk de gráficos a una pantalla chica. Tiene la tabla equivalente en "Ver como tabla" (accesibilidad). Las métricas por campo (promedio, opciones, últimos textos) son el porte de `form-metrics.ts`.
- **Las respuestas vienen de la RLS, no de una consulta con filtros de permisos**: un Member que inventa filtros en la URL sigue viendo solo lo suyo.
- **La lista de formularios cuenta envíos sobre las últimas 10.000 respuestas visibles** (no tiene un conteo exacto por formulario). Alcanza para una idea; con más volumen conviene una función de conteo.
- **`Popover` suma la opción `closeOnSelect`** (apagada por defecto; no cambia a ningún otro uso): el menú de acciones y el selector de tipos de campo tienen que cerrarse al elegir.
- **Falta (llega en los bloques siguientes):** las pestañas Contacto y Automatizaciones (FO2), Encuesta y Contrato (FO3), y en Publicar el "link firmado para un contacto" (F22) y la tarjeta "Usar en una página del sitio" y los parámetros de URL (F32). El `Historial` del detalle de una respuesta se ve solo para Owner/Admin (no se toca `audit_log_select`).
- **La card de Turnstile se verificó por las pruebas (`providers.test.ts`, `test-connection.ts`) y por el catálogo**, pero no se guardó una clave real: la clave de Cloudflare real la carga Wendy en la verificación en vivo (§18 del plano).

## Bloque FO2 · decisiones y pendientes

- **El link "Ya respondiste" de una encuesta con `?c=` válido llega en FO3** (F22): hoy `oncePerContact` lo hace cumplir la base (la RPC devuelve `already_answered` ANTES de tocar el contacto), pero la página pública todavía no muestra "Ya respondiste" antes del formulario. Se hace junto con la pestaña de la encuesta, que es donde se prende esa opción.
- **Vincular a mano una respuesta NO anota un toque de atribución.** La respuesta puede tener días y un toque nuevo sería "ahora": pisaría el último toque real del contacto con uno atrasado. Si se quiere, es una mejora aparte (anotarlo con `occurredAt` = fecha de la respuesta).
- **Una respuesta marcada como spam no avisa a la campana** (aunque se haya guardado); el aviso de una respuesta normal llega siempre, incluso con el contacto en "no contactar" (no pasa por el motor de flows).
- **El aviso va a Owner y Admin si no se elige a nadie** (`recipient_id` vacío, como el resto de los avisos del sistema). Un formulario nuevo nace con quien lo creó elegido.
- **`{{form_link.<slug>}}` solo se resuelve para formularios publicados**; para uno en borrador, pausado o archivado el token queda tal cual (como pide el plano para uno inexistente). Quien arma el mensaje lo ve en la prueba por email.
- **Las plantillas "Mandarle un mensaje de gracias" usan `{{contact.display_name}}`**, no `first_name`: `contact.first_name` no se resuelve en ningún lado del motor (las plantillas de la Agenda lo usan y salen con la llave cruda; no es de este módulo, se anota para revisar la Agenda aparte).
- **`flowToLinear` devuelve el `triggerType` dentro de `trigger.config`** (siempre lo hizo: es el `data` del nodo entero). La ida y vuelta de un flujo de formulario conserva pasos, condiciones y tipo de trigger; el test fija eso y que reconvertir no cambia el grafo.
- **El panel de triggers lee los formularios del lado del navegador** con la sesión (la RLS decide cuáles ve cada quien), igual que el panel de secuencias.
- **`verify-rls` se cortó una vez con un error de Node al final de una corrida** y a la siguiente dio "Todo verde" (exit 0). Parece un corte de red al limpiar; si se repite, mirar `scripts/verify-rls.mjs`.
- **Hallazgo fuera del módulo: la lista de flujos de un evento de la Agenda siempre sale vacía.** `lib/scheduling/data/event-flows.ts` (`flowsForEventType`) filtra por `flows.deleted_at`, y esa columna no existe (la base responde 42703 y el código devuelve `[]`). Lo encontré porque mi primera versión de `lib/forms/data/form-flows.ts` copió el mismo filtro y la pantalla daba 404. En Formularios está corregido y con un test; en la Agenda no se tocó (fuera del plano): queda propuesto como tarea aparte.
- **Revisión visual de FO2** (navegador integrado, con la sesión de Wendy; un formulario `zz-visual` y su automatización, creados y borrados): pestañas Contacto y Automatizaciones, editor lineal de una automatización de formulario, panel del trigger en el canvas (formulario elegido, mensaje claro si el formulario no tiene campos publicados) y el editor lineal de un flujo de la Agenda, que se ve igual que antes (mismo encabezado, secciones, variables y botones). No se apretó "Enviarme una prueba": llamaría a Resend de verdad.
- **El canvas muestra "Action / Not configured" para un nodo `send_email`** (también en las plantillas de la Agenda): es cómo el canvas dibuja ese nodo, no de este módulo.

## Bloque FO3 · decisiones y pendientes

- **Hubo una migración más que en el plano: la 00158.** `verify-forms` encontró, al sumar los casos de la encuesta, un error de la 00156 (FO2): "una vez por contacto" guardaba la primera respuesta de una persona nueva con la clave `email:<email>` y buscaba la segunda con `contact:<id>`: nunca coincidían y se podía responder dos veces. La 00158 guarda siempre `contact:<id>` cuando hay contacto y, para decidir si ya respondió, mira las dos claves. Se aplicó (dos veces: idempotente) y se registró; volver atrás es pegar la v3 de su cabecera. No afecta a los formularios comunes ni a los contratos. Se hizo como migración nueva (y no editando la 00157) para que el historial cuente lo que pasó.
- **D-23: `record_contract_signature` recibe además `p_signer_name` y `p_signer_email`** (el plano nombraba tres parámetros). Los calcula el servidor desde las respuestas ya validadas (`signerEmailField` = el primer email obligatorio, `signerNameFromAnswers`); hacerlo en SQL obligaba a repetir esa regla.
- **La IP de la firma se guarda en claro solo en `contract_signatures.legal`** (evidencia legal) y se muestra a quien ve la respuesta. En `form_submissions.meta` va hasheada, como en todo el sistema. Un test del script verifica que la IP en claro no aparece en la respuesta.
- **La evidencia de una firma no se puede cambiar, ni con el service role** (trigger `contract_signatures_protect`): huella, versión, firmante, imagen, hora, metadata legal y los ids de venta y servicio. Solo cambian `pdf_*` y `email_*`. Cuando Ventas y CX sumen sus claves foráneas, esas columnas van a poder seguir sin cambios.
- **El cuerpo del email no incluye la huella entera**, solo sus primeros 16 caracteres; la entera está en el PDF y en la ficha de la firma.
- **Si la imagen de la firma se subió y la RPC falla, la imagen se borra** (mejor esfuerzo). Una caída entre la subida y el borrado dejaría un archivo huérfano de menos de 200 KB en `contracts/`; no hay barrido de huérfanos (no hay un barrido equivalente para `form-uploads` tampoco): se anota para el día que haga falta.
- **Los jobs de contratos no lanzan por un fallo de un proveedor** (como los de Llamadas): reintentan solos a +5, +15 y +30 minutos (`scheduleJob`, no la cola) y después quedan visibles (`failed` o `not_sent`) con "Regenerar PDF" y "Reenviar copia".
- **Las copias a direcciones fijas (`ccEmails`) van como envíos aparte** y su resultado no cambia el estado de la copia al firmante: si falla una, queda en `email_log`.
- **La pantalla de éxito de un contrato** dice "Listo. Te mandamos la copia firmada a <email> en unos minutos." cuando el formulario conserva el mensaje por defecto (incluido el vacío con el que nace en la base); si la persona escribió el suyo o una redirección, manda el suyo.
- **El editor de contrato no tiene variables en el texto** (la huella es sobre un texto fijo; prellenar el contrato desde la venta llega con Ventas).
- **Falta la verificación en vivo con proveedores reales** (§18 del plano, fuera de la definición de listo): una clave real de Turnstile y un envío real del contrato por Resend con el adjunto, para confirmar el límite de tamaño del adjunto. Hasta entonces el email se verifica con `fetch` simulado.
- **Revisión visual de FO3** (navegador integrado, con la sesión de Wendy; formularios `zz-visual` creados y borrados, sin dejar filas ni jobs): la página pública del contrato a 1440 y a 390 px (texto con negrita, cursiva, listas y ñ/¿, casilla, lienzo de la firma con "Borrar", botón que se habilita con la casilla y el trazo), el editor de contrato (texto con vista previa y configuración), el editor de encuesta y el panel NPS con 15 respuestas sembradas (NPS 33, 53 % de promotores, 20 % de detractores, distribución por color, evolución por semana con "pocas respuestas" y comentarios). No se firmó un contrato desde la pantalla: la clave de Turnstile real la carga Wendy; el envío se verificó con `verify-forms`.

## Bloque FO4 · decisiones y pendientes

- **D-24: las páginas del sitio mandan `frame-ancestors 'none'` y `X-Frame-Options: DENY`**, no `'self'` como decía el plano. Es lo que ya recibe todo lo que no es `/calendario`, `/embed` o `/f`, y es más estricto: ningún sitio puede embeberlas. Un test fija que `/` y `/ejemplo` no se embeben y `/f/x` sí.
- **El cookie `ssa_attr` va en base64url**, no en JSON crudo: un JSON de 3,5 KB codificado como URL pasaría el tope de 4 KB de una cookie. El valor guardado en la cookie se limita a 2,6 KB de JSON (el `localStorage` de una web externa admite los 3,5 KB). La lectura vuelve a sanear todo y descarta lo de más de 90 días.
- **El script de embed anota la visita SIEMPRE que se carga** (no solo con `data-agenda-track`): el atributo existe para el caso "solo seguimiento", sin formulario ni agenda, pero el mismo `embed.js` hace las dos cosas. Los embeds de la Agenda no cambian su URL.
- **`attr` ahora lleva la atribución efectiva de la web que embebe** (la de su URL o, si no trae nada, la última guardada, más la primera visita y las cookies de los anuncios) y solo se manda si trae atribución; un sitio sin nada no manda `attr`. Si no entra en 2 KB se sueltan primero la primera visita y después las páginas.
- **El beacon suma `origin` a la metadata** de `form_view` y `form_start` (página del formulario, embed o sitio), sin datos personales; el pedido sin `origin` sigue igual.
- **`<Formulario>` guarda la definición en caché de Next por etiqueta `form:<slug>` con renovación de 1 hora** como respaldo (`unstable_cache`). Publicar, pausar, reanudar, archivar y cambiar el link invalidan la etiqueta (el viejo y el nuevo slug); una falla al invalidar se registra y no tumba la acción.
- **El armador de links ofrece solo `{{contact.display_name}}`, `{{contact.email}}` y `{{contact.phone}}`** (decidido con Wendy): `first_name` y `last_name` no se resuelven en ningún lado del motor. Queda como mejora transversal.
- **La página `/f/<slug>` también anota la atribución** (monta `AttributionTracker` cuando no está embebida ni en vista previa).
- **No hay un test que renderice `<Formulario>` ni `AttributionTracker`** (Vitest solo corre `.test.ts` en node, sin DOM): la lógica está en funciones puras con tests (`lib/forms/site-submit.ts`, `lib/attribution/*`) y los componentes se verificaron en el navegador.

## Correcciones del 12/10 · decisiones y pendientes

- **Numeración.** El plano decía "desde la 00169"; Ventas ocupó la 00169 a la 00171 mientras tanto, así que la banda de esta corrida es la **00172 a la 00177**. Se aplicó **todo antes de desplegar** (no la 1, 2 y 5 con el despliegue): no hay formularios en producción y el código viejo ya no podía publicar ni enviar (Turnstile sin configurar), así que ninguna migración le rompe nada. La 00174 (`get_public_form` con `social`) es una migración más que en el plano.
- **Turnstile: no había nada que migrar** (ninguna fila `captcha` ni secreto `turnstile_secret_key` en Vault al 12/10). Si algún clon lo tuviera, la 00173 aborta con un mensaje y el secreto de Vault habría que borrarlo a mano.
- **R2 / IP real.** Railway documenta `X-Real-IP` "para identificar la IP remota del cliente" (https://docs.railway.com/networking/public-networking/specs-and-limits) pero **no dice si el proxy pisa un valor que mande el navegador**, ni qué pasa con `X-Forwarded-For`. Sin una respuesta clara **no se cambió nada**: `clientIp` (`lib/scheduling/antispam.ts`) sigue tomando el primer valor de `x-forwarded-for`, que el navegador puede escribir, y alguien que lo cambie en cada pedido se salta el tope. **La Agenda tiene el mismo problema** (usa la misma función). Para resolverlo: probar con un pedido real al servicio desplegado con `X-Real-IP` y `X-Forwarded-For` falsos y ver qué cabecera sale intacta; después `trustedClientIp(headers)` en `lib/antispam/`, solo para formularios y luego para la Agenda.
- **R3.** Una encuesta ya publicada con "una vez por contacto" que pase a `none` no se puede volver a publicar hasta sacar el límite (lo dice el mensaje). Si el modo se cambia a `none` con la encuesta ya publicada, la versión vigente sigue respondiendo y simplemente no limita (no hay contacto con quien comparar).
- **R4.** Si el mapeo del borrador lo edita otra persona a la vez, gana el último guardado (el guardado conjunto usa el mismo control de concurrencia del borrador). El aviso de publicar mira el mapeo **guardado**, no una edición pendiente en la pestaña Contacto.
- **R5 / `is_anonymous`.** La base calcula sola si un contacto es anónimo y su lista de datos solo mira email, teléfono, WhatsApp e `instagram_username`, **no TikTok, X, LinkedIn, Facebook ni YouTube**. Un contacto creado solo con un @ de TikTok **habría quedado "anónimo"** teniendo un dato real; por eso el formulario le pone el @ de nombre (así deja de contar como anónimo por el nombre). Queda como **mejora transversal**: sumar esas columnas a la expresión generada de `contacts.is_anonymous` (no se tocó en esta corrida).
- **R5 / conflictos.** Si un @ ya es de otro contacto, **no se escribe** en el contacto vinculado (para no dejar dos contactos con el mismo identificador); queda en `dedupe.conflicts`. El teléfono y el email siguen como antes (se escriben aunque el otro dato choque).
- **R5 / Facebook y YouTube** solo se guardan; la búsqueda es por Instagram, TikTok, X y LinkedIn (por el slug de la URL, con un índice sobre `linkedin_slug`). `find_contact_for_form` compara en minúsculas con índices por expresión; los 564 contactos con `instagram_username` están todos en minúsculas y sin "@".
- **R5 / `validateContactField`** (la ficha) acepta cualquier usuario sin espacios; no se unificó con `normalizeSocialHandle` para no volver más estricta la edición manual. Un test fija que dan lo mismo para un @ simple.
- **R6.** Los códigos ISO salen de una lista fija (250: los 249 de ISO 3166-1 y Kosovo); los nombres, de `Intl.DisplayNames` (es y en), más unos pocos alias (EEUU, UK, Holanda…). Un país en otro idioma no se reconoce.
- **R7.** `attr` del embed no se ve afectado por el "+" (viaja en base64url). Un campo oculto de tipo parámetro de URL conserva el comportamiento estándar (un "+" es un espacio).
- **R8 / formularios enviados pero no respondidos.** Registrar cuándo se le mandó el link a alguien (para mostrar "enviado, sin responder") queda como **mejora**: hoy no se guarda el envío del link.
- **R8 / "Ver todas"** es una página propia (`/dashboard/contacts/<id>/formularios`), no un filtro `?contacto=` en la tabla de respuestas (esa tabla es de un solo formulario).
- **R9.** El candado deja pasar `published_by` de una persona a NULL: es el `ON DELETE SET NULL` de la clave foránea, y sin eso no se podría borrar a quien publicó algo. Y protege también `workspace_id` (el plano no lo nombraba).
- **verify-forms tiene una carrera con el cron de producción** ("el job genera el PDF de la firma"): si el worker de producción genera el PDF antes que el script, `runContractPdf` devuelve `already` y el caso falla; en la segunda corrida pasó. Ya existía antes de esta corrida (el job se encola en la misma transacción que la firma). Una mejora: que el script lea el estado en vez de exigir `generated`.
- **`verify-sales` de esta rama** consulta `content_offers`, que la otra sesión de Ventas borró en la base (00171); la versión actualizada está en su carpeta sin commitear. No es de Formularios.
- **El archivo de plano** (`docs/requerimientos-formularios.md`) y los PROGRESS/PENDIENTE de arriba conservan sus menciones de Turnstile: son el historial de lo que se construyó antes de sacarlo.
- **Pendiente de Wendy:** la verificación con Resend real (adjunto del contrato) sigue sin hacerse; la de Turnstile ya no aplica.
