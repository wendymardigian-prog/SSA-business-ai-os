# Comunicacion

- Explica todo en lenguaje simple. Si usas un termino tecnico, agrega una explicacion breve entre parentesis.
- Cuando propongas algo, da tu recomendacion y explica por que. No listes opciones sin recomendar.
- Si algo sale mal, explica que paso, por que, y como lo vas a resolver. No tires el error tecnico solo.
- Antes de hacer cambios grandes (migraciones, borrar archivos, tocar auth), explica que vas a hacer y espera confirmacion.
- Usa espanol rioplatense (vos/tenes, no tu/tienes).

# Proyecto

Nombre: Sistema Operativo de Negocio con IA (para agencia de marketing digital)
Descripcion: Sistema operativo centralizado que unifica CRM, inbox multicanal con bot de IA, automatizaciones, contenido, ventas y finanzas en una sola plataforma, para que ningun lead quede sin respuesta y todo viva en una sola fuente de verdad.

Multi-tenancy: **Single-tenant** (un solo negocio, un solo workspace). ZernFlow trae workspaces, se conservan, pero no se construye gestion multi-negocio.

## Etapas
- Etapa 1: Sistema Operativo Base (Fase 1: Foundation, Canales y CRM. Fase 2: Comunicacion y Automatizaciones. Fase 3: Agente IA, Analytics y Pulido)
- Etapa 2: Publicacion de contenido + Metricas + Email bidireccional + Roles custom + Meta Ads (incluye TikTok, YouTube, LinkedIn como publicacion)
- Etapa 3: Agente IA integral + Fathom + Conector MCP
- Etapa 4 (opcional): Agendamiento + Ventas + Pipeline comercial
- Extras independientes: Tareas, Inbox Gmail multicuenta, Form Builder, Browser Automation, Creacion de Video, Analisis de video YouTube, Auto-mejora del agente, Finanzas (comisiones + gastos)

# Base del proyecto

