# Progreso · Módulo Formularios (personalizado, encuesta/NPS, contrato y sitio público)

Rama `feat/formularios`. Plano: [requerimientos-formularios.md](requerimientos-formularios.md).
Pendientes y decisiones: [PENDIENTE-formularios.md](PENDIENTE-formularios.md).

## Punto de partida (11/10/2026, `main` en `4a19a2f`)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | 547 archivos, 6.865 tests, todo en verde |
| `npm run build` | compila (exit 0) |
| `npm run lint` | 0 errores, 36 avisos (techo: no puede haber errores nuevos) |
| `verify-rls.mjs --despues-de-00143` | verde |
| `verify-roles.mjs --despues-de-00136` | verde (ver nota) |
| `verify-scheduling.mjs` | verde |
| `verify-booking-concurrency.mjs` | verde |
| `verify-crm.mjs` | verde |
| `verify-content.mjs` | verde |
| `verify-dashboards.mjs` | verde |
| `verify-calls.mjs` | verde |
| `verify-audit-visibility.mjs --despues-de-00147` | verde |
| `verify-workspace-isolation.mjs --despues-de-00143` | verde |
| `verify-inbox-filters.mjs` | verde |
| `verify-publishing.mjs` | verde |
| `verify-optout.mjs`, `verify-csv-import.mjs`, `verify-enrichment.mjs`, `verify-chat-media.mjs`, `verify-message-persistence.mjs` | verdes |
| `verify-attribution.mjs` | **FALLA ya en el punto de partida** (1 caso: "todos los contactos reales tienen first_touch", 732 de 791). Ver PENDIENTE-formularios |
| `verify-knowledge.mjs`, `verify-webhook.mjs` | **no se corren** (Voyage real / app local). Ver PENDIENTE-formularios |
| `node scripts/export-template.mjs` | **FALLA ya en el punto de partida** el control de nombres (12 restos en tests de Llamadas). Ver PENDIENTE-formularios |

Huellas `md5(pg_get_functiondef(...))` al empezar (deben ser iguales al final):

| Función | md5 |
|---|---|
| `find_or_link_contact` | `861440d10e8519b67606d78c53ca663b` |
| `create_booking` | `b81db84edb30ee7853efa2d42385593a` |
| `record_contact_touch` | `f364db1862cc0f90291ca14ef855a214` |
| `can_see_contact` | `7f9cb2e9e69380ca64005e9dde6573cf` |
| `bump_rate_limit` | `9dfd6ac72cb92da34f6fc9f11ffc2340` |

CHECK vivos al empezar: `triggers_type_check` con 21 tipos (incluye `call_analyzed` y `call_linked`); `integration_configs_type_check` con 7 (channel, ai_provider, email_provider, social_network, publishing_service, google, meta).

## Tests de caracterización (antes de tocar nada)
- [x] `lib/contacts/touch-characterization.test.ts` (`sanitizeRaw`/`recordTouch`: Agenda y Zernio)
- [x] `lib/supabase/middleware-characterization.test.ts` y `lib/home-redirect-characterization.test.ts`
- [x] `scripts/export-template.test.ts`
- [x] `lib/flow-engine/registry/registry-characterization.test.ts`
- [x] `lib/scheduling/automation/linear-flow-characterization.test.ts`
- [x] `lib/embed/agenda-url-characterization.test.ts`

## Migraciones (la 00150 es la primera libre: no hay renumeración)

