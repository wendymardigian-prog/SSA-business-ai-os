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
| 00150 | 00150 | `forms`, `form_versions`, `form_submissions`, `can_view_forms`, `can_see_form_submission`, RLS | pendiente |
| 00151 | 00151 | índice parcial `idx_analytics_forms` | pendiente |
| 00152 | 00152 | `get_public_form`, `publish_form_version`, `form_metrics_daily`, `submit_form_response` v1 | pendiente |
| 00153 | 00153 | buckets privados `form-uploads` y `contracts` | pendiente |
| 00154 | 00154 | CHECK de `integration_configs.type` suma `captcha` | pendiente |
| 00155 | 00155 | `flows.form_id` + CHECK de `triggers.type` suma 3 | pendiente |
| 00156 | 00156 | `find_contact_by_phone_or_email` + `submit_form_response` v2 | pendiente |
| 00157 | 00157 | `contract_signatures`, `record_contract_signature`, `submit_form_response` v3 | pendiente |

Próxima libre al cerrar: **00158**.

## Bloque FO1 · Builder, publicación y envío
- [ ] F1 Tablas base, RLS y script de verificación
- [ ] F2 Permisos y navegación
- [ ] F3 Lista de formularios
- [ ] F4 Campos y builder
- [ ] F5 Condiciones
- [ ] F6 Prellenado por URL, campos ocultos y atribución
- [ ] F7 Diseño y pantalla de éxito
- [ ] F8 Publicación y versiones
- [ ] F9 Definición pública segura y página pública
- [ ] F10 Embed
- [ ] F11 Cloudflare Turnstile
- [ ] F12 Envío seguro
- [ ] F13 Respuestas
- [ ] F14 Métricas

## Bloque FO2 · Contacto, atribución y automatizaciones
- [ ] F15 Pestaña Contacto
- [ ] F16 Resolución del contacto y deduplicación
- [ ] F17 Atribución por toque
- [ ] F18 Etiquetas al enviar y aviso al equipo
- [ ] F19 Triggers de formulario
- [ ] F20 Variables de formulario
- [ ] F21 Automatizaciones desde el formulario

## Bloque FO3 · Encuesta/NPS y contrato
- [ ] F22 Tipo encuesta y "una vez por contacto"
- [ ] F23 Panel de la encuesta
- [ ] F24 Tipo contrato
- [ ] F25 Firma dibujada
- [ ] F26 Registro de la firma, metadata legal y huella
- [ ] F27 PDF firmado
- [ ] F28 Copia por email con reintentos, ver y reenviar

## Bloque FO4 · Sitio público y atribución completa
- [ ] F29 Atribución persistente entre páginas
- [ ] F30 Área pública del sitio
- [ ] F31 Componente `<Formulario>`
- [ ] F32 Parámetros, links con prellenado y códigos
- [ ] F33 Todos los datos del anuncio llegan al contacto

## Definición de listo — corrida final
(se completa al cerrar)
