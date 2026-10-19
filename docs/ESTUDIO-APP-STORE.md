# Entreno en la App Store: estudio de viabilidad

*Fecha del estudio: 19 de octubre de 2026. Se ha analizado el repositorio en el commit `d9eb366` (rama `claude/ronda10-sin-publicar`). La versión que está ahora en producción es `9f5940b` (`claude/produccion-antes-ronda10`). No se ha modificado el código ni la arquitectura.*

**Leyenda**
- **[Obligatorio]**: requisito oficial, con su fuente.
- **[Recomendado]**: no es obligatorio, pero reduce riesgos o mejora el resultado.
- **[No verificado]**: posibilidad técnica sin comprobar, deducción propia o dato que puede haber cambiado.

---

## 1. Resumen

1. Entreno se puede convertir en una app iOS con **Capacitor 8** sin reescribirla. Se mantiene más del 99 % del código. Hay que cambiar unas 150 líneas y añadir unas 200–400 nuevas, según una estimación hecha sobre el repositorio.
2. El código no depende de nada externo: no tiene dependencias, ni llamadas de red fuera de `sw.js`, ni rutas absolutas. Esto lo hace muy fácil de empaquetar.
3. El riesgo principal no está en el código, sino en los datos. Dentro de una app, iOS puede borrar el IndexedDB si al iPhone le falta espacio. La solución es guardar además una copia JSON automática como archivo. No hace falta cambiar el esquema ni migrar datos.
4. La PWA y la app nativa **no comparten datos**. El traspaso se hace con la copia JSON (formato 2) que ya existe.
5. **No hace falta tener un Mac.** La compilación puede hacerse en Macs en la nube gratuitos (Codemagic o GitHub Actions) y las pruebas en tu iPhone con TestFlight. Aun así, alquilar un Mac por horas ayudaría para depurar.
6. El coste mínimo real es la cuota de Apple: **99 USD al año**, en moneda local. El precio exacto en euros no se ha podido comprobar. Lo demás puede costar 0 €.
7. Por contenido, Entreno cumple la directriz 4.2 de funcionalidad mínima. Para no parecer una web reempaquetada, la app debe llevar todo el código dentro y funcionar en modo avión, nunca cargar la web de GitHub Pages.
8. Faltan varios requisitos obligatorios: política de privacidad (en la tienda y dentro de la app), URL de soporte, capturas, icono, manifiesto de privacidad, cuestionario de edad, cifrado y declaración DSA de la UE.
9. El nombre «Entreno» a secas casi seguro **no sirve** en la App Store española: es el nombre en español de la app Workout de Apple. Hace falta un nombre propio distintivo.
10. **Recomendación:** mantener y mejorar la PWA ahora y preparar gratis todo lo posible. Solo cuando eso esté listo, pagar el programa de Apple y publicar una app con Capacitor que lleve todo el código dentro.

---

## 2. Respuestas a las 11 preguntas

### P1. ¿Permite la arquitectura actual usar Capacitor? ¿Hay algo mejor?

**Sí, Capacitor encaja bien.** Entreno usa HTML, CSS y JS sin framework ni herramienta de compilación. Capacitor solo necesita una carpeta con un `index.html` que tenga etiqueta `<head>`, y Entreno ya la tiene.

- **[Obligatorio]** Capacitor 8 (versión estable 8.5.3, del 7 de octubre de 2026) exige Xcode 26 o posterior, Node 22 o posterior y macOS para compilar para iOS. Admite iOS 15 o posterior y usa Swift Package Manager por defecto.
- **[Obligatorio]** `webDir` debe ser una carpeta con `index.html`.
- **[Recomendado]** No usar la raíz del repositorio como `webDir`, porque metería en la app `tests/`, `docs/` y `test-results/` (304 MB). Es mejor un script de unas 30–40 líneas que copie a `www/` los archivos de la lista `ASSETS` de `sw.js`. Esa lista ya existe y la valida `scripts/check-assets.mjs`. Es una copia de archivos, no una compilación.
- **[Obligatorio en la práctica]** Fijar desde la primera versión el esquema y el nombre de host de la app (por defecto `capacitor://localhost`). Si cambian después, el IndexedDB pasa a otro almacén y los datos parecen perdidos. Hay informes de usuarios en un foro de Ionic sobre esto, pero la fuente no es oficial **[No verificado]**.
- **[Obligatorio]** No usar `server.url` remoto. Capacitor dice que «not intended for use in production».
- **[Recomendado]** Empezar con Swift Package Manager. Capacitor 9, todavía en alfa, pedirá Node 24, Xcode 27 e iOS 16. Además, CocoaPods Trunk pasará a solo lectura el 2 de diciembre de 2026 (fecha anunciada como «expected»).

**Alternativas comparadas:**