| Número real | Número del plano | Qué hace | Estado |
|---|---|---|---|
| 00150 | 00150 | `forms`, `form_versions`, `form_submissions`, `can_view_forms`, `can_see_form_submission`, RLS | **aplicada y registrada** (`verify-forms`, `verify-rls` en verde; idempotente: aplicada dos veces) |
| 00151 | 00151 | índice parcial `idx_analytics_forms` | **aplicada y registrada** (índice parcial; el `EXPLAIN` lo usa) |
| 00152 | 00152 | `get_public_form`, `publish_form_version`, `form_metrics_daily`, `submit_form_response` v1 | **aplicada y registrada** (`verify-forms`: lista blanca, huella, concurrencia, métricas en zona horaria) |
| 00153 | 00153 | buckets privados `form-uploads` y `contracts` | **aplicada y registrada** (buckets privados, sin policies) |
| 00154 | 00154 | CHECK de `integration_configs.type` suma `captcha` | **aplicada y registrada** (el CHECK contiene los 7 tipos de antes + `captcha`) |
| 00155 | 00155 | `flows.form_id` + CHECK de `triggers.type` suma 3 | **aplicada y registrada** (el CHECK contiene los 21 de antes + los 3 nuevos; `flows.form_id` e `idx_flows_form` parcial) |
| 00156 | 00156 | `find_contact_by_phone_or_email` + `submit_form_response` v2 | **aplicada y registrada** (`verify-forms`: los casos de contacto, toque, aviso y la concurrencia) |
| 00157 | 00157 | `contract_signatures`, `record_contract_signature`, `submit_form_response` v3 | **aplicada y registrada** (aplicada dos veces: idempotente; `verify-forms`: huella, versión, firma, transacción, RLS, evidencia protegida) |
| 00158 | (extra, no estaba en el plano) | corrige `submit_form_response`: "una vez por contacto" detecta la segunda respuesta de alguien que se creó con la primera | **aplicada y registrada** (la encontró `verify-forms` al sumar los casos de la encuesta; ver PENDIENTE) |

Próxima libre al cerrar: **00159**.

## Bloque FO1 · Builder, publicación y envío — **cerrado** (migraciones 00150–00154 aplicadas)
- [x] F1 Tablas base, RLS y script de verificación
- [x] F2 Permisos y navegación
- [x] F3 Lista de formularios
- [x] F4 Campos y builder
- [x] F5 Condiciones
- [x] F6 Prellenado por URL, campos ocultos y atribución
- [x] F7 Diseño y pantalla de éxito
- [x] F8 Publicación y versiones
- [x] F9 Definición pública segura y página pública
- [x] F10 Embed
- [x] F11 Cloudflare Turnstile
- [x] F12 Envío seguro
- [x] F13 Respuestas
- [x] F14 Métricas

Lo que se verificó al cerrarlo:
- `npx vitest run`: 584 archivos, 7.244 tests, todo en verde (el punto de partida eran 547 y 6.865). `npm run lint`: 0 errores, 36 avisos (los mismos). `npm run build`: compila. `public/embed/embed.js`: 18,2 KB (era 14 KB; tope 60 KB).
- `verify-forms.mjs` (nuevo, 113 comprobaciones contra la base real): RLS por rol (Owner, Admin, Member de sistema, rol con y sin `forms.view`, otro workspace, `anon`), unicidad de slug e idempotencia, sin DELETE; las huellas de `find_or_link_contact`, `create_booking` y `record_contact_touch` iguales; publicar (paridad del SHA-256 SQL/Node, versión 2, inmutabilidad, historial); `get_public_form` sin ninguna clave interna ni el valor de un oculto fijo; el envío real con Turnstile simulado (5 pedidos simultáneos con la misma clave = 1 respuesta, honeypot, captcha, Cloudflare caído, archivo real y `.exe` renombrado, republicar con otra etiqueta); métricas por día en la zona del workspace (el caso de las 23:30), spam aparte, índice parcial usado, beacon con un solo evento por sesión y sin IP ni `sid`; buckets privados.
- `verify-rls`, `verify-scheduling` y `verify-roles` en 0. `verify-attribution` sigue con su única falla de antes (backfill de contactos; no es del módulo).
- Revisión visual (navegador integrado, con la sesión de Wendy; datos `zz-test` creados y borrados): lista, editor de tres columnas con vista previa en vivo, publicar, respuestas, detalle y métricas a 1440 px; la página pública a 1440 y a 390 px en claro y oscuro; editor, respuestas, métricas y lista a 390 px sin scroll horizontal.

## Bloque FO2 · Contacto, atribución y automatizaciones — **cerrado** (migraciones 00155–00156 aplicadas)
- [x] F15 Pestaña Contacto
- [x] F16 Resolución del contacto y deduplicación
- [x] F17 Atribución por toque
- [x] F18 Etiquetas al enviar y aviso al equipo
- [x] F19 Triggers de formulario
- [x] F20 Variables de formulario
- [x] F21 Automatizaciones desde el formulario

