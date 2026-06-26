# Backend de Licencias — Extractor de Correos

Este servidor controla las licencias de la extensión: cuántas PCs distintas
pueden activar cada código (1 o 3), y valida que una PC ya activada siga
funcionando sin gastar cupos adicionales.

## ¿Por qué existe esto?

La extensión de Chrome es un conjunto de archivos de texto que cualquiera
puede leer y editar en la PC del usuario. Si el control de "cuántas PCs ya
usaron este código" viviera solo dentro de la extensión, cualquier persona
con conocimientos básicos podría editarlo y saltarse el límite. Por eso el
conteo real vive aquí, en un servidor que solo tú controlas.

## Estructura

```
license-backend/
├── package.json
├── render.yaml          # configuración para desplegar en Render con 1 clic
├── .env.example          # plantilla de variables de entorno
├── data/                 # aquí se guarda licenses.db (se crea solo)
└── src/
    ├── db.js                  # acceso a la base de datos SQLite
    ├── server.js              # servidor Express con los endpoints
    ├── generate-license.js    # script CLI para generar códigos
    └── list-licenses.js       # script CLI para ver licencias y su uso
```

## Endpoints

### `POST /api/activate`
Lo llama la extensión (a través del host nativo) cada vez que el usuario
intenta usar/activar un código de licencia.

```json
// Request
{ "code": "ABCD-EFGH-JKLM-NPQR", "machine_id": "id-unico-de-la-pc" }

// Respuesta si todo bien (primera vez en esta PC)
{ "ok": true, "status": "newly_activated", "max_machines": 3, "activations_used": 1 }

// Respuesta si esta PC ya estaba activada antes (no gasta cupo nuevo)
{ "ok": true, "status": "already_active", "max_machines": 3, "activations_used": 2 }

// Respuesta si ya no quedan cupos
{ "ok": false, "error": "Esta licencia ya alcanzó su límite de 3 PCs.", "max_machines": 3, "activations_used": 3 }
```

### `POST /api/verify`
Heartbeat opcional para reconfirmar que una activación sigue siendo válida
(por ejemplo, si revocaste la licencia después de que ya estaba activada).

### `GET /api/health`
Solo para comprobar que el servidor está vivo (útil para Render/monitoreo).

### Endpoints de administración (requieren header `x-admin-key`)
- `GET /api/admin/licenses` — lista todas las licencias
- `POST /api/admin/licenses` — crea una licencia: `{ "max_machines": 1|3, "note": "..." }`
- `POST /api/admin/licenses/:code/revoke` — revoca una licencia
- `POST /api/admin/licenses/:code/unrevoke` — reactiva una licencia revocada

## Cómo generar licencias (línea de comandos)

Esto lo corres tú mismo, desde tu PC o desde la consola de Render, **no** lo
hace el cliente final.

```bash
# Licencia para 1 sola PC
node src/generate-license.js 1 "Cliente: Juan Pérez"

# Licencia para 3 PCs
node src/generate-license.js 3 "Cliente: Empresa XYZ - paquete oficina"

# Ver todas las licencias generadas y cuántas PCs las están usando
node src/list-licenses.js

# Ver el detalle de una licencia específica (incluye qué PCs la activaron)
node src/list-licenses.js ABCD-EFGH-JKLM-NPQR
```

> Importante: estos scripts leen/escriben directamente en el archivo
> `data/licenses.db`. Si despliegas en Render, debes correrlos **desde la
> consola (Shell) de Render**, no desde tu PC local, para que escriban en la
> misma base de datos que usa el servidor en producción (ver más abajo).

## Despliegue paso a paso en Render (plan gratuito)

1. **Crea una cuenta** en [render.com](https://render.com) (puedes registrarte
   con tu cuenta de GitHub o con tu email).

2. **Sube esta carpeta a un repositorio de GitHub** (puede ser privado):
   - Crea un repositorio nuevo en GitHub, por ejemplo `license-backend`.
   - Sube todos los archivos de esta carpeta (`license-backend/`) a ese
     repositorio. Si no sabes usar git desde la terminal, puedes arrastrar
     los archivos directamente desde la interfaz web de GitHub
     ("Add file" → "Upload files").

3. En Render, haz clic en **"New +"** → **"Web Service"**.

4. Conecta tu cuenta de GitHub y selecciona el repositorio que subiste.

5. Render debería detectar automáticamente el archivo `render.yaml` y
   pre-llenar la configuración. Si no lo detecta automáticamente, configura
   manualmente:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

6. **Configura el disco persistente** (muy importante, si no lo haces
   perderás todas las licencias en cada actualización del servidor):
   - En la sección "Disks" del servicio, agrega un disco:
     - Name: `licenses-data`
     - Mount Path: `/opt/render/project/src/data`
     - Size: 1 GB (el mínimo, es más que suficiente)
   - Esto ya viene preconfigurado en `render.yaml`, pero verifica que se haya
     aplicado en el panel.

7. **Configura las variables de entorno** en la sección "Environment":
   - `ADMIN_KEY`: inventa una clave larga y secreta (por ejemplo, generándola
     con `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
     en tu PC). **Guárdala en un lugar seguro, la vas a necesitar para crear
     licencias desde el panel de admin si decides usarlo, y para proteger el
     servidor.**
   - `ALLOWED_ORIGIN`: puedes dejarlo vacío por ahora; lo configuraremos
     cuando tengamos el ID final de la extensión.

8. Haz clic en **"Create Web Service"**. Render instalará las dependencias y
   arrancará el servidor. Esto toma 2-5 minutos la primera vez.

9. Cuando termine, Render te dará una URL pública, algo como:
   `https://license-backend-xxxx.onrender.com`
   Esa es la URL que usará la extensión para validar licencias. Guárdala.

10. **Prueba que esté viva**: abre en el navegador
    `https://TU-URL.onrender.com/api/health` — deberías ver
    `{"ok":true,"time":"..."}`.

## Generar tu primera licencia en producción

Una vez desplegado, ve a la pestaña **"Shell"** del servicio en Render (te da
una terminal conectada directamente al servidor en producción) y corre:

```bash
node src/generate-license.js 1 "Mi primera licencia de prueba"
```

Esto te dará un código como `ABCD-EFGH-JKLM-NPQR` que ya queda guardado en la
base de datos real, lista para que la extensión la valide.

## Nota sobre el plan gratuito de Render

El plan gratuito "duerme" el servidor tras ~15 minutos sin tráfico, y tarda
unos segundos en "despertar" en la siguiente solicitud. Para un sistema de
licencias esto es aceptable (el usuario notará como máximo unos segundos de
espera la primera vez que abre la extensión tras un rato). Si en el futuro
necesitas que esté siempre activo al instante, puedes pasar a un plan pago
de Render (unos pocos dólares al mes).

## Próximos pasos

Este backend, por sí solo, no hace nada todavía visible para el usuario.
Las siguientes piezas que construiremos son:
1. El **host nativo** (programa de Windows) que lee el Machine ID real y se
   comunica con esta API.
2. La **extensión actualizada** que pide el código de licencia al usuario,
   se comunica con el host nativo, y llama a este backend para validar.