| Opción | Encaje | Motivo |
|---|---|---|
| **Capacitor 8** | **Alto** | Lleva los archivos dentro de la app, funciona sin conexión y tiene plugins oficiales para compartir, archivos y ajustes |
| PWABuilder (iOS) | Medio-bajo | Su propia documentación lo llama «Experimental». Carga la web publicada desde su URL, lo que choca con las directrices 4.2 y 2.5.2 |
| Cordova | Medio | Misma idea que Capacitor, pero con menos desarrollo activo. No aporta nada más |
| Tauri 2 móvil | Bajo | También necesita macOS y Xcode, y además Rust, sin ningún beneficio para Entreno |
| Visor web propio en Swift | Medio | No tiene dependencias, pero habría que programar a mano lo que ya hacen los plugins |
| React Native / Flutter | Muy bajo | Habría que reescribir toda la interfaz (unas 47 000 líneas de JS y CSS) |

### P2. ¿Qué parte del código se reutiliza?

Medido en el repositorio con `wc` y `grep`:

| Elemento | Líneas |
|---|---|
| JS (`js/*.js` + `js/views/*.js`) | 41 309 (29 171 + 12 138) |
| CSS (15 archivos) | 5 585 |
| `index.html` / `sw.js` | 92 / 182 |
| **Total de la app** | **46 986** |
| Pruebas (`tests/`) | 39 650 |
| Dependencias de ejecución | 0 |

- **Estimación:** unas 150 líneas que modificar, el 0,3 % del total, más un módulo nuevo `js/platform.js` de unas 200–400 líneas y el proyecto `ios/` que genera Capacitor. Es una estimación, no una medición.
- Las pruebas web siguen siendo válidas. La parte nativa habría que probarla a mano o con pruebas de interfaz de Xcode.
- `charts.js` (1 646 líneas) y todo el CSS usan funciones de navegador disponibles en el visor web de iOS (WKWebView) desde iOS 16.4, según los datos de compatibilidad de MDN 8.1.6.

**Componentes que hay que adaptar:**

| Componente | Qué hacer |
|---|---|
| Service worker (`sw.js`, `registerSW` en `js/app.js:202-240`) | Según MDN, WKWebView no tiene service worker. `app.js:203` ya sale si no existe. **[Recomendado]** Añadir además un indicador explícito para no registrarlo en la app nativa. En la app no hace falta, porque los archivos ya van dentro y las actualizaciones llegan por la App Store |
| Tarjeta «Añadir a pantalla de inicio» (`settings.js:197-222`, `isStandalone` en `ui.js:1469`) | Ocultarla en la app nativa. Unas 30 líneas |
| Gesto atrás (`uaGesture`, `router.js:404`) | Revisarlo. En WKWebView el gesto de volver deslizando está desactivado por defecto **[No verificado]** si Capacitor ofrece una opción para activarlo |
| Compartir y descargar archivos (`ui.js:1413-1445`: copia JSON y CSV) | El plugin Share de iOS acepta rutas `file://`. Se escribe el archivo con Filesystem y luego se comparte. Unas 60 líneas |
| Importación (`pickFile`, `views/import.js:28`) | Debería funcionar porque el formato se reconoce por el contenido (`detectFormat`). **[No verificado]** con .FIT/.ZIP dentro de la app |
| `requestPersist` (`db.js:157-173`) | Mantenerlo, pero sin confiar en que proteja los datos |
| Pantallas de arranque (`apple-touch-startup-image`, `splash/` de 244 KB) | Sustituirlas por la pantalla de arranque nativa de iOS |
| Textos de ayuda («datos del sitio», «Safari y la app instalada…») | Escribir versiones para la app nativa |
| `navigator.vibrate` (`ui.js:1466`) | No hace nada en iOS. Opcionalmente, usar el plugin Haptics |
| Iconos | Generar los nativos desde `icons/icon.svg`. Hoy no hay icono de 1024 px |

**Detección de plataforma sin herramienta de compilación:** la documentación oficial usa `import { Capacitor } from '@capacitor/core'`, que necesita una herramienta de compilación. Usar el objeto global `window.Capacitor?.isNativePlatform?.()` es **[No verificado]**.

### P3. Requisitos de Apple: lo que ya se cumple y lo que falta

Fuente: App Review Guidelines (la página no indica fecha de actualización).

**Directriz 4.2, funcionalidad mínima [Obligatorio].** Su texto exige «features, content, and UI that elevate it beyond a repackaged website… useful, unique, or "app-like"… adequate utility».

- **Contenido: probablemente se cumple.** Entreno registra fuerza y resistencia, analiza en local, hace predicciones, importa GPX/TCX/FIT/ZIP, tiene gráficas, recuperación y funciona sin conexión. Es una herramienta, no una colección de enlaces (4.2.2).
- **Forma: aquí está el riesgo.** Si la app cargara la web de GitHub Pages, sería un «repackaged website». Con todo el código dentro de la app, el funcionamiento sin conexión desde el primer arranque y algunas integraciones nativas útiles (ver P10), el riesgo baja de forma notable.
- **4.2.3 [Obligatorio].** La app debe funcionar sin instalar otra app y avisar si descarga recursos al arrancar. Se cumple si todo va dentro de la app.

**Lo que ya cumple:**

