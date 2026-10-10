---
description: Asistente de arranque obligatorio para un clon nuevo (Supabase y migraciones, Railway y variables, secretos del cron, URLs de Auth y .env local).
disable-model-invocation: true
---

# Asistente de arranque (setup obligatorio)

Estás corriendo este comando porque alguien acaba de abrir SU PROPIA copia de este repo (creada desde la plantilla de GitHub) y quiere dejarla funcionando. Tu trabajo es guiar a esa persona, charlando, paso a paso, por el arranque OBLIGATORIO: sin estos pasos el sistema no funciona en producción.

Fuera de este comando, a propósito: crear el primer usuario del sistema y las integraciones opcionales (Instagram/Zernio, WhatsApp/Evolution, Google Calendar, Resend, proveedores de IA). Eso está en la guía de instalación que le compartieron junto con el repo. No lo empieces acá.

## Cómo comportarte durante todo el comando

- Hablá en español, en lenguaje simple. Si usás un término técnico (migración, dominio, variable de entorno, conector MCP...), explicalo entre paréntesis la primera vez.
- Avanzá de a un paso. Antes de pasar al siguiente, confirmá algo concreto ("¿ya creaste el proyecto?", "¿el deploy dice Success?") y ESPERÁ la respuesta.
- Si la persona pega una captura de pantalla, usala para ver en qué pantalla está y decirle exactamente qué tocar.
- **NUNCA le pidas que te pase por chat ninguna clave**: ni la `SUPABASE_SERVICE_ROLE_KEY`, ni la anon key, ni el `CRON_SECRET`, ni contraseñas. Tu trabajo es decirle DÓNDE copiarla y DÓNDE pegarla (en Railway, en el SQL Editor de Supabase o en el archivo `.env`). Si igual te pega una, no la repitas, no la uses, y avisale que conviene generar una nueva porque quedó escrita en el chat.
- Si algo falla, no tires el error técnico crudo: explicá qué pasó, por qué probablemente pasó, y qué proponés. Pará y esperá confirmación antes de reintentar.
- Antes de preguntar nada, hacé un diagnóstico rápido: ¿existe `.mcp.json`? ¿existe `.env`? Si hay señales de que un paso ya se hizo, decíselo y preguntale si lo salteamos.

## Paso 0 — Bienvenida

Saludá y explicá en 3-4 líneas los pasos: Supabase, Railway, conectar la base con la app, links de autenticación, archivo `.env` local y, al final, una pregunta sobre las actualizaciones. Después le vas a indicar qué falta. Preguntale si arrancamos.

## Paso 1 — Supabase: proyecto, conector y migraciones

1. **Cuenta y proyecto.** Preguntale si ya tiene cuenta en supabase.com y un proyecto creado para este negocio. Si no, guiala: crear la cuenta, crear un proyecto nuevo con una región cercana, y guardar en un lugar seguro la contraseña de la base que pide Supabase (no hace falta que te la diga).

2. **Reference ID.** Pedile el Reference ID del proyecto (Supabase → Project Settings → General, o en la dirección del panel: `supabase.com/dashboard/project/<ESTO>`). No es secreto: está bien que te lo pase por chat.

3. **Conectar el conector de Supabase.** Explicale que esto te permite a vos revisar su base y cargar configuración sin que la persona tenga que escribir SQL a mano.
   - Si no existe `.mcp.json` en la raíz (lo normal en un clon nuevo, porque no se sube a GitHub), copiá `.mcp.json.example` a `.mcp.json`.
   - Reemplazá `<PROJECT_REF>` en `.mcp.json` por el Reference ID.
   - Pedile que escriba `/mcp` para ver el conector "supabase" y aprobarlo si aparece pendiente. Si no aparece, o las herramientas de Supabase siguen sin estar disponibles, que cierre esta sesión de Claude Code, la vuelva a abrir y corra `/setup` de nuevo: vas a detectar que el paso ya está hecho.
   - Probalo con una consulta de solo lectura, por ejemplo `select count(*) from information_schema.tables where table_schema = 'public';`. En un proyecto nuevo tiene que dar 0 o casi 0. Si ya hay muchas tablas, avisale: puede ser el proyecto equivocado o una base que ya se armó antes. No sigas sin aclararlo.

