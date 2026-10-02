# Bloque N — Menú lateral (N1 a N5)

**Rama:** `feat/nav-grupos` (worktree aparte, para no pisar la sesión que
trabaja en paralelo sobre `main`). **Migraciones:** ninguna, como pedía el
bloque.

## Punto de partida

- `npx vitest run` en `main` antes de tocar nada: 339 archivos, 4117 tests,
  todo verde.
- `npm run build` en `main`: compila sin errores.

Base sana: se construyó encima sin problema.

## Qué se hizo

| Paso | Commit | Qué cambia |
|---|---|---|
| 0 | `refactor:` | Se extrajo la regla de "item activo" del JSX inline a `lib/nav/active.ts`, sin cambiar comportamiento, con un test de caracterización que deja escrito el agujero de hoy (ninguna pantalla de `/dashboard/dashboards/*` salvo `/chat` marcaba algo). |
| 1 (N1, N2, N5) | `feat:` | `NavItemMeta` gana `group`; `NAV_GROUPS` declara el orden (inicio, adquisición, ventas, automatización, sistema); `navSections()` agrupa los items ya filtrados y descarta grupos vacíos con su título. Nombres al español (Bandeja, Contactos, Automatizaciones, Ajustes). Channels sale del menú (la pantalla se conserva). Integraciones entra con ícono `Blocks`, `adminOnly: true`, sin ninguna clave nueva en `PERMISSION_KEYS`. Se reescriben las aserciones rotas de `items.test.ts` y `member-baseline.test.ts`. |
| 2 (N4) | `feat:` | El estado activo pasa a "gana el candidato más largo, por segmento", usando un campo `alsoActiveOn` por ítem (dato, no una excepción a mano). Integraciones le gana a Ajustes en su propia sub-ruta; `/dashboard/channels` marca Integraciones; Dashboards queda activo en toda `/dashboard/dashboards/*` (cierra el agujero del paso 0). De paso corrige un bug real: ya no matchea por texto crudo (`/dashboard/contactsnomatch` dejó de marcar Contactos). |
| 3 (N3) | `feat:` | Colapsado: los títulos de grupo se esconden y aparece una línea fina entre grupos (`navSections` ahora devuelve `separatorBefore`). El tooltip de cada ícono colapsado pasa a `"Contactos · Ventas"`. El mecanismo de colapso no cambió: sigue siendo la clase en `<html>` + `localStorage` + el script del `<head>`. |

## Verificación

- `npx vitest run` después de cada paso, siempre en verde. Al cierre: **340
  archivos, 4233 tests**, 0 en rojo, 0 saltados.
- `npm run build`: compila sin errores, después de cada paso.
- `npm run lint`: 0 errores. 38 warnings, todos preexistentes (ninguno en
  `lib/nav/*`, `components/sidebar.tsx` ni `components/dashboard-chrome.tsx`).
- Verificación visual en el navegador: **no se pudo completar**. `/dashboard`
  redirige a `/login` y no hay sesión en este entorno; el login de Supabase
  manda las credenciales a un host remoto, no a `localhost`, así que no se
  ingresó ninguna. Detalle y pasos para que lo confirmes vos en
  [`docs/PENDIENTE-N.md`](PENDIENTE-N.md).

## Criterios de la sección 4 del documento

**N1 — Grupos**
- ✅ Los grupos aparecen en el orden declarado, Dashboards y Bandeja antes
  del primer título (`lib/nav/items.test.ts`, describe "grupos del menu").
- ✅ Integraciones y Ajustes pegados al fondo, separados por una línea
  (mismo describe; en el componente, `border-t` + `mt-auto` en el grupo
  `sistema`).
- ✅ Un ítem sin permiso no aparece, y un grupo sin nada visible tampoco
  aparece con su título (`navSections`, test "un grupo sin ningun item
  visible no aparece, y con el su titulo").
- ✅ Todo `href` resuelve a una ruta que existe, caminando el filesystem real
  de `app/(dashboard)` (incluye los route groups, como `(comunicacion)` para
  Bandeja).
- ✅ `visibleNavItems` no cambió de firma ni de semántica (no se tocó la
  función; solo se la sigue usando igual).

**N2 — Permisos**
- ✅ Integraciones es `adminOnly: true`; el resto conserva su `adminOnly`/
  `permissions` de siempre (diff de `items.ts` solo agrega campos nuevos,
  ninguno de los existentes cambió de valor).
- ✅ Ninguna clave nueva en `PERMISSION_KEYS` (no se tocó
  `lib/auth/permissions.ts`).
- ✅ `member-baseline.test.ts` actualizado: `adminOnly` =
  `["Ajustes","Conocimiento","Integraciones","Social"]`, no-`adminOnly` =
  `["Agenda","Agentes","Automatizaciones","Bandeja","Contactos","Contenido","Dashboards"]`.

**N3 — Colapsado**
- ✅ Colapsado, no queda texto de título de grupo (mismo patrón
  `collapsed:hidden` que ya usaba el proyecto para los nombres de ítem).
- ✅ Exactamente una línea separadora entre grupos consecutivos visibles,
  ninguna antes del primero ni de más si un grupo se cae por permisos
  (`navSections`, describe "separatorBefore", 4 tests incluyendo el caso con
  un solo grupo visible).
- ✅ El cajón del teléfono nunca colapsa y muestra los grupos con título
  (no se tocó esa lógica; solo se le agregó `flex flex-col` para que el
  bloque del fondo se empuje igual que en escritorio).

**N4 — Estado activo**
- ✅ `/dashboard/settings/integrations` → Integraciones activo, Ajustes no.
- ✅ `/dashboard/settings/team` → Ajustes activo, Integraciones no.
- ✅ `/dashboard/channels` → Integraciones activo.
- ✅ Exactamente un ítem activo en cualquier ruta del dashboard: test que
  recorre las 47 rutas de `PAGE_META` con la vista de un admin.

**N5 — Tests reescritos**
- ✅ `npx vitest run` en verde, sin tests borrados ni saltados.
- ✅ Cada aserción identificada en la exploración inicial se reescribió con
  la regla nueva (ver la tabla de la sección 3 del plan): "Integraciones no
  está" se invirtió; "Contenido después de Flows" y "Agenda después de
  Contacts" se reescribieron con los nombres y grupos nuevos; el baseline de
  Member y las dos listas de `member-baseline.test.ts` se actualizaron.

## Lo que no se tocó (intocable del documento)

Rutas, `PAGE_META`, `PAGES_WITHOUT_HEADER`, `PERMISSION_KEYS`,
`app/layout.tsx`, `app/globals.css`, y nada de `messages`, `conversations`,
`contacts` ni `lib/chat-media/`/`lib/messages/` (la sesión paralela de chat).
`/dashboard/channels` sigue existiendo entera; solo se verificó por código
que nada de su `page.tsx` cambió.

## Pendiente

Ver [`docs/PENDIENTE-N.md`](PENDIENTE-N.md): las capturas (necesitan tu
sesión) y un título de la barra superior ("Flows") que va a convivir un
bloque más con el nombre nuevo del menú, sin que ningún bloque lo tenga
asignado todavía.