| Requisito | Situación |
|---|---|
| 2.5.2 [Obligatorio]: no descargar código que cambie funciones | Se cumple si el código va dentro de la app. Las actualizaciones en caliente, sea desde GitHub Pages o con `server.url`, quedan descartadas |
| 2.5.6 [Obligatorio]: usar WebKit | Capacitor usa WKWebView |
| 5.1.1(ii)/(iii) [Obligatorio]: minimizar datos y usar el selector y la hoja de compartir del sistema | Se cumple por diseño |
| 5.1.1(v) [Obligatorio]: cuentas | No aplica, porque no hay cuentas. Conviene mantener «borrar todo» |
| 2.1(a) [Obligatorio]: cuenta de demostración | No hace falta sin login. **[Recomendado]** Usar los datos de ejemplo (`js/seed.js`) para que el revisor vea contenido |
| Etiqueta de privacidad [Obligatorio] | Se puede declarar «Datos no recopilados»: Apple dice que «Data that is processed only on device is not "collected"» |

**Lo que falta:**

| Requisito | Situación |
|---|---|
| 5.1.1(i) [Obligatorio]: política de privacidad enlazada en App Store Connect **y dentro de la app**, «in an easily accessible manner» | No hay ningún texto de privacidad en la app |
| URL de soporte con datos de contacto reales [Obligatorio] | Falta |
| Capturas [Obligatorio] | Faltan (detalle en P8) |
| Icono para la tienda [Obligatorio] | Falta. Que deba ser de 1024×1024 sin transparencia es **[No verificado]** en la página consultada |
| Manifiesto de privacidad `PrivacyInfo.xcprivacy` [Obligatorio desde el 1 de mayo de 2024] | Falta. Depende de los plugins que se usen |
| Cuestionario de edad [Obligatorio] | Falta |
| Declaración de cifrado (export compliance) [Obligatorio] | Falta |
| Estado de comerciante según la DSA de la UE [Obligatorio] | Falta |
| Compilar con Xcode 26 y el SDK de iOS 26 [Obligatorio desde el 28 de abril de 2026] | Necesita macOS, propio o en la nube |
| Apple Developer Program [Obligatorio] | 99 USD al año |

**1.4.1 Daño físico [Obligatorio si aplica].** Entreno no mide constantes con sensores, pero estima recuperación, carga y marcas.
- **[Recomendado]** Un aviso visible: «Orientativo. No es consejo médico; consulta a un profesional».
- **[Recomendado]** Explicar los métodos (ya existen `confidence.js` y los textos de confianza).
- **[Recomendado]** No prometer precisión en la ficha de la tienda.

### P4. Cómo se conservan todas las funciones

| Función | En la app iOS |
|---|---|
| Entrenamientos, análisis, gráficos, recuperación | Son JS puro y SVG propio, sin red. Funcionan igual |
| Sin conexión | Más sólido que en la PWA, porque los archivos van dentro de la app y no dependen de la caché del service worker |
| IndexedDB v3 | Se mantiene como almacén principal y `db.js`, `store.js` y las pruebas no cambian. **Riesgo [Obligatorio tenerlo en cuenta]:** la documentación de Capacitor dice que `localStorage` es «transient» y que «the same can be said for IndexedDB at least on iOS». También hubo errores de WebKit en iOS 17.4–17.6 que causaban pérdidas de datos (bugs 273827 y 277615) |
| Protección de datos **[Recomendado]** | Guardar una copia JSON automática (formato 2 de `backup.js`) en la carpeta Documents de la app con el plugin Filesystem. Al arrancar con el IndexedDB vacío, la app ofrecería restaurarla. Con `UIFileSharingEnabled` y `LSSupportsOpeningDocumentsInPlace` en el `Info.plist`, esa carpeta aparece en la app Archivos. No cambia el esquema ni hay migración |
| Importar GPX/TCX/FIT/ZIP | El código de lectura no cambia. Solo cambia cómo se elige el archivo. **[No verificado]** que `<input type=file>` funcione con .FIT/.ZIP dentro de la app. Plan B: un plugin de la comunidad para elegir archivos |
| ZIP y gzip | Necesitan `DecompressionStream`, disponible desde iOS 16.4. **[Recomendado]** Exigir iOS 16.4 como mínimo |
| Exportar JSON y CSV | Filesystem más Share. El formato 2 no cambia, así que una copia de la PWA vale en la app y al revés |
| Recuperación (punto de restauración) | Igual que ahora (`guardRestorePoint`, `recoverRestorePoint`) |
| `persist()` | Se concede según reglas internas de WebKit, como estar instalada en la pantalla de inicio. En WKWebView es **[No verificado]** |
| Copia en iCloud del IndexedDB | **[No verificado]** |

**SQLite descartado por ahora:** migrar a SQLite sería un cambio de arquitectura y no se recomienda en esta fase.

### P5. Traspaso seguro de datos de la PWA a la app

**Hay que dar por hecho que no comparten almacenamiento.** Las razones:
- Cada app de iOS tiene su propio espacio aislado (sandbox).
- La app funciona en `capacitor://localhost`, un origen distinto de `https://alvar1712-blip.github.io`.
- Un ingeniero de WebKit confirmó que las apps de la pantalla de inicio no comparten estado «by design» (bug 181849). Es una declaración en un bug, no documentación formal.
- Que la app nativa no pueda leer el IndexedDB de la PWA es una deducción sólida a partir de lo anterior, pero **[No verificado]** en un documento explícito.

