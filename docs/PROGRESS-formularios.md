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

## Bloque FO4 · Sitio público y atribución completa
- [ ] F29 Atribución persistente entre páginas
- [ ] F30 Área pública del sitio
- [ ] F31 Componente `<Formulario>`
- [ ] F32 Parámetros, links con prellenado y códigos
- [ ] F33 Todos los datos del anuncio llegan al contacto

## Definición de listo — corrida final
(se completa al cerrar)
