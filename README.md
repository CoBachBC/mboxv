# Lector MBOX

Herramienta web para consultar archivos de correo **.mbox** y **.eml** (respaldos de Google Takeout, Thunderbird, etc.).
Se instala como aplicación (PWA), funciona sin conexión y **los archivos se procesan en el equipo del usuario: nunca se suben a internet.**

## Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `carloschee/lector-mbox`.
2. Sube el contenido de esta carpeta a la raíz del repositorio (`index.html`, `manifest.webmanifest`, `sw.js`, `icons/`, `.nojekyll`).
3. En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
4. Quedará disponible en `https://carloschee.github.io/lector-mbox/`.

Las rutas son relativas, así que funciona con cualquier nombre de repositorio.

## Publicar una actualización

1. Edita `index.html` y cambia `version` dentro de `CONFIG` (por ejemplo `1.0.1`).
2. Cambia **la misma versión** en `const VERSION` de `sw.js`.
3. Sube los cambios. Los usuarios reciben la nueva versión automáticamente: con conexión, al volver a abrir la app (a veces requiere abrirla dos veces). La versión instalada se ve en la esquina inferior derecha.

## Instalarla a todo el personal desde la consola de Google

Para usuarios que usan Chrome con su cuenta institucional (ChromeOS, o Windows/Mac con el perfil de Chrome administrado):

1. Consola de administración → **Dispositivos → Chrome → Apps y extensiones → Usuarios y navegadores**.
2. Selecciona la unidad organizativa.
3. Botón **+** → **Agregar por URL** → `https://carloschee.github.io/lector-mbox/`.
4. Política de instalación: **Forzar instalación** (en ChromeOS puedes además fijarla en la barra).

En Windows/Mac la política solo aplica si el perfil de Chrome está administrado por el dominio (inicio de sesión con la cuenta institucional y administración de Chrome para usuarios activada, o Chrome Browser Cloud Management).

Sin la consola, cualquier usuario puede instalarla con el botón **Instalar** de la barra superior (o el ícono de instalar en la barra de direcciones de Chrome/Edge).

## Abrir archivos con doble clic

Una vez instalada en Chrome o Edge, la app se registra para abrir `.mbox`, `.mbx` y `.eml`.
La primera vez el navegador pide permiso para abrir el archivo con Lector MBOX. Si Windows abre otro programa, usa
**clic derecho → Abrir con → Elegir otra aplicación → Lector MBOX → Usar siempre**.

## Requisitos y límites

- Chrome o Edge actualizados (recomendado). Firefox y Safari funcionan, pero sin instalación ni doble clic.
- El tamaño máximo depende de la memoria del equipo; como referencia, 200 MB / 300 mil mensajes usan ~700 MB de RAM.
- Vista previa: PDF, imágenes, Word (.docx), Excel (.xlsx), PowerPoint (.pptx, texto), OpenDocument, RTF, CSV, texto, audio, video, ZIP (contenido) y correos adjuntos. Los formatos antiguos (.doc, .xls, .ppt) solo se descargan.

## Personalización

En `index.html`, bloque `CONFIG`: `titulo` y `organizacion` (texto bajo el título). Colores en las variables CSS `--g` (guinda) y `--gold`.
