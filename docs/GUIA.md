# Guía: publicar Entreno gratis y usarla como app en el iPhone

No hace falta saber programar. Tardarás unos 10 minutos la primera vez.
La app no tiene servidor ni cuentas: **tus datos se guardan solo en tu iPhone**. GitHub solo sirve los archivos de la app.

---

## 1. Publicar la app en GitHub Pages

El código ya está en tu repositorio **alvar1712-blip/gym**. Solo hay que activar GitHub Pages.

### 1.1. (Si aún no está) Pasar el código a la rama principal
Si el trabajo sigue en la rama `claude/personal-training-mobile-app-e82j38`, puedes:
- **Opción A (recomendada):** abrir el *pull request* de esa rama en GitHub y pulsar **Merge pull request** → **Confirm merge**.
  Así el código queda en `main`.
- **Opción B:** publicar directamente desde esa rama (en el paso 1.2 eliges esa rama en vez de `main`).

### 1.2. Activar GitHub Pages
1. Entra en <https://github.com/alvar1712-blip/gym> (desde el ordenador es más cómodo, pero también vale el móvil).
2. Pulsa **Settings** (Configuración), arriba a la derecha del repositorio.
3. En el menú de la izquierda, pulsa **Pages**.
4. En **Build and deployment → Source**, elige **Deploy from a branch**.
5. En **Branch**, elige `main` (o la rama de la opción B) y la carpeta **/ (root)**. Pulsa **Save**.
6. Espera 1–3 minutos y recarga la página: arriba aparecerá **«Your site is live at…»** con tu dirección:
   **<https://alvar1712-blip.github.io/gym/>**

> **Si no te aparece Pages o te pide pagar:** GitHub Pages es gratis en repositorios **públicos**. Si tu repositorio
> es privado, hazlo público en **Settings → General → Danger Zone → Change repository visibility → Public**.
> No pasa nada: en el repositorio solo está el código de la app, **nunca tus datos de entrenamiento** (esos viven en el iPhone).

---

## 2. Instalarla en el iPhone (pantalla de inicio)

1. Abre **Safari** (tiene que ser Safari, no Chrome) y ve a **https://alvar1712-blip.github.io/gym/**
2. Espera a que cargue del todo (la primera vez necesita internet).
3. Pulsa el botón **Compartir** (el cuadrado con la flecha hacia arriba, abajo en el centro).
4. Desliza y pulsa **«Añadir a pantalla de inicio»**. Deja el nombre **Entreno** y pulsa **Añadir**.
5. **Abre ya el icono una vez con internet** (wifi o datos, en casa, no en el gimnasio) y espera unos segundos con la
   app abierta. La app instalada no aprovecha lo que Safari descargó en el paso 2: es en esta primera apertura
   cuando se guarda en el iPhone para funcionar sin conexión.
   *Para comprobarlo:* activa el modo avión, cierra la app desde el selector de apps y vuelve a abrirla desde el
   icono. Si abre normal, ya está lista. Si no abre, quita el modo avión, ábrela de nuevo, espera un poco y repite.
6. **A partir de ahora abre siempre la app desde el icono** de la pantalla de inicio (no desde Safari): se abre a
   pantalla completa, sin barra de Safari, y funciona **sin conexión** (en el gimnasio sin cobertura).

> ⚠️ **Importante:** los datos de la app instalada en la pantalla de inicio son independientes de los de Safari
> (también lo que descarga para funcionar sin conexión, por eso hace falta el paso 5).
> Usa siempre el icono. Si borras el icono de la pantalla de inicio, **se borran sus datos**: haz antes una copia.

---

## 3. Copias de seguridad (muy recomendable cada semana)

Como no hay servidor, la copia la guardas tú:

1. En la app: **Ajustes → Copias y datos → Exportar copia**.
2. Se abre la hoja de compartir de iOS: elige **Guardar en Archivos** (por ejemplo en *iCloud Drive* o *En mi iPhone*)
   o **Drive** si tienes la app de Google Drive.
3. La app te recordará hacer una copia si han pasado más de 7 días desde la última (aviso en **Hoy** y punto naranja en **Ajustes**).

**Restaurar** (por ejemplo en un iPhone nuevo o si borraste la app): instala la app (paso 2) →
**Ajustes → Copias y datos → Importar copia** → elige el archivo `entreno-copia-….json` → confirma.
Se sustituye todo por el contenido de la copia.

**Exportar a Excel o a Claude:** **Ajustes → Copias y datos → Exportar CSV de fuerza / CSV de cardio**.
El formato «Excel en español» abre directamente en Excel con comas decimales; el «estándar» es el mejor para Claude.

---

## 4. Actualizaciones

Cuando se publique una versión nueva en GitHub, abre la app **con conexión**: aparecerá el aviso
**«Hay una versión nueva de la app» → Actualizar**, fijo encima de la barra de pestañas en las pantallas principales
(no interrumpe una sesión ni un formulario). Tus datos no se tocan al actualizar. Si pulsas **×**, el aviso se oculta
y vuelve a salir la próxima vez que vuelvas a la app.
Si no aparece, cierra la app desde el selector de apps y vuelve a abrirla.

---

## 5. Problemas frecuentes

| Problema | Solución |
|---|---|
| No aparece «Añadir a pantalla de inicio» | Asegúrate de estar en **Safari** (no en otra app ni en el navegador de Instagram/WhatsApp). |
| La app sale con la barra de Safari | La has abierto desde Safari: ábrela desde el **icono**. |
| Sin cobertura, el icono no abre la app | Aún no se había abierto nunca con internet. Ábrela una vez desde el icono con conexión y espera unos segundos (paso 2.5). |
| «No se pudo abrir el almacenamiento» | No uses el modo de navegación privada. Abre la app desde el icono. |
| Quiero pasar mis datos a otro móvil | Exporta la copia en el viejo, instala en el nuevo e **Importa copia**. |
| Borré el icono sin copia | Los datos de ese icono se pierden. Por eso la app te recuerda hacer copias. |

---

## 6. Para curiosos: qué hay en el repositorio

- `index.html`, `manifest.json`, `sw.js` (hace que funcione sin conexión), `icons/` (icono de la app)
- `css/` (aspecto), `js/` (funcionamiento), `docs/` (esta guía, requisitos y arquitectura)
- `tests/` (pruebas automáticas; no hacen falta para usar la app)

No hay nada que compilar ni instalar: GitHub Pages sirve los archivos tal cual.