Lo que se verificó al cerrarlo:
- `npx vitest run`: 595 archivos, 7.386 tests, todo en verde. `npm run lint`: 0 errores, 36 avisos (los mismos). `npm run build`: compila.
- `verify-forms.mjs` (ahora con los casos de FO2 contra la base real): el CHECK de `triggers` (los 21 de antes + 3), `flows.form_id`; contacto nuevo (nombre, email normalizado, teléfono, campo personalizado, etiqueta, historial como sistema "Formulario: <nombre>"); evento con payload de solo escalares y sin `booking_id`; un formulario común no emite eventos de encuesta ni de contrato; vincular por teléfono con `conflict_contact_id`; email secundario en mayúsculas; sin email ni teléfono (sin contacto, sin evento, pero con aviso); `link_only`; `fill_empty` y `overwrite` (nunca borra con un vacío); 5 respuestas simultáneas con el mismo teléfono = 1 contacto; primer toque que no cambia y último que sí; el mismo envío dos veces = 1 toque; contacto sin toques previos; link firmado (válido, firma alterada, otro formulario, vencido, contacto borrado, otro workspace) y `service_id`/`sale_id` solo desde la firma; el trigger y sus variables contra la base real; `{{form_link.<slug>}}`; aviso apagado. Las tres huellas md5 siguen iguales.
- `verify-rls` y `verify-scheduling` en 0. `verify-attribution` con su única falla de antes, con la misma cantidad de contactos sin `first_touch` (59), no peor.
- El editor lineal de la Agenda es ahora un envoltorio del compartido; sus tests (`lib/scheduling/automation/*`) siguen en verde.

## Bloque FO3 · Encuesta/NPS y contrato — **cerrado** (migraciones 00157–00158 aplicadas)
- [x] F22 Tipo encuesta y "una vez por contacto"
- [x] F23 Panel de la encuesta
- [x] F24 Tipo contrato
- [x] F25 Firma dibujada
- [x] F26 Registro de la firma, metadata legal y huella
- [x] F27 PDF firmado
- [x] F28 Copia por email con reintentos, ver y reenviar

Lo que se verificó al cerrarlo:
- `npx vitest run`: 614 archivos, 7.551 tests, todo en verde. `npm run lint`: 0 errores, 36 avisos (los mismos). `npm run build`: compila. `pdf-lib@1.17.1` exacta (la única dependencia nueva del módulo); `contract_pdf` y `contract_email` están en `registeredJobTypes()`.
- `verify-forms.mjs` con los casos de FO3 contra la base y el Storage reales (Turnstile y Resend simulados):
  - **Encuesta**: la categoría NPS que calcula la RPC es la de `npsCategory()` para 0, 6, 7, 8, 9 y 10 (paridad); estrellas guardan el puntaje sin categoría; "una vez por contacto" da 409 a la segunda respuesta y no la guarda; las anónimas no se limitan; una respuesta marcada spam no cuenta; con el link firmado la clave es `contact:<id>` y la página dice "Ya respondiste" antes del formulario; un token alterado se ignora sin error; emite `survey_answered` y no `form_submitted`.
  - **Contrato**: sin casilla, sin firma, un "PNG" que es un JPEG y una firma de 250 KB dan 400 y no dejan nada; el texto o el HTML que mande el navegador se ignoran y la huella es la del texto guardado; la metadata legal sale del servidor (IP en claro solo en la firma, dispositivo, sistema, navegador) y `signed_at` es la hora del servidor; el job `contract_pdf` se encola en la misma transacción y `contract_signed` se emite sin esperar al PDF; publicar la versión 2 no toca la firma de la 1; con el texto de la versión alterado la firma falla y no queda ni respuesta, ni contacto, ni firma, ni job, ni imagen; la evidencia no se puede cambiar ni con el service role.
  - **PDF y email**: el PDF real (título, firmante, huella, "Versión 1", ñ y ¿, datos de aceptación) se genera en el bucket privado y se lee con `unpdf`; el adjunto del email es exactamente ese PDF; un fallo transitorio deja `retrying` con el job a +5 minutos; uno permanente, `not_sent` sin otro intento; quien ve la respuesta obtiene la firma, quien no, nada, y nadie baja el PDF directo del bucket.
  - **RLS de las firmas**: Owner y Admin las ven; un Member solo las de sus contactos; sin `forms.view`, otro workspace y `anon`, ninguna; nadie inserta ni borra desde el navegador.
