# Sistema Operativo de Negocio con IA

Un sistema operativo para tu negocio: CRM, bandeja multicanal (WhatsApp, Instagram y email) con agente de IA, automatizaciones, agenda y contenido en una sola plataforma, para que ningún lead quede sin respuesta y todo viva en una sola fuente de verdad.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Qué trae

- **Bandeja multicanal**: WhatsApp (Evolution API), Instagram (Zernio) y email, con adjuntos, notas de voz transcriptas, reacciones, stickers y registro de llamadas de WhatsApp.
- **Contactos (CRM)**: etiquetas, campos personalizados, segmentos, importación por CSV, estados de setter y de vendedor, producto de interés, fusión de duplicados y la marca «Conocido».
- **Asignación**: setter y vendedor de cada lead (a mano o por reglas) y responsable de cada chat.
- **Banca de recursos**: textos, audios, videos, imágenes, archivos y enlaces listos para mandar desde la bandeja, los flujos o el agente.
- **Secuencias, broadcasts y automatizaciones**: un editor visual de flujos con condiciones.
- **Agentes IA**: con tu propia clave de OpenAI, Anthropic o Google; tareas de IA en segundo plano (clasificar, resumir) y una base de conocimiento.
- **Agenda**: conectada a Google Calendar, con página pública de reservas y un embed para cualquier web.
- **Contenido y publicación**: ideas, piezas y publicación en Instagram, TikTok, YouTube, LinkedIn y Threads; métricas en Social.
- **Dashboards**: Chat, Contenido, Anuncios de Meta (con la tabla Meta vs CRM), Agenda y uno unificado.
- **Catálogo de productos**, **equipo con roles y permisos**, e **invitaciones**.
- **Varios negocios en la misma instalación**, cada uno con su marca.

## White label

Cada instalación es su propia copia: un deploy aparte con su propia marca y su propia base de Supabase. La marca (nombre, logo, color) sale de variables de entorno, nunca de un valor escrito en el código — ver `.env.example` y [lib/brand.ts](lib/brand.ts).

```
NEXT_PUBLIC_BRAND_NAME=Nombre del negocio
NEXT_PUBLIC_BRAND_LOGO_URL=https://.../logo.png   # opcional; sin esto se muestra un monograma
NEXT_PUBLIC_BRAND_COLOR=#4f46e5                   # opcional; sin esto queda el color por defecto
AI_LANGUAGE_STYLE=español rioplatense (vos/tenés)  # opcional; cómo escribe el agente
```

Cada negocio puede además tener su propio nombre, logo, color y tono de la IA desde **Ajustes → General → Marca**.

No hay registro público: la única forma de entrar la primera vez es creando el primer Owner con la Service Role Key. Después, el resto del equipo entra por invitación (**Ajustes → Equipo**).

## Stack

| Capa | Herramienta |
|------|-------------|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| Base de datos + Auth + Realtime | Supabase (PostgreSQL) |
| Estilos | Tailwind CSS v4 |
| Flow builder | React Flow (@xyflow/react) |
| IA | Vercel AI SDK, BYOK multi-proveedor (OpenAI / Anthropic / Google) |
| Canal Instagram | Zernio |
| Canal WhatsApp | Evolution API (Baileys), self-hosted |
| Email | Resend |
| Secretos | Supabase Vault (AES-256) |
| Hosting | Railway |
| Testing | Vitest 3 |

## Puesta en marcha

### La forma recomendada: `/setup` en Claude Code

Abrí tu copia del repositorio en Claude Code y escribí `/setup`. Te guía, paso a paso y charlando, por todo el arranque obligatorio: el proyecto de Supabase y la base de datos, Railway con su dominio y sus variables, la conexión de los cron, los links de autenticación y el archivo `.env` local. Nunca te pide claves por chat: te dice dónde copiarlas y dónde pegarlas.

### A mano