**El traspaso ya existe y es seguro:**
1. En la PWA: Ajustes › Copias y datos › Exportar › «Guardar en Archivos».
2. Instalar la app.
3. En la app: Importar › elegir el `.json`. La validación (`validateBackup`) comprueba la app de origen, el formato, las secciones y los ids.
4. La app muestra el resumen de la copia y pide «Sustituir todo». Antes guarda un punto de restauración, y si no puede guardarlo no toca nada.
5. Comprobar los datos en la app. No borrar la PWA hasta haberlo hecho.

**Ajustes necesarios:**
- **[Obligatorio para que funcione]** Mantener `BACKUP_APP_ID = 'entreno-pwa'` (`js/store.js:13`). Si cambia, la app rechazaría las copias de la PWA.
- **[Recomendado]** Una pantalla de bienvenida en la app: «¿Vienes de la versión web? Importa tu copia». En la PWA, una ayuda «Pasar mis datos a la app».
- **[Recomendado, puede esperar]** Que el `.json` se pueda abrir desde Archivos con «Abrir con… Entreno» (tipos de documento declarados en `Info.plist`). Los detalles son **[No verificado]**.

**Descartado:**
- Pasar los datos por URL o enlaces universales: la copia es demasiado grande y quedaría en registros del sistema.
- Usar un servidor o nube intermedia: exigiría cuentas y sacaría datos de salud del dispositivo, en contra de la filosofía de Entreno.

### P6. ¿Hace falta un Mac?

**macOS es obligatorio, pero no tiene por qué ser un Mac propio.**

- **[Obligatorio]** Para compilar hacen falta Xcode 26 y el SDK de iOS 26. Capacitor lo dice así: «To build iOS apps, you will need macOS». Su propia página menciona la compilación en la nube como alternativa.
- **[Obligatorio]** Para subir la app a Apple se usan Xcode, Transporter o altool, que solo existen para macOS. Los servicios en la nube suben la app desde sus propios Macs.

**Desde Windows o desde el iPhone se puede:**
- Inscribirse en el programa, por la web o con la app Apple Developer.
- Firmar la app y enviarla a TestFlight con **Codemagic**, que genera certificados y perfiles con una clave de la API de App Store Connect. Se apoya en la documentación de Codemagic; no lo he vuelto a comprobar de forma independiente.
- Probar la app en el iPhone con TestFlight.

**Lo que de verdad pide un Mac:** depurar en vivo el visor web con Safari Web Inspector.
- **[Recomendado]** Seguir usando Playwright con WebKit en Linux (`npm run e2e:webkit`, que ya existe).
- **[Recomendado]** Alquilar un Mac por horas solo si aparece un fallo exclusivo de la app nativa.

| Servicio | Gratis | Pago | Nota |
|---|---|---|---|
| **Codemagic** | 500 min/mes en Mac mini M2, 1 compilación a la vez, hasta 120 min cada una | 0,095 USD/min | El más sencillo: firma y TestFlight integrados |
| **GitHub Actions** (macOS) | Gratis en repositorios públicos con ejecutores estándar. `alvar1712-blip/gym` es público | 0,062 USD/min | La firma se configura a mano. Que «estándar» incluya macOS se considera razonablemente confirmado |
| Xcode Cloud | 25 h/mes incluidas en el programa | 100 h por 49,99 USD/mes | **[No verificado]** que pueda configurarse sin Xcode |
| Bitrise | Hobby: 300 créditos/mes | Desde 89 USD/mes | **[No verificado]** cuántos minutos son 300 créditos |
| Ionic Appflow | — | — | Descartado: no admite clientes nuevos desde el 11 de febrero de 2025 |
| MacinCloud | — | **[No verificado]** (unos 1 USD/hora según terceros) | Solo para depuración puntual |

### P7. Costes reales

| Concepto | Coste | Tipo |
|---|---|---|
| Apple Developer Program | **99 USD al año**, «listed in local currency during the enrollment process» | [Obligatorio] |
| Precio en euros | **[No verificado]**. Fuentes no oficiales dicen 99 € | — |
| Exención de la cuota | **No aplica a particulares** («Not be an individual, sole proprietor…») | Oficial |
| Compilación en la nube | 0 € dentro de los planes gratuitos | — |
| Alojar la política de privacidad y el soporte | 0 € en GitHub Pages | [Recomendado] |
| Dispositivo de prueba | 0 € (tu iPhone y TestFlight) | — |
| Mac remoto para depurar | Opcional. Precio **[No verificado]** | — |
| Si dejas de pagar | La app deja de poder descargarse y no puedes enviar actualizaciones. Quien ya la tiene puede seguir usándola. Si renuevas, vuelve en menos de 24 h | Oficial |

**Total realista:** unos 99 USD al año. El resto puede ser 0 €.

### P8. Documentos, políticas y recursos que preparar