- Las huellas md5 de `find_or_link_contact`, `create_booking` y `record_contact_touch` siguen iguales.

## Bloque FO4 · Sitio público y atribución completa — **cerrado** (sin migraciones)
- [x] F29 Atribución persistente entre páginas
- [x] F30 Área pública del sitio
- [x] F31 Componente `<Formulario>`
- [x] F32 Parámetros, links con prellenado y códigos
- [x] F33 Todos los datos del anuncio llegan al contacto

Lo que se verificó al cerrarlo:
- `npx vitest run`: 619 archivos, 7.641 tests, todo en verde. `npm run lint`: 0 errores, 36 avisos (los mismos). `npm run build`: compila con la versión por defecto del sitio y también con una página de ejemplo (`/ejemplo`, estática con renovación de 1 hora; **se borró antes de commitear**). `public/embed/embed.js`: 21,1 KB (tope 60 KB).
- `verify-forms.mjs` con los casos de FO4 contra la base real: un envío con `origin: "site"` guarda `meta.origin = 'site'` y `meta.site_path` (limpia de query y hash; fuera del sitio no se guarda); con una cookie `ssa_attr` cuyo último toque es `utm_campaign = octubre` y la URL sin UTM, la respuesta guarda `attribution.utm_campaign = octubre` y el toque queda con `campaign = octubre` (primer toque del contacto nuevo); con `?utm_source=facebook&fbclid=abc&msclkid=m1&gbraid=gb1&ad_id=77` el toque guarda `fbclid` y `ad_id` en sus columnas y `msclkid`, `gbraid`, `fbc`, `fbp` y `page_url` en `raw`; el `form_view` de una página del sitio lleva `origin: "site"` sin el `sid` ni la IP.
- `verify-scheduling` en 0. `verify-attribution` con su única falla de antes (la misma cantidad de contactos sin `first_touch`).
- `scripts/export-template.mjs` en una carpeta temporal: **pasa el control de nombres** (se arreglaron los 12 restos en tests de Llamadas) y deja `app/(sitio)/` con solo `layout.tsx` y `page.tsx` iguales a `scripts/template-files/sitio/`, sin `public/sitio/` propio ni `app/page.tsx`.
- Revisión visual (navegador integrado, con la sesión de Wendy): una página del sitio con el layout, dos `<Formulario>` de un formulario que no existe (cada uno muestra su aviso y la página carga) y uno publicado con `prefill={{plan:"pro"}}` y la URL `?plan=basic` (queda en `pro`); la cookie `ssa_attr` se escribe con la última visita y solo las claves de atribución de la URL.

## Definición de listo — corrida final (11/10/2026)

- **Funcionalidades**: FO1 a FO4, F1 a F33 marcadas. F18 y las plantillas de F21 se construyeron (no se recortó nada); `pdf-lib` se instaló, así que F27 está completo.
- `npx vitest run`: 619 archivos, 7.641 tests, en verde. `npm run build`: compila con la versión por defecto del sitio. `npm run lint`: 0 errores, 36 avisos (los mismos del punto de partida).
- **Verificaciones contra la base real, de a una, todas en 0**: `verify-forms` (con los casos de FO1 a FO4), `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136`, `verify-scheduling`, `verify-booking-concurrency`, `verify-crm`, `verify-content`, `verify-dashboards`, `verify-calls`, `verify-audit-visibility --despues-de-00147`, `verify-workspace-isolation --despues-de-00143`, `verify-inbox-filters`, `verify-publishing`, `verify-optout`, `verify-csv-import`, `verify-enrichment`, `verify-chat-media` y `verify-message-persistence`.
- **`verify-attribution`**: sigue con su única falla de antes del módulo ("todos los contactos reales tienen first_touch", 734 de 793; eran 732 de 791: los mismos 59 contactos sin `first_touch`, no empeoró). Es un dato de backfill de la 00115, no de Formularios.
- **No se corrieron** (decidido con Wendy): `verify-knowledge` (llama a Voyage de verdad) y `verify-webhook` (necesita la app en local). Formularios no toca Conocimiento ni los webhooks.
- **Lo que no cambia** (§4.2): las huellas md5 de `find_or_link_contact`, `create_booking` y `record_contact_touch` son iguales a las del punto de partida (las compara `verify-forms`); los tests previos de Agenda, embed, headers, touch y atribución siguen en verde.
- **Migraciones** 00150 a 00158 aplicadas y registradas; `ALL_MIGRATIONS.sql` regenerado.
- **Documentos**: `docs/formularios.md`, `docs/sitio.md`, `docs/flow-registry.md`, el comentario de `.env.example`, `CLAUDE.md` (secciones "Formularios" y "Sitio público" y la próxima migración libre, 00159) y `BITACORA.md`.
- `export-template.mjs` en una carpeta temporal: pasa el control de nombres y deja `app/(sitio)/` con la versión por defecto.
- **Revisión visual** hecha por bloque (ver cada uno). La verificación en vivo con las claves reales de Turnstile y de Resend queda para Wendy (§18 del plano; ver PENDIENTE).

