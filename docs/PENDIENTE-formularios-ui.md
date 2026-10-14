# Pendientes: Formularios (UI nueva), menú lateral y URL de entrada

Plano: `claude/v12/requerimientos-formularios-ui-menu.md`. Avance en [PROGRESS-formularios-ui.md](PROGRESS-formularios-ui.md).

Formato: **qué quedó**, **por qué**, **qué se decidió**.

## Decisiones tomadas el 13/10/2026 (antes de construir)

- **Recursos fuera del menú y el Member.**
  - Qué: hoy el Member ve "Recursos" y no ve "Ajustes".
  - Por qué: si Recursos sale del menú (D4), el Member se queda sin forma de entrar desde el menú.
  - Decidido: "Ajustes" aparece para quien vea al menos una pestaña de Ajustes. El Member entra directo a Recursos, sin barra de pestañas.
- **Métricas de las tarjetas de la lista.**
  - Qué: el plano pide conversión, NPS y personas; hoy la lista solo calcula respuestas y la última.
  - Decidido: reusar los cálculos que ya existen (`conversionRate`, el NPS del panel de la encuesta, reportes y personas distintas del EOD), con una consulta por cosa y no una por formulario.
- **Coordinación con la sesión de Equipo y roles.**
  - Decidido: esta corrida usa la migración `00215`, deja B1 lo más chico posible (no toca `adminOnly` ni permisos) y le avisa a la otra sesión.

## Pendientes

- **Revisar en vivo, con sesión (hoy no hay forma de ejecutar Server Actions desde el navegador de pruebas).** Los items `[~]` de "Funcionalidad que se conserva" en el PROGRESS: Guardar de Contacto, encender/apagar y "Nuevo flow", cambiar la parte final del link con confirmación, el link firmado para un contacto, Pausar / Reanudar / Archivar / Restaurar desde la tarjeta Estado de Publicar, y crear / duplicar / autoguardar / conflicto / publicar con y sin contactos. El código de cada uno es el de antes (o la misma acción que usa el menú "⋯" de la lista); lo nuevo es dónde se dibujan.
- **El CSV de respuestas no suma la URL de entrada.** Qué: `entry_url` se ve en el detalle y en el contacto, pero no es una columna del CSV. Por qué: `VISIT_META_KEYS` (de donde sale el CSV) no cambia en este plano. Qué se decidió: dejarlo; sumar la columna es un cambio chico en `lib/forms/export.ts` cuando se pida.
- **`<details>` que quedan fuera del alcance del plano:** "Ver como tabla" en `components/forms/responses/metrics-view.tsx` (Métricas es un botón, no una pestaña; el plano lo deja) y "Por canal" en `components/eod/reports/reports-view.tsx` (Reportes de un EOD, que el plano no menciona). El test `no-details` cubre solo `components/forms/editor` y `components/forms/builder`, como pide el plano.
- **Las huellas de `record_contact_touch` en los `verify-*` de otras ramas.** La 00215 cambió a propósito la definición de `record_contact_touch` (md5 `2f51ddbf060e31528b89ce7481b38e3d`; antes `f364db1862cc0f90291ca14ef855a214`). `verify-forms` y `verify-ads-attribution` de ESTA rama ya esperan la nueva; los de otra rama (por ejemplo la de Equipo y roles, o la de Contactos) siguen esperando la vieja y fallan en la comprobación de esa huella hasta que se actualicen: son dos constantes (`scripts/verify-forms.impl.ts` y `scripts/verify-ads-attribution.mjs`).
- **Reescribí mi último commit ya subido (B4).** Un `git add` con una ruta que no existía dejó subido un commit que solo borraba `design-cards.tsx` (la rama quedaba sin compilar). Lo rehice (`reset --soft` + commit completo) y lo subí con `--force-with-lease`, solo sobre esta rama (nadie más la usa y todavía no hay PR).

## Notas de la corrida

- **Mensaje a la sesión de Equipo y roles: no llegó.** Lo mandé el 13/10 (migración `00215` y archivos del menú que toca B1) y quedó retenido: la otra sesión corre en un modo de permisos distinto y no lo aprobó antes de que venciera. Qué se decidió: no reenviarlo; el aviso queda en este documento y en el PR. Si roles mergea antes, los conflictos en `lib/nav/items.ts`, `lib/nav/page-actions.ts`, `lib/settings/tabs.ts`, `components/sidebar.tsx` y `member-baseline.test.ts` se resuelven en esta rama.
- **`supabase/.temp` y `.env` enlazados al checkout principal.** Los scripts `verify-*` usan `supabase db query --linked` y leen `.env`; el worktree no los tiene (están en `.gitignore`). Son symlinks, no se commitean.
- **Candado de los `verify-*` huérfano.** Otra sesión coordina los scripts con `/private/tmp/ssa-verify.lock` (un directorio vacío). Encontré uno de las 18:44 sin ningún `verify-*` corriendo bajo él; mi corrida lo tomó solo con más de 15 minutos de antigüedad y sin scripts activos. La sesión de roles corre sus `verify-*` sin ese candado, así que las corridas se serializaron esperando que no hubiera ningún `node scripts/verify-*` activo.

- **Conversión de las tarjetas.**
  - Qué quedó: la conversión es la de los últimos 366 días y se pide con una llamada a `form_metrics_daily` por formulario con respuestas (hasta 40, en paralelo).
  - Por qué: la RPC acepta un solo formulario y no tiene versión en lote; una migración nueva (una función por workspace) quedaba fuera del plano, que solo trae M1.
  - Qué se decidió: dejarlo así. Si la lista crece mucho, la salida es una función en lote (con aprobación).
- **La barra de cada tarjeta** compara las respuestas con las del formulario que más tiene, en vez de escalar la conversión con un factor por tipo como el prototipo. Es una decisión mía para no inventar un número que la app no calcula.