| Elemento | Etiqueta | Detalle |
|---|---|---|
| Política de privacidad (URL más enlace dentro de la app) | [Obligatorio] | Debe decir que no se recogen datos, que todo queda en el dispositivo, que no hay terceros, cómo se borran los datos y que la copia JSON la gestiona el usuario |
| URL de soporte con contacto real | [Obligatorio] | Puede ser una página en GitHub Pages |
| Etiquetas de privacidad | [Obligatorio] | «Datos no recopilados» |
| Manifiesto de privacidad y motivos de uso de APIs | [Obligatorio] | Filesystem y Preferences «may necessitate» declarar motivos (por ejemplo `CA92.1` para UserDefaults). Si `localStorage` o IndexedDB cuentan como API con motivo obligatorio es **[No verificado]**. Hay que revisarlo con la lista oficial al compilar |
| Cuestionario de edad | [Obligatorio] | «Health or Wellness Topics» incluye expresamente «exercise recommendations» y lleva a 9+. Lo probable es que Entreno quede en **9+** |
| Capturas | [Obligatorio] | Al menos una de «iPhone with Dynamic Island (medium)» (1179×2556 o 1206×2622) **y**, en la práctica, una del grupo grande (Dynamic Island grande, 1320×2868, o Face ID grande). Si la app se ofrece para iPad, también iPad 13" (2064×2752 o 2048×2732). Entre 1 y 10 por tamaño, en JPG o PNG sin transparencia, mostrando la app en uso |
| Icono | [Obligatorio] | Dentro de la app. Generarlo desde `icons/icon.svg` |
| Nombre (2–30 caracteres), subtítulo (≤30), descripción (≤4000), palabras clave (≤100 bytes), copyright, contacto del revisor con teléfono +34 | [Obligatorio] | — |
| Declaración de cifrado | [Obligatorio] | Responder en App Store Connect o con `ITSAppUsesNonExemptEncryption`. Que a Entreno le corresponda `false` es **[No verificado]**. La responsabilidad es del desarrollador |
| DSA de la UE (estado de comerciante) | [Obligatorio] | Todos los desarrolladores deben declararlo, aunque la app sea gratuita. Las apps sin declaración se retiran de la UE desde el 17 de febrero de 2025. Apple orienta que «if you're a hobbyist… with no intention of commercializing it, you may not be considered a trader», pero es una orientación prudente, no una exención. Como **no comerciante** no se publican datos de contacto y se avisa a los usuarios de la UE de que no se aplican sus derechos de consumidor. Como **comerciante** se publican dirección (vale apartado de correos), teléfono y email. **[Recomendado]** Una consulta legal breve si hay dudas |
| RGPD | [No verificado en detalle] | Si todo se trata en el dispositivo, el desarrollador no trata datos personales. La política debe decirlo |
| Aviso de salud | [Recomendado] | «No es un producto sanitario» |
| Inscripción como particular | [Obligatorio] | Tu nombre legal aparece como vendedor. No se aceptan apartados de correos al inscribirse |

### P9. Actualizaciones futuras y una sola base de código

**Una sola base de código es viable.** La web sigue siendo la fuente única y la app es una copia empaquetada.

**Trabajo recurrente:**
- **[Obligatorio]** Apple revisa cada versión. Suele resolver el 50 % en menos de 24 h y el 90 % en menos de 48 h. La PWA se sigue actualizando al instante.
- **[Obligatorio]** En cada actualización, describir los cambios «with specificity» (2.3.1(a)).
- **[Obligatorio]** Al menos una recompilación al año con el Xcode o SDK que exija Apple (por ejemplo, Xcode 26 desde abril de 2026), aunque la web no cambie.
- **[Obligatorio]** Renovar la cuota cada año. Mantener al día el manifiesto de privacidad y el cuestionario de edad.
- **[Recomendado]** Actualizar Capacitor una vez al año (la versión 9 ya está anunciada).

**Flujo por versión [Recomendado]:**
1. Pruebas unitarias y E2E, incluido WebKit.
2. Publicar la PWA en GitHub Pages.
3. Copiar a `www/` y ejecutar `npx cap sync ios`.
4. Compilar en la nube y enviar a TestFlight.
5. Probar en el iPhone.
6. Enviar a revisión.

**Más recomendaciones:**
- **[Recomendado]** Agrupar los cambios de la app en versiones mensuales o trimestrales.
- **[Recomendado]** Usar el mismo número de versión en la PWA y en la app, y mantener el formato de copia compartido.

**Esfuerzo orientativo, no medido:**
- Montaje inicial de compilación en la nube, firma y TestFlight: 1–2 días.
- Cada versión: unos 30–60 minutos extra, más la espera de la revisión.
- Cada año: actualizar Xcode, el SDK y Capacitor, y revisar las declaraciones.

### P10. Riesgos de rechazo y cómo reducirlos sin funciones artificiales