## Correcciones del 12/10 (R1 a R10) — **cerradas**

Rama `feat/formularios-correcciones` (desde `main` con Ventas ya mergeada, PR #42). Migraciones **00172 a 00177**, aplicadas y registradas. Un commit por corrección.

- [x] **R1** Se sacó Cloudflare Turnstile entero (código, interfaz, definición pública, card de Integraciones, secreto y tipo `captcha`): publicar ya no depende de nada externo. Documentado para retomarlo en `docs/pendientes/turnstile-captcha.md` (último commit con Turnstile: `9eee8bb`). Migraciones 00172 y 00173.
- [x] **R2** Tope por IP: 30/h por formulario y 60/h en total (antes 5 y 20: una oficina o un evento comparten la IP). `clientIp` no se tocó (ver PENDIENTE).
- [x] **R3** Interruptor "Vincular las respuestas con contactos" (`mode: "none"`), con la base haciéndolo cumplir.
- [x] **R4** El mapeo se arma solo, se guarda con el borrador, el campo dice adónde va y publicar avisa si no va a crear contactos.
- [x] **R5** Campo "Usuario de red social", destinos de red en el mapeo y crear o vincular por @ (`find_contact_for_form`, `submit_form_response` v5). Migraciones 00174, 00175 y 00176.
- [x] **R6** El país también se entiende por nombre.
- [x] **R7** Prellenado: el "+" de la URL ya no rompe teléfonos ni emails; parámetros cortos automáticos y ejemplos de link.
- [x] **R8** La ficha del contacto muestra sus formularios.
- [x] **R9** Candado en las versiones publicadas (00177).
- [x] **R10** El PDF no repite nombre y email del firmante.

Lo que se verificó al cerrarlo:
- `npx vitest run`, `npm run build` y `npm run lint` en verde (ver el cierre en BITACORA).
- Contra la base real, de a una, todas en 0: `verify-forms` (con los casos nuevos: sin captcha, none, redes, conflictos, canal de Instagram con overwrite, dos respuestas simultáneas con el mismo @, el país, la RLS de la ficha, el candado y la huella corrupta con una versión insertada), `verify-sales` (con la versión actualizada de la otra sesión: la de esta rama todavía consulta `content_offers`, que Ventas ya borró en la base), `verify-crm`, `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136`, `verify-scheduling` y `verify-audit-visibility --despues-de-00168`.
- Las huellas md5 de `find_or_link_contact`, `create_booking`, `record_contact_touch` y `find_contact_by_phone_or_email` son iguales a las del inicio.
- Revisión visual (navegador integrado, con un usuario `zz-test-` en `127.0.0.1`, para no tocar la sesión de Wendy en `localhost`): la pestaña Contacto con el interruptor apagado y prendido, el mapeo automático al agregar un email y un usuario de Instagram, el aviso al publicar, un formulario con Instagram publicado y enviado con `?instagram=@Prueba` (se vinculó por Instagram al contacto que ya existía), la sección Formularios de la ficha con una encuesta (Puntaje 4 · Detractor), un contrato y uno común, y Integraciones sin Turnstile. Datos `zz-test-` borrados.