4. **Construir la base de datos (las migraciones).** Explicale que las migraciones son archivos que ya traen escrito todo el trabajo de armar la base (las tablas, las reglas de seguridad), y que se corren una sola vez.

   **Nunca las apliques de a una con el conector** (`apply_migration` / `execute_sql`): son más de cien archivos y decenas de miles de líneas. Tendrías que leerlas y reescribirlas enteras, tardaría muchísimo y un solo carácter mal copiado rompe la base. En las dos opciones de abajo el archivo va directo del disco a Supabase, sin pasar por vos.

   Ofrecele elegir entre estas dos opciones, y que decida la persona:

   **Opción rápida (la recomendada): pegar un solo archivo en el SQL Editor.** Tarda un par de minutos y no hay que instalar nada. Si más adelante quiere la CLI, la puede sumar cuando quiera.
   - Copiale el archivo al portapapeles sin leerlo: en Mac, `pbcopy < supabase/migrations/ALL_MIGRATIONS.sql`; en Windows (PowerShell), `Get-Content -Raw supabase/migrations/ALL_MIGRATIONS.sql | Set-Clipboard`. Si no se puede, que lo abra en GitHub (carpeta `supabase/migrations`, archivo `ALL_MIGRATIONS.sql`) y use el botón de copiar.
   - Que vaya a Supabase → **SQL Editor → New query**, pegue todo y haga clic en **Run**. Puede tardar uno o dos minutos. Si Supabase avisa que hay operaciones destructivas (borrar columnas o tablas), es normal en una base vacía: que confirme.
   - **Ofrecé hacerlo vos con el navegador, de entrada.** Decile algo así: "Si querés, lo hago yo: abro Supabase en el navegador desde acá, vos iniciás sesión y yo pego y corro el archivo". Esto sirve si tenés navegador (el integrado de la app de escritorio o Claude en Chrome). Si acepta:
     - Copiá el archivo al portapapeles como arriba y abrí `https://supabase.com/dashboard`.
     - Pedile a la persona que **inicie sesión por su cuenta**: nunca escribas su contraseña.
     - Entrá a su proyecto → SQL Editor → New query, pegá con Cmd+V (Ctrl+V en Windows), hacé clic en Run y confirmá el aviso si aparece.
     - En el navegador **solo** usás el SQL Editor. **Nunca** abras Project Settings → API Keys ni Data API, ni ninguna pantalla con claves: las claves las copia siempre la persona.
     - Si el pegado no funciona, volvé al camino de que lo pegue la persona.
   - Preguntale qué dijo al terminar (o miralo vos, si lo hiciste en el navegador). Si dio error, explicá el mensaje en criollo antes de seguir.

   **Opción CLI: más técnica y más larga, pero completa.** Explicale qué es: la CLI de Supabase es una herramienta para manejar Supabase desde la computadora. Con ella su proyecto queda conectado para trabajar con Supabase sin ninguna restricción desde Claude Code: aplicar migraciones, revisar la base, traer actualizaciones con un solo comando. Ofrecela solo si la persona se siente cómoda escribiendo un par de cosas en una terminal.
   - **Instalarla:** fijate si ya está (`supabase --version`). Si no:
     - en Mac con Homebrew, `brew install supabase/tap/supabase`;
     - si tiene Node, `npx supabase@latest` sirve sin instalar;
     - si no tiene ninguno de los dos, explicale qué falta antes de seguir.
   - **Iniciar sesión** (`supabase login`) y **vincular el proyecto** (`supabase link --project-ref <Reference ID>`): estos dos los tiene que completar la persona en una terminal donde pueda escribir. Usá el panel Terminal de la app de escritorio, o pedile que los corra con `!` adelante (por ejemplo `!supabase login`). El login abre el navegador para autorizar y puede pedir un código de verificación. El `link` puede pedir la **contraseña de la base**, la que guardó al crear el proyecto: la escribe la persona en la terminal, nunca en el chat.
   - **Aplicar:** `supabase db push`. Aplica todas las migraciones en orden y las registra. Mostrale lo que pregunte y que confirme.
   - **Si la base ya se había armado con la opción rápida** (por ejemplo, la persona pasa a la CLI más adelante), NO corras `db push` directo: intentaría crear todo de nuevo. Primero marcá las migraciones como ya aplicadas: `supabase migration repair --status applied $(ls supabase/migrations | grep -oE '^[0-9]+' | tr '\n' ' ')`. Recién después, `supabase db push` para las que falten.

   Con cualquiera de las dos opciones, **comprobalo vos con el conector**: `select to_regprocedure('private.set_system_secret(text,text)') is not null as base_completa, (select count(*) from information_schema.tables where table_schema = 'public') as tablas;`. `base_completa` tiene que dar `true` (es una de las últimas piezas que se crean) y `tablas` tiene que ser un número alto.