Requisitos: Node.js 20+, un proyecto de [Supabase](https://supabase.com) y la CLI de Supabase (`/setup` te la descarga sin instalar nada).

1. **Instalar dependencias**

   ```bash
   npm install
   ```

2. **Armar la base de datos**

   La base viene en 17 archivos de migración (`supabase/migrations/`, uno por área). La CLI los aplica en orden y anota cuáles ya aplicó:

   ```bash
   supabase login
   supabase link --project-ref <ID del proyecto>
   supabase db push
   ```

   No pegues las migraciones en el SQL Editor del panel: son grandes y conviene que la CLI lleve la cuenta.

3. **Configurar el entorno**

   ```bash
   cp .env.example .env
   ```

   Completá las credenciales de Supabase y el resto de las variables — cada una está explicada en el propio `.env.example`. Las claves de las integraciones (Zernio, Resend, los proveedores de IA, Meta, Google) **no van en variables de entorno**: se cargan desde **Ajustes → Integraciones** y se guardan cifradas en Supabase Vault.

4. **Crear el primer usuario**

   ```bash
   node scripts/create-owner.mjs --email=tu@email.com --name="Tu nombre" --workspace="Tu negocio" --timezone=America/Argentina/Buenos_Aires
   ```

   Sin `--password` genera una contraseña y la muestra una sola vez.

5. **Cargar los precios de los modelos de IA** (después del primer usuario: se cargan para cada negocio que exista, y se pueden correr más de una vez sin duplicar)

   ```bash
   supabase db query --linked -f supabase/seeds/00_model_pricing.sql
   supabase db query --linked -f supabase/seeds/01_transcription_pricing.sql
   ```

   Sin esto, lo que gasta IA queda con el costo vacío y los topes de gasto no funcionan.

6. **Conectar los cron** (para que corra lo automático: secuencias, recordatorios, publicaciones programadas, el agente). En el SQL Editor de Supabase, con el dominio de tu app y el mismo `CRON_SECRET` que pusiste en Railway:

   ```sql
   select private.set_system_secret('app_url', 'https://tu-app.up.railway.app');
   select private.set_system_secret('cron_secret', 'el-mismo-valor-que-en-railway');
   select * from private.system_secrets_status();  -- comprueba sin mostrar el secreto
   ```

7. **Correr en desarrollo**

   ```bash
   npm run dev
   ```

   Abrí [http://localhost:3000](http://localhost:3000) e iniciá sesión con la cuenta del paso 4.

### Desarrollo con una base local (opcional)

Si tenés Docker, podés levantar una base de Supabase en tu computadora para probar sin tocar la de verdad:

```bash
supabase start      # levanta la base local y aplica las migraciones
supabase status     # muestra la URL y las claves locales para el .env
```

Poné en el `.env` la URL (`http://127.0.0.1:54321`) y las claves que muestra `supabase status`, creá el primer usuario con `create-owner.mjs` y cargá los precios con `supabase db query --local -f ...`. `supabase db reset` vuelve a armar la base desde cero y `supabase stop` la apaga.

Ojo: los canales no mandan mensajes a una app en `localhost` (el sistema se niega a registrar una dirección local como webhook), así que WhatsApp e Instagram se prueban con la app desplegada.

## Varios negocios en una instalación

Un mismo dueño puede manejar varios negocios desde el mismo login. Cada uno es un espacio de trabajo con sus claves, canales, contactos, equipo y marca, y se elige con el selector de arriba a la izquierda.

```bash
node scripts/create-workspace.mjs --owner-email=tu@email.com --name="Mi segunda marca" --timezone=America/Argentina/Buenos_Aires
```

Después, en el negocio nuevo: **Ajustes → General → Marca**, **Ajustes → Integraciones** (sus propias claves), un usuario de agenda distinto y las invitaciones del equipo. No conectes la misma cuenta de Instagram ni el mismo número de WhatsApp en dos negocios.

Si el negocio es de **otro dueño**, no va en la misma instalación: es una copia nueva del sistema.

## Testing

```bash
npx vitest run
```

Los scripts `scripts/verify-*.mjs` corren contra la base del `.env`, con usuarios de prueba que crean y limpian solos (prefijo `zz-test-`). Se corren de a uno: comparten el prefijo y se pisan la limpieza. Para correrlos contra la base local: `DB_TARGET=local node scripts/verify-rls.mjs` (con el `.env` apuntando también a la local).

## Licencia

MIT. Este proyecto se construyó sobre la base de un proyecto de código abierto bajo la misma licencia — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para el detalle y el aviso de copyright original.