| Riesgo | Mitigación |
|---|---|
| **4.2: «web reempaquetada»** | **[Obligatorio en la práctica]** Todo el código dentro de la app y nunca cargar `github.io`. Debe funcionar en modo avión desde el primer arranque. **[Recomendado]** Integraciones nativas que resuelven necesidades reales: (1) hoja de compartir nativa para copias e informes; (2) importar desde Archivos y «Abrir con…» para .gpx/.tcx/.fit/.zip/.json; (3) copia automática en Archivos; (4) notificaciones **locales** opcionales para el recordatorio de copia que ya existe, sin servidor (4.5.4); (5) vibración nativa. HealthKit solo si aporta algo de verdad, más adelante y cumpliendo 2.5.1, 5.1.2(vi) y 5.1.3 |
| **2.5.2: código remoto** | No usar actualizaciones en caliente ni `server.url`. Hasta dónde tolera Apple las actualizaciones en caliente es **[No verificado]**: mejor no usarlas |
| **2.1 y 4.0: estabilidad** | Validar en un dispositivo real antes de enviar: la persistencia del IndexedDB, compartir archivos, elegir archivos, el gesto atrás y que no haya enlaces que saquen al navegador ni barras de URL |
| **1.4.1: salud** | Aviso visible y explicación de los métodos |
| **4.3(b): spam** | Riesgo bajo o medio. Los registros de entrenamiento no aparecen en la lista de categorías saturadas. Lo diferencial es el análisis local y la privacidad |
| **5.1.3: datos de salud en iCloud** | No plantear copias automáticas en iCloud. Cómo valora App Review la copia que el usuario guarda por su cuenta en Archivos es **[No verificado]** |
| **4.1 y 5.2: nombre** | Ver P11 |
| **Revisión inicial** | **[Recomendado]** En las notas para el revisor: «funciona en local, sin cuentas ni servidor», las funciones clave y un GPX de ejemplo |
| **2.4.1: iPad** | **[Recomendado]** Ofrecerla para iPad solo si se pueden preparar las capturas de iPad |

**Nota sobre el service worker:** que dentro de WKWebView solo funcione con App-Bound Domains se apoya en fuentes no oficiales (bug 227589, foros de Apple sin respuesta oficial). Lo que sí está confirmado:
- WKWebView no tiene service worker según MDN.
- App-Bound Domains admite como máximo 10 dominios y bloquea la inyección de JS que usan los plugins.

La conclusión práctica, no usar el service worker en la app, está bien fundada.

### P11. El nombre «Entreno»

- **Confirmado:** la app Workout de Apple se llama **«Entreno»** en la App Store española (id 1584215851, vendedor Apple Distribution International, categoría Salud y forma física). La ayuda oficial de Apple la llama «la app Entreno».
- **[Obligatorio]** «You can use an app name for one app per localization». Si App Store Connect bloquea también los nombres de las apps de Apple es **[No verificado]**. Solo se sabe al crear la ficha, lo que exige la cuenta de pago.
- **[Obligatorio]** Las directrices 2.3.7, 4.1(c) y 5.2.1 piden nombre único y sin imitar a otros. Coincidir con una app de Apple de la misma categoría aumenta el riesgo de rechazo.
- **Otras apps:** hay apps como «Entreno ONCE», «ENTRENO10» y «Entreno y Como», y muchas usan «entreno» como palabra genérica. La búsqueda devuelve 175 resultados en España.
- **Dominios:** `entreno.com` y `entreno.app` están registrados. `entreno.app` caduca el 20 de noviembre de 2026; que lo use una plataforma para entrenadores **[No verificado]**. El estado de `entreno.es` es **[No verificado]**.
- **Marcas registradas (EUIPO, OEPM, USPTO): [No verificado].** Hay que comprobarlo a mano en las clases 9, 41 y 42, incluidas variantes como «ENTRENA» o «ENTRENOS». «Entreno» es una palabra común y como marca sería probablemente débil. Es una valoración, no asesoramiento jurídico.
- **Recomendación:**
  - **[Recomendado]** Mantener «Entreno» en la PWA, que no pasa por Apple.
  - **[Recomendado]** Para la tienda, un nombre propio distintivo y la descripción en el subtítulo. Por ejemplo: «[Nombre]: diario de entreno», con un subtítulo como «Fuerza, carrera y datos offline».
  - **[Recomendado]** Mantener coherente el nombre que aparece bajo el icono.
  - Que la tienda acepte un nombre no da derechos de marca.

---

## 3. Tres escenarios

| | **A. Solo PWA** | **B. App iOS con Capacitor** | **C. Nativa desde cero (comparación)** |
|---|---|---|---|
| **Dificultad** | Ninguna adicional | Media-baja en código (unas 150 líneas que cambiar y 200–400 nuevas) y media en trámites | Muy alta: reescribir unas 47 000 líneas de interfaz, la lógica y los gráficos |
| **Coste inicial** | 0 € | 99 USD (cuota) + 0 € de compilación en la nube + 1–2 días de montaje + preparar documentos y capturas | 99 USD + Mac casi imprescindible para desarrollar a diario (precio no investigado) + meses de trabajo **[No verificado]** |
| **Coste anual** | 0 € | 99 USD + recompilación anual + actualización de Capacitor | 99 USD + mantener dos bases de código |
| **Riesgos** | iOS puede borrar los datos si la app no está instalada en la pantalla de inicio; poca visibilidad; dependes de cómo Safari trate las PWA | Rechazo por 4.2 si parece web reempaquetada (mitigable); borrado del IndexedDB en WKWebView (se mitiga con la copia automática en Archivos); nombre; DSA | Errores nuevos al reescribir; perder funciones y pruebas que ya existen; abandono por exceso de trabajo |
| **Mantenimiento** | El actual. Publicar es inmediato | Una base de código; 30–60 min extra y 1–2 días de revisión por versión | Dos bases de código separadas (web y Swift), o abandonar la PWA |
| **Ventajas reales para el usuario** | Gratis, sin intermediarios, actualizaciones al instante, sin tienda | Descarga desde la App Store (más fácil de encontrar y más confianza), icono y arranque nativos, archivos dentro de la app, «Abrir con…» para GPX/FIT, compartir nativo, notificaciones locales opcionales | Algo más de integración nativa (HealthKit, widgets) y rendimiento, que Entreno no necesita para lo que hace hoy |

