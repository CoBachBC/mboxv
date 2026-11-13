# Lector MBOX

Herramienta web para consultar archivos de correo **.mbox** y **.eml** (respaldos de Google Takeout, Thunderbird, etc.).
Se instala como aplicación (PWA), funciona sin conexión y **los archivos se procesan en el equipo del usuario: nunca se suben a internet.**

## Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `cobachbc/mboxv`.
2. Sube el contenido de esta carpeta a la raíz del repositorio (`index.html`, `mime.js`, `indexer.js`, `manifest.webmanifest`, `sw.js`, `icons/`, `.nojekyll`).
3. En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
4. Quedará disponible en `https://cobachbc.github.io/mboxv/`.

Las rutas son relativas, así que funciona con cualquier nombre de repositorio.

## Publicar una actualización

1. Edita `index.html` y cambia `version` dentro de `CONFIG` (por ejemplo `1.0.1`).
2. Cambia **la misma versión** en `const VERSION` de `sw.js`.
3. Sube los cambios. Los usuarios reciben la nueva versión automáticamente: con conexión, al volver a abrir la app (a veces requiere abrirla dos veces). La versión instalada se ve en la esquina inferior derecha.

## Instalarla a todo el personal desde la consola de Google

Para usuarios que usan Chrome con su cuenta institucional (ChromeOS, o Windows/Mac con el perfil de Chrome administrado):

1. Consola de administración → **Dispositivos → Chrome → Apps y extensiones → Usuarios y navegadores**.
2. Selecciona la unidad organizativa.
3. Botón **+** → **Agregar por URL** → `https://cobachbc.github.io/mboxv/`.
4. Política de instalación: **Forzar instalación** (en ChromeOS puedes además fijarla en la barra).

En Windows/Mac la política solo aplica si el perfil de Chrome está administrado por el dominio (inicio de sesión con la cuenta institucional y administración de Chrome para usuarios activada, o Chrome Browser Cloud Management).

Sin la consola, cualquier usuario puede instalarla con el botón **Instalar** de la barra superior (o el ícono de instalar en la barra de direcciones de Chrome/Edge).

## Abrir archivos con doble clic

Una vez instalada en Chrome o Edge, la app se registra para abrir `.mbox`, `.mbx` y `.eml`.
La primera vez el navegador pide permiso para abrir el archivo con Lector MBOX. Si Windows abre otro programa, usa
**clic derecho → Abrir con → Elegir otra aplicación → Lector MBOX → Usar siempre**.

## Archivos grandes (versión 2)

Desde la versión 2.0 el lector indexa en segundo plano y **guarda el índice en el disco del equipo** (IndexedDB del navegador):

- La primera vez que se abre un archivo se indexa; el usuario puede leer los mensajes conforme aparecen.
- Si se cierra la ventana a la mitad, al volver a abrir el mismo archivo **continúa donde se quedó**.
- Cuando termina, el archivo abre en segundos. En la pantalla de inicio aparecen los archivos que ya se abrieron en ese equipo.
- El índice ocupa aproximadamente 1 a 2 GB por cada 300 mil correos. Se puede borrar desde el panel lateral (no borra el .mbox).

Referencias medidas (equipo con SSD):

| Archivo de prueba | Indexación | Reapertura | Memoria |
|---|---|---|---|
| 1 GB, 495 mil mensajes pequeños | 46 s | 3 s | ~460 MB |
| 3 GB, 11 mil mensajes con adjuntos | 28 s | instantánea | <100 MB |

Para un Google Takeout de 50 GB se espera entre 10 y 40 minutos la primera vez, según el equipo y el disco.

**Requisitos para archivos grandes:** Chrome o Edge actualizados, 8 GB de RAM (16 GB recomendado), el .mbox en un disco interno (de preferencia SSD; en memorias USB o unidades de red es mucho más lento) y 5 GB libres para el índice.

## Requisitos y límites

- Chrome o Edge actualizados (recomendado). Firefox y Safari funcionan, pero sin instalación ni doble clic.
- En archivos de más de 1.5 GB, la búsqueda en el texto revisa el inicio de cada correo (primeros 3,000 caracteres); remitente, destinatarios, asunto, adjuntos y etiquetas se buscan completos.
- Vista previa: PDF, imágenes, Word (.docx), Excel (.xlsx), PowerPoint (.pptx, texto), OpenDocument, RTF, CSV, texto, audio, video, ZIP (contenido) y correos adjuntos. Los formatos antiguos (.doc, .xls, .ppt) solo se descargan.

## Personalización

En `index.html`, bloque `CONFIG`: `titulo` y `organizacion` (texto bajo el título). Colores en las variables CSS `--g` (guinda) y `--gold`.
