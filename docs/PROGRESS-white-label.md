# Progreso — White label (marca, limpieza de datos propios, zona horaria por usuario)

Corrida autónoma en la rama `oneshot-white-label`. Plan aprobado: [docs/plan-white-label.md](plan-white-label.md) (7/10/2026).

Nota de convención: el pedido original decía "docs/PROGRESS.md", pero ese archivo
es el cierre de una corrida anterior ("Mejoras de Chat, corrida B") — cada
corrida tiene su propio `docs/PROGRESS-<nombre>.md` (ver `docs/PROGRESS-CV3.md`,
`docs/etapa2/PROGRESS.md`). Este es el de esta corrida.

**Alcance: los tres bloques del plan, en orden — A (marca y acceso), B (limpieza
de datos propios) y C (zona horaria por usuario) — migraciones aplicadas,
mergeado a `main` y desplegado.**

## Bloque A — Marca y acceso

**Hecho:**
- `lib/brand.ts` (+ test): nombre, logo y color de marca por variables de entorno (`NEXT_PUBLIC_BRAND_NAME/LOGO_URL/COLOR`), sin ningún valor de cliente escrito en el código.
- `components/brand-mark.tsx`: el logo, o un monograma con la inicial si no hay uno. Reemplaza el avatar de DiceBear (un servicio externo) en `workspace-switcher.tsx`.
- `app/page.tsx` → `redirect("/login")`. No hay más landing de marketing.
- `app/layout.tsx`: título desde la marca, `lang="es"`, color de marca inyectado con `!important` sobre `--primary`/`--ring` **y** `--color-primary`/`--color-ring` (Tailwind v4 resuelve estos últimos de forma distinta dentro de `.dark`/`[data-theme]`, ver el comentario en el archivo).
- `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` (generados con `next/og`), reemplazan los archivos fijos de `public/` (favicons, `site.webmanifest`, los 8 archivos del logo de ZernFlow y `powered-by-zernio.svg`, todos borrados).
- `app/robots.ts`: `disallow: "/"`. Se borró `app/sitemap.ts` (no hay nada público que indexar).
- Páginas públicas de agenda (`app/calendario/*`): título `absolute`, para que no les llegue el sufijo `| <marca>` — quien agenda ve al negocio, no al software.
- Login reescrito en español, sin GitHub, sin link a "Sign up", respeta `?next=` (solo rutas relativas).
- **Registro público eliminado** (`app/(auth)/register/` borrado; el middleware redirige `/register` → `/login`).
- **Alta solo por invitación**: `lib/actions/team.ts` suma `registerFromInvite` (crea la cuenta con `auth.admin.createUser`, inicia sesión y acepta la invitación en un solo paso) y extrae `validatePendingInvite`/`finalizeAcceptInvite` de `acceptInvite` para no duplicar las validaciones. `app/invite/[inviteId]/accept-invite-view.tsx` tiene el formulario de alta cuando no hay sesión.
- **Migración `00119_invite_signup_no_workspace`**: redefine `handle_new_user` (copiada de la 00001) para que un alta con `invite_id` de una invitación pendiente **no** reciba su propio workspace — antes de esto, aceptar una invitación dejaba a la persona con dos workspaces.
- `supabase/config.toml`: `enable_signup = false` (local; falta el equivalente en el proyecto alojado, ver "Pendiente" más abajo).
- `scripts/create-owner.mjs`: crea el primer Owner de un clon nuevo.
- Color de marca propagado a los charts de dashboards (`#6366f1` → `var(--primary)` en 6 archivos), al botón de los emails (`lib/email/templates.ts`) y a `--c-agent`/`--sent` de `globals.css`.
- Nombres técnicos: cookie `zernflow_workspace_id` → `workspace_id` (con respaldo leyendo la vieja), `WEBHOOK_NAME` de Zernio → `brandName()`, `source` de los flows exportados `"zernflow"` → `"business-os"`, `package.json`/`package-lock.json` → `"business-os"`, encabezado de `build-all-migrations.mjs`.
- `README.md` reescrito (neutro, con las instrucciones de white label), `THIRD_PARTY_NOTICES.md` suma la entrada de ZernFlow. **`LICENSE` no se tocó** (la MIT obliga a conservar el aviso original).

**Decisión que cambié respecto del plan, con el código ya mirado:** el plan
decía "las clases `indigo-*` del flow builder pasan a `primary`" en
`DelayPanel`, `AiResponseNode`, `NodeConfigSidebar`, `delay-node`, `TestPanel`
y `ActionPanel`. Mirando el código, esos colores (púrpura para el nodo Delay,
violeta para AI Response, y en `TestPanel` una paleta de 15 colores — uno por
cada tipo de nodo, para el log de una corrida de prueba) son un **sistema
categórico legítimo** para distinguir tipos de nodo a simple vista, no la
marca filtrándose. Unificarlos a `primary` hubiera hecho que, por ejemplo,
"condición" y "AI Response" se vean exactamente iguales en el log de pruebas,
sin arreglar nada real (el resto de los 15 colores de `TestPanel` no son de
la familia índigo y quedarían igual). No los toqué. El verdadero "color de
marca pisando todo" eran los `#6366f1` sueltos en los dashboards y el
manifest, que sí se corrigieron.

**Verificado:** `npx vitest run` (420 archivos, 5299 tests, todos en verde),
`npm run lint` (sin errores ni warnings nuevos — los 4 errores pre-existentes
de `main` en `dashboard-panel.tsx`, `spend-chart-tabs.tsx` y
`onboarding-banner.tsx` no los tocó esta corrida, confirmado corriendo lint
con los cambios en el stash), `npm run build` (compila; `/`, `/login`,
`/icon`, `/apple-icon`, `/manifest.webmanifest` y `/robots.txt` salen
estáticos).

**Pendiente de este bloque:**
- Aplicar la `00119` contra la base (sección de migraciones, más abajo).
- Apagar "Allow new users to sign up" en el Supabase alojado — **esto lo tiene que hacer Wendy**, no es algo que se pueda hacer por código.