**A. Solo PWA.** Es la opción más sencilla y fiel a la filosofía de Entreno. No cuesta nada y no depende de Apple. Su límite es la difusión: otras personas no la encuentran en la tienda, y la instalación con «Añadir a pantalla de inicio» no resulta intuitiva para mucha gente. La protección de los datos depende de la copia JSON.

**B. App iOS con Capacitor.** Mantiene más del 99 % del código y una sola base. El coste real es la cuota anual y el trámite de cada versión. Bien hecha (código dentro de la app, integraciones nativas útiles, sin servidor ni cuentas), es la forma más razonable de llegar a otras personas sin cambiar lo que Entreno es. Exige resolver antes el nombre, la política de privacidad y la copia automática.

**C. Nativa desde cero.** Solo sirve como comparación. Tiraría a la basura casi 47 000 líneas probadas y 39 650 líneas de pruebas a cambio de ventajas que hoy Entreno no necesita. No se recomienda.

---

## 4. Recomendación

**Escenario B, por fases, sin prisa y empezando por lo gratuito.**

1. Mantener la PWA como producto principal y fuente única del código.
2. Preparar sin pagar todo lo que se pueda: nombre, política de privacidad, aviso de salud, separación del código específico de plataforma y compilación en la nube para el simulador.
3. Pagar el Apple Developer Program solo cuando todo eso esté listo, para que la cuota se dedique a probar en TestFlight y publicar, no a esperar.
4. Arquitectura de la app:
   - Capacitor 8 con todo el código dentro de la app.
   - Esquema y host fijos desde la versión 1.
   - Service worker desactivado en la app nativa.
   - IndexedDB v3 sin cambios, más una copia JSON automática en Archivos.
   - Traspaso desde la PWA con la copia JSON actual.
   - Nada de cuentas, servidores ni actualizaciones en caliente.
5. No usar el nombre «Entreno» a secas en la tienda.

---

## 5. Roadmap por fases

### Fase 0: decisiones y documentos (gratis, sin Mac ni dispositivo nuevo)
- Comprobar a mano las marcas (EUIPO, TMview, OEPM, USPTO; clases 9, 41 y 42), el dominio `entreno.es` y la búsqueda de iTunes en ES, MX, US y AR. Elegir el nombre para la tienda.
- Redactar la **política de privacidad** y la **página de soporte** y publicarlas en GitHub Pages.
- Preparar los textos del aviso de salud y de la explicación de métodos.
- Decidir el estado DSA (comerciante o no), con consulta legal si hay dudas.
- Redactar la descripción, el subtítulo, las palabras clave y las notas para el revisor.
- *(Esto puede llegar también a la PWA: enlace a la privacidad en Ajustes y aviso de salud. Son cambios de contenido, no de arquitectura, y requieren tu aprobación.)*

### Fase 1: preparación técnica (gratis, sin Mac, sin pagar a Apple)
*Solo después de revisar este informe y en una rama separada.*
- `js/platform.js`: detectar la plataforma nativa (**[No verificado]** el uso de `window.Capacitor`), no registrar el service worker, ocultar la tarjeta de instalación y revisar el gesto atrás.
- Una sola función `shareFile` con dos implementaciones (web y Filesystem + Share).
- Copia JSON automática en Archivos y oferta de restauración al arrancar (solo en la app nativa).
- Script que copie `ASSETS` a `www/`. Proyecto `ios/` con Capacitor 8 y Swift Package Manager, iOS 16.4 como mínimo, esquema y host fijados.
- Compilación en GitHub Actions macOS (gratis en repositorio público) para el **simulador**, sin firmar. Capturas desde el simulador. **[No verificado]** que todo el flujo funcione sin firma de pago; es lo habitual para el simulador.
- Pruebas de la PWA con Playwright y WebKit. La PWA sigue funcionando igual.

### Fase 2: pruebas en tu iPhone (aquí se **paga**: 99 USD al año)
- Inscribirse en el Apple Developer Program, por la web o con la app Apple Developer.
- Crear la ficha en App Store Connect: es el momento en que se sabe con certeza si el nombre está disponible.
- Configurar Codemagic Free (firma automática y TestFlight) o GitHub Actions con fastlane.
- Instalar con **TestFlight en tu iPhone** y validar los puntos pendientes:
  - importar .FIT/.ZIP/.json desde Archivos;
  - compartir y exportar;
  - persistencia del IndexedDB tras días de uso y con poco espacio;
  - restauración desde la copia automática;
  - gesto atrás;
  - modo avión desde el primer arranque;
  - traspaso completo PWA → app con una copia real.