Fork de: ZernFlow (https://github.com/zernio-dev/zernflow, licencia MIT)
Framework: Next.js 16 (App Router) + React 19 + TypeScript 5
Estilos: Tailwind CSS v4 (el codigo real usa v4, NO v3)
Flow builder: @xyflow/react 12
SDK de canales: @zernio/node 0.2.519 (Zernio, ex "Late")
IA: Vercel AI SDK (paquete `ai`) v6, soporta ToolLoopAgent
Data: @supabase/supabase-js 2.95 + @supabase/ssr 0.8
Testing: Vitest 3

Patterns a seguir (mantener consistencia con el fork, no reinventar):
- Auth: Supabase SSR con cookies httpOnly. Trigger `on_auth_user_created` crea el workspace automaticamente.
- State management: Server Components + React hooks. NO Redux, NO Zustand.
- API layer: webhooks en API Routes (`app/api/`), mutaciones de UI en Server Actions.
- Data access: `@supabase/supabase-js` con RLS del lado cliente; Service Role Key solo en server (cron jobs, webhooks).
- Styling: Tailwind v4 utility classes. Sin CSS modules ni styled-components.
- Flow engine: motor recursivo en `lib/flow-engine/engine.ts`, nodos en `lib/flow-engine/nodes/`, abstraccion de plataforma en `lib/flow-engine/platform-adapter.ts`.
- Migraciones en `supabase/migrations/`, numeradas `000NN_nombre.sql`.

NO reescribir (ya existe en ZernFlow, solo verificar/extender):
- Autenticacion con Supabase Auth + trigger de auto-creacion de workspace.
- Sistema de workspaces y team management con invitaciones (expiran en 7 dias, tabla `workspace_invites`).
- Roles Owner / Admin / Member (campo `workspace_members.role`).
- Flow builder visual con @xyflow/react (17 tipos de nodo, motor recursivo profundidad max 50, variable interpolation, flow stack).
- Inbox / bandeja con lista de conversaciones y panel de mensajes.
- CRM con tags, custom fields (6 tipos reales: text, number, boolean, date, url, email — NO existe 'list'), segmentos.
- Secuencias (drip) con auto-pausa cuando el contacto responde.
- Broadcasts (tablas y UI — se conservan, no se usan en Etapa 1).
- Webhook event ledger para idempotencia (tabla `webhook_events`).
- Flow versions (historial al publicar).
- Realtime en `conversations` y `messages`.
- Integracion base con Zernio para Instagram (DMs, comentarios, story replies).

# Stack

- Base de datos: Supabase (PostgreSQL), plan Pro
- Auth: Supabase Auth (email/password) + SSR
- Frontend: Next.js 16 (App Router) + React 19 + TypeScript 5
- Estilos: Tailwind CSS v4
- Hosting: Railway (app Next.js + Evolution API como servicio separado en red privada interna)
- Canal Instagram: Zernio (Late API) — DMs, comentarios, story replies. Usa la 1ª de 2 cuentas free
- Canal WhatsApp: Evolution API (Baileys, por QR) self-hosted en Railway
- Email saliente: Resend (transaccional en Fase 1: invitaciones, notificaciones)
- IA: BYOK multi-proveedor (OpenAI / Anthropic / Google) con Vercel AI SDK
- Secrets: Supabase Vault (AES-256)
- Versionado: GitHub
- Testing: Vitest 3

Nota de canales: TikTok, YouTube y LinkedIn NO van en Etapa 1. TikTok no tiene API de DMs/comentarios (verificado en el SDK `@zernio/node`) — entra recien en Etapa 2 como publicacion de contenido y metricas. La 2ª cuenta free de Zernio se reserva para ese contenido de Etapa 2.

# Comandos

## Desarrollo
- Instalar dependencias: npm install
- Correr en desarrollo: npm run dev
- Build: npm run build
- Tests: npx vitest run
- Lint: npm run lint

## Git y GitHub
- Ver estado: git status
- Crear branch: git checkout -b feature/nombre-descriptivo
- Agregar cambios: git add .
- Commit: git commit -m "descripcion clara de que se hizo"
- Push: git push origin nombre-del-branch
- Pull: git pull origin main
- Ver historial: git log --oneline -20
- Volver atras un archivo: git checkout -- ruta/al/archivo
- Crear tag de version: git tag -a v1.0.0 -m "Fase 1 completada"

## Convenciones de commits
- Formato: tipo: descripcion breve
- Tipos: feat (funcionalidad nueva), fix (correccion de bug), refactor (reorganizar sin cambiar comportamiento), chore (mantenimiento, deps), docs (documentacion), style (formato), test (tests)
- Ejemplos:
  - feat: agregar deteccion cross-canal por telefono y email
  - fix: corregir RLS en tabla contact_notes
  - chore: actualizar .env.example con variables de Resend
- Commit despues de cada funcionalidad completa, no al final del dia. Cada commit deja el proyecto funcional (que compile y corra).

# Reglas de negocio

- Contacto como entidad central. Deduplicacion por telefono o email, nunca solo por nombre.
- Identificacion cross-canal: si el mismo telefono/email aparece por dos canales, se unifica en un contacto, pero cada conversacion se mantiene separada por canal.
- Doble asignacion: cada lead tiene setter (quien contacta) y vendedor/closer (quien cierra). Ambos campos opcionales e independientes.
- Scope de leads (Etapa 1, restriccion dura por RLS): un Member solo ve/edita contactos y conversaciones donde es setter, vendedor o agente asignado. Owner y Admin ven todo.
- Soft delete: nada se borra de verdad, se marca con `deleted_at`. Retencion 30 dias, luego purga por cron.
- Marca "no contactar": detectada automaticamente o manual; pausa secuencias del contacto.
- Snapshot de precio (Etapa 4): al registrar una venta se guarda el precio de ese momento.
- Secuencias: auto-pausa cuando el contacto responde; alerta de colision si hay mas de una activa en el mismo canal.

# Calidad de codigo (template-ready)

- Cada cambio de base de datos va en una migracion SQL separada, numerada secuencialmente, continuando la numeracion de ZernFlow (proximas desde 00017).
- Cada migracion es idempotente: CREATE TABLE IF NOT EXISTS, DO $$ ... END $$ para checks, IF NOT EXISTS en constraints y columnas.
- Mantener .env.example actualizado: cada variable nueva con comentario de que es y donde se obtiene.
- El sistema debe funcionar con base de datos vacia (empty states claros en todas las pantallas).
- No commitear .env con valores reales, solo .env.example.
- Datos de demo van en seeds separados de las migraciones de estructura.
- UUIDs con gen_random_uuid().

# Migraciones

ZernFlow trae 16 archivos de migracion (00001 a 00016) con 23 tablas. La migracion 16 agrega 'whatsapp' al CHECK constraint de `channels.platform` (junto con instagram, facebook, twitter, telegram, bluesky, reddit).
Las migraciones nuevas continuan desde 00017. En Etapa 1 NO hace falta tocar el CHECK constraint de `channels` (instagram y whatsapp ya estan). 'tiktok'/'youtube'/'linkedin'/'email' se agregan recien en Etapa 2.
Cada fase define sus migraciones en su documento de requerimientos. Seguir esa numeracion y no saltear numeros.

# Seguridad

## Autenticacion y sesiones
- Supabase Auth con email/password. Sesiones por Supabase SSR con cookies httpOnly (access token 1h, refresh 7d).
- Rate limiting de login por defecto de Supabase. Recuperacion de contrasena con token de tiempo limitado.

## Row Level Security (RLS) — obligatorio
- TODAS las tablas tienen RLS habilitado. Aislamiento por workspace_id (funcion helper `is_workspace_member`).
- En Etapa 1 se agrega scope de leads: en `contacts` y `conversations`, un Member solo ve filas donde es setter/vendedor/asignado; Owner/Admin ven todo. Usar una funcion helper (ej: `can_see_contact`) reutilizable en las policies.
- Politicas explicitas para SELECT, INSERT, UPDATE, DELETE en cada tabla. El scope se evalua en la base, no solo en la UI.

## Validacion y datos sensibles
- Validacion en cliente Y en servidor. Sanitizar inputs (XSS, SQL injection).
- API keys de terceros en Supabase Vault (AES-256), nunca en env vars del frontend ni en codigo.
- Service Role Key solo en server-side.
- Logs sin tokens, contrasenas, API keys ni PII.
- .env nunca se commitea. Solo .env.example con placeholders.

## Webhooks entrantes
- Zernio: validar firma HMAC antes de procesar. Evolution API (red interna): no requiere HMAC.
- Ack inmediato (responder 200 antes de procesar). Procesamiento async. Idempotencia con `webhook_events`.

## Checklist de seguridad (verificar en cada bloque)
- [ ] RLS habilitado en todas las tablas nuevas
- [ ] Politicas RLS escritas y testeadas (incluido el scope de leads)
- [ ] JWT verificado en todas las API Routes nuevas
- [ ] Validacion de inputs en servidor
- [ ] Secrets en Vault o env vars, no en codigo
- [ ] Logs sin datos sensibles
- [ ] Webhooks con firma validada (Zernio) e idempotencia

# Buenas practicas de desarrollo

## Estructura de codigo
- Seguir la estructura existente del fork. No inventar carpetas nuevas si ya hay una que sirve.
- Logica de negocio en Server Actions o lib/, no en componentes de UI.
- Un archivo por responsabilidad.

## Error handling
- Siempre manejar errores. Nunca un catch vacio.
- Mensajes de error claros al usuario (toast con accion sugerida). Loguear en servidor sin datos sensibles.
- Reintentos automaticos para operaciones de red (max 3, con backoff).

## Performance
- Server Components por defecto. Client Components solo donde se necesita interactividad.
- Paginacion en todas las listas. Indices en columnas de filtro/orden/busqueda.

## Testing y accesibilidad
- Tests para logica de negocio critica, sin depender de servicios externos (mockear APIs).
- Labels en inputs, contraste WCAG AA, navegacion por teclado, alt en imagenes.

# Estructura del proyecto

El proyecto se divide en etapas. Cada etapa en fases de 1-2 semanas. Cada fase en bloques de ejecucion (1 bloque = 1 sesion de Claude Code).
El documento de requerimientos de cada fase es el "plano" que define exactamente que construir. Siempre se adjunta como archivo en el primer prompt de cada bloque.

# Diseno para el futuro

El modelo de datos y la arquitectura se disenan pensando en todas las etapas, aunque se construya una fase a la vez:
- Campos preparados para etapas futuras se agregan desde ahora aunque queden vacios (ej: `ai_conversation_summary`, `next_followup_date`, atribucion, campos de venta/pago).
- Arquitectura extensible: el flow builder tiene registro de nodos/triggers para que modulos nuevos (ventas, agendamiento) sumen sus triggers/acciones sin tocar el core. El agente IA usa tool registry para sumar herramientas por etapa.
- La tabla `channels` abstrae la fuente de conexion (Zernio vs API directa) para que el inbox unificado no dependa de como se conecto cada canal.
- La tabla `integration_configs` es generica y extensible (canales, IA, email) — sumar un proveedor es un registro, no una tabla nueva.