## Paso 2 — Railway: deploy, dominio y variables

1. Preguntale si tiene cuenta en railway.com. Si no, que se cree una (entrar con GitHub le simplifica el paso siguiente).
2. Guiala a crear un proyecto: **New Project → Deploy from GitHub repo**, eligiendo su repositorio. Avisale que el primer deploy probablemente falle porque faltan las variables: es esperable.
3. **Dominio público:** en el servicio, Settings → Networking → Public Networking → Generate Domain. Pedile que te pase ese dominio (`https://algo.up.railway.app`): no es secreto, y lo vas a usar en los próximos pasos.
4. **El `CRON_SECRET`:** lo inventa la persona, no sale de ningún panel. Sugerile un formato largo y fácil de copiar, por ejemplo `palabra-numero-palabra-numero-palabra` (tipo `cafe-472-martillo-19-domingo`), de al menos 25-30 caracteres. Que lo guarde en un lugar seguro: lo va a pegar en dos lugares (Railway y Supabase) y tiene que ser idéntico en los dos. No te lo pase a vos.
5. **Las 5 variables** (en el servicio → Variables). Explicale de dónde sale cada una y que las pegue DIRECTO en Railway:
   - `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase → Project Settings → Data API.
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → service_role. Es la más sensible (salta todos los permisos de la base): nunca por chat.
   - `NEXT_PUBLIC_APP_URL`: el dominio del punto 3.
   - `CRON_SECRET`: el valor del punto 4.
6. Railway vuelve a desplegar solo. Preguntale qué dice el estado. Si no dice Success, pedile que te copie el texto del error de los logs y ayudala a interpretarlo antes de reintentar.
7. Con el deploy en verde, que abra el dominio en el navegador: tiene que ver la pantalla de login.

## Paso 3 — Conectar la base con la app (los cron)

Explicale PARA QUÉ es: las tareas automáticas (secuencias, recordatorios, publicaciones programadas, el agente) corren dentro de Supabase y "llaman" a la app cada minuto. Para eso la base necesita saber la dirección de la app y la misma contraseña (`CRON_SECRET`) que pusiste en Railway. Se guardan cifradas en Supabase Vault. Sin esto, todo lo automático queda agendado y no corre nunca.

1. **La dirección (no es secreta, la cargás vos)** con el conector:
   `select private.set_system_secret('app_url', 'https://<el dominio del paso 2>');`
   Tiene que devolver "listo: app_url guardado en Vault".
2. **El `CRON_SECRET` lo carga la persona**, porque es secreto. La forma más amigable es el formulario de Vault:
   - Supabase → **Integrations → Vault → Secrets → Add new secret**.
   - **Name:** `system:cron_secret`, exactamente así (con los dos puntos). Es el nombre con el que la base lo busca.
   - **Description:** puede quedar vacía.
   - **Secret value:** el mismo valor que puso en `CRON_SECRET` en Railway.
   - Clic en **Add secret**.

   Si prefiere SQL, o si ya existía un `system:cron_secret` y hay que cambiarlo (el formulario no deja crear dos con el mismo nombre), que pegue esta línea en Supabase → SQL Editor, con su valor entre las comillas, y la ejecute con Run:
   `select private.set_system_secret('cron_secret', 'EL-MISMO-VALOR-QUE-EN-RAILWAY');`
3. **Comprobalo vos**, sin ver el secreto:
   `select * from private.system_secrets_status();`
   - `app_url` tiene que ser el dominio y `cron_secret_set` tiene que dar `true`.
   - Esperá 1-2 minutos y volvé a correrlo. `calls_ok_15m` tiene que empezar a subir, y `calls_401_15m` tiene que quedar en 0.
   - Si `cron_secret_set` da `false`, lo más probable es un nombre mal escrito en el formulario: que revise en la lista de Vault que diga exactamente `system:cron_secret`.
   - Si aparecen 401, el `CRON_SECRET` de Railway y el de Supabase no son iguales (un carácter distinto, algo que se cortó al copiar): que lo vuelva a cargar con la línea de SQL del punto 2, copiando exactamente el mismo valor.

Si más adelante cambia de dominio o de `CRON_SECRET`, se usa la línea `set_system_secret` con el valor nuevo: actualiza el secreto existente sin duplicarlo.

## Paso 4 — Links de autenticación (Supabase Auth → URL Configuration)

Explicale que esto le dice a Supabase a qué dirección devolver a alguien después de aceptar una invitación o recuperar la contraseña. Sin esto, esos links apuntan a `localhost` y no funcionan.

1. Supabase → Authentication → URL Configuration.
2. **Site URL:** el dominio de Railway, con `https://`.
3. **Redirect URLs:** agregar el mismo dominio seguido de `/**` (por ejemplo `https://tu-app.up.railway.app/**`).
4. Guardar.

## Paso 5 — El archivo `.env` local

Sirve para que el proyecto también corra en su computadora (para probar cosas antes de que se vean en vivo).

1. Si no existe `.env` en la raíz, copiá `.env.example` a `.env`.
2. Completá vos `NEXT_PUBLIC_APP_URL=http://localhost:3000` (local, no el dominio de Railway).
3. Generá un `CRON_SECRET` nuevo y distinto al de Railway para este archivo. Explicale que no hace falta que coincida: ningún cron de producción le pega a su computadora, y así un `.env` filtrado no expone el de producción.
4. Dejá vacías `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Decile EXPLÍCITAMENTE que esas tres las escribe la persona: que abra el archivo `.env` con un editor de texto, pegue los mismos valores que usó en Railway, y guarde. Nunca por chat.
5. El resto de las variables (WhatsApp/Evolution, etc.) quedan como están: no son parte del arranque obligatorio.

## Paso 6 — Actualizaciones (preguntale, no lo hagas sin su sí)

Explicale, en lenguaje simple y sin apuro:

- Quien le entregó este sistema lo sigue mejorando (arreglos, funciones nuevas). Su copia puede quedar preparada para traer esas mejoras cuando quiera.
- **Nunca se actualiza sola.** La persona decide si actualiza y cuándo. Mientras no lo pida, su sistema queda exactamente como está.
- Cada actualización llega como un paquete, con una lista de qué trae. Puede saltearse una y aplicarla más adelante: la siguiente incluye las anteriores.
- Elegir solo algunas partes de una actualización se puede, pero no conviene: las partes suelen depender unas de otras. Lo normal es aplicar el paquete entero.
- Si alguna vez modifica el código por su cuenta, Claude Code la ayuda a combinar sus cambios con la actualización.
- Dejarlo preparado no cambia nada hoy: solo deja guardada la dirección de dónde vienen las mejoras.

Preguntale si quiere dejarlo preparado.
- **Si dice que sí:** pedile el link del repositorio original, el que tenía el botón verde "Use this template" (no el de su copia). Agregalo con `git remote add upstream <link>` y probá el acceso con `git fetch upstream`. Si falla por permisos, explicale que necesita tener aceptada la invitación a ese repositorio y que puede pedirla. Contale que, cuando quiera actualizar, alcanza con pedirte "traé las actualizaciones": la guía de instalación tiene el pedido exacto.
- **Si dice que no:** perfecto. Contale que puede prepararlo cuando quiera, pidiéndoselo a Claude Code.

## Cierre

Hacé un resumen corto con checks de lo que quedó funcionando:
- Supabase con todas las migraciones aplicadas.
- Railway desplegado, con dominio y las 5 variables.
- Los cron conectados (`system_secrets_status` con 200 y sin 401).
- Las URLs de Auth apuntando al dominio.
- El `.env` local listo.
- Actualizaciones: preparadas o no, según lo que eligió.

Después explicale qué falta y dónde está: crear su primer usuario (Supabase → Authentication → Users → Add user, con "Auto Confirm User"; o `scripts/create-owner.mjs` si prefiere la terminal) y las integraciones opcionales. Todo eso está en la guía de instalación.

Si en el medio te pregunta por el primer usuario o una integración, respondé lo puntual si es rápido, pero sugerile terminar primero el arranque obligatorio.