- **Mac:** solo si aparece un fallo que no se reproduce en WebKit de Linux. En ese caso, alquilar uno por horas para usar Safari Web Inspector (activando `isInspectable`).
- *Alternativa gratuita limitada:* la cuenta gratuita permite instalar en tu propio iPhone con perfiles que caducan a los 7 días, pero exige Xcode en un Mac. No incluye TestFlight (lo da a entender Apple, sin confirmarlo explícitamente).

### Fase 3: envío a revisión (cuenta de pago activa)
- Etiquetas de privacidad («Datos no recopilados»), manifiesto de privacidad, cuestionario de edad (probablemente 9+), declaración de cifrado y estado DSA.
- Icono y capturas: tamaño medio y grande con Dynamic Island, más iPad si se ofrece.
- Notas para el revisor con un GPX de ejemplo y los datos de ejemplo.
- Enviar y responder a posibles rechazos con cambios reales, no con funciones artificiales.

### Fase 4: mantenimiento
- Versiones agrupadas cada mes o cada trimestre. La PWA sigue al instante.
- Cada año: renovar la cuota, recompilar con el Xcode o SDK exigido, actualizar Capacitor y revisar las declaraciones.
- Más adelante, si aporta de verdad: «Abrir con…» para la copia `.json`, notificaciones locales de copia y HealthKit.

---

## 6. Fuentes

Todas consultadas el **19 de octubre de 2026**.

**Apple**
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/programs/enroll/
- https://developer.apple.com/help/account/membership/program-enrollment
- https://developer.apple.com/help/account/membership/fee-waivers
- https://developer.apple.com/help/account/membership/renewal
- https://developer.apple.com/support/compare-memberships/
- https://developer.apple.com/app-store/app-privacy-details/
- https://developer.apple.com/distribute/app-review/
- https://developer.apple.com/xcode-cloud/
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon
- https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating
- https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance
- https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
- https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds
- https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api (solo cargó el título)
- https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledocumenttypes (lectura parcial)
- https://developer.apple.com/documentation/webkit/wkwebsitedatastore/default()
- https://www.apple.com/legal/internet-services/itunes/appnamenotices/
- https://apps.apple.com/es/app/entreno/id1584215851 y la API de búsqueda de iTunes (id 1584215851, `country=es` y `country=us`)
- https://support.apple.com/es-es/guide/watch/apdd16e8761a/26/watchos/26

**Capacitor**
- https://capacitorjs.com/docs/getting-started
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/ios
- https://capacitorjs.com/docs/config
- https://capacitorjs.com/docs/guides/storage
- https://capacitorjs.com/docs/apis/share
- https://capacitorjs.com/docs/apis/filesystem
- https://capacitorjs.com/docs/ios/privacy-manifest
- https://capacitorjs.com/docs/basics/workflow
- https://capacitorjs.com/docs/core-apis/web
- https://capacitorjs.com/docs/next/updating/9-0
- registry.npmjs.org: @capacitor/core, @capacitor/ios, @capacitor/share, @capacitor/filesystem, @capacitor/preferences, @capawesome/capacitor-file-picker, @capacitor-community/sqlite, cordova-ios

**WebKit y MDN**
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://webkit.org/blog/10882/app-bound-domains/
- https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/
- https://bugs.webkit.org/show_bug.cgi?id=181849
- https://bugs.webkit.org/show_bug.cgi?id=273827
- https://bugs.webkit.org/show_bug.cgi?id=277615
- https://trac.webkit.org/r168180
- MDN Browser Compat Data 8.1.6: https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data@8.1.6/data.json

**Compilación en la nube y alternativas**
- https://docs.codemagic.io/yaml-code-signing/signing-ios/
- https://docs.codemagic.io/yaml-quick-start/building-an-ionic-app/
- https://codemagic.io/pricing/
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/billing/reference/actions-runner-pricing
- https://github.com/actions/runner-images
- https://bitrise.io/pricing
- https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products
- https://v2.tauri.app/start/prerequisites/
- https://raw.githubusercontent.com/pwa-builder/pwabuilder/main/docs/builder/app-store.md

**Marcas y dominios**
- RDAP para entreno.com y entreno.app
- Buscadores que hay que consultar a mano: https://euipo.europa.eu/eSearch/, https://www.tmdn.org/tmview/, https://consultas2.oepm.es/, https://tmsearch.uspto.gov/

**No oficiales (solo contexto, marcadas [No verificado] en el texto)**
- https://bugs.webkit.org/show_bug.cgi?id=227589
- https://bugs.webkit.org/show_bug.cgi?id=206741
- https://developer.apple.com/forums/thread/748795
- https://developer.apple.com/forums/thread/770366
- https://developer.apple.com/forums/thread/652821
- https://developer.apple.com/forums/thread/712189
- https://www.inappwebview.dev/docs/service-worker
- https://forum.ionicframework.com/t/ionic-storage-data-gets-deleted-after-capacitor-migration-and-upgrades/234989
- https://capawesome.io/alternatives/ionic-appflow/
- https://www.greenmini.nl/compare/macincloud-alternative/
- https://gamefromscratch.com/pay-as-you-go-macintosh-development-a-macincloud-com-review/
- https://gitlab.com/inkscape/inbox/-/issues/2606
- https://www.cultofmac.com/?p=307697