# Ronda de pulido premium

Una ronda de calidad, no de funciones nuevas: el mismo producto, más claro, más coherente y más robusto. Este
documento recoge las reglas que deja la ronda (para que las pantallas nuevas las sigan) y cómo se vigilan.

## 1. Escala tipográfica (css/app.css `:root`)

| Token | Tamaño | Uso |
|---|---|---|
| `--fs-xs` | 12 px | etiquetas en mayúsculas, insignias pequeñas, sufijos de unidad (`kg`) |
| `--fs-sm` | 13 px | notas, subtítulos de fila, insignias |
| `--fs-md` | 15 px | texto secundario de tarjetas y filas |
| `--fs-body` | 17 px | cuerpo (el de iOS) |
| `--fs-title` | 20 px | títulos de bloque |
| `--fs-display` | 28 px | cifras protagonistas |

- **12 px es el mínimo** dentro de las pantallas. La única excepción es la etiqueta de la barra de pestañas
  (11 px, como en iOS).
- Nada de medios píxeles (12,5 / 13,5 / 14,5 px): se llevan al escalón más cercano.
- Cifra con unidad en una casilla (KPI): la cifra grande y la unidad pequeña (`.kpi-unit`), con el mismo texto.
- Nombres largos en listas (rutinas, carreras): hasta dos líneas (`.list-item-title.lines-2`) antes de recortar.

## 2. Objetivos táctiles

- 44 px de alto como mínimo para cualquier botón, enlace o campo, también los compactos (`.btn-sm`).
- Las zonas del mapa corporal son regiones de un dibujo (SVG) y se tocan por su área: no cuentan.

## 3. Nodos del DOM

`h()` (ui.js) se salta los hijos `null`/`false`, pero **`Element.append`, `prepend` y `replaceChildren` nativos
no**: escriben el texto «null». Con hijos condicionales se filtra antes:
`el.append(...[a, cond ? b : null, c].filter(Boolean))`.

## 4. Guardas visuales (tests/e2e/visual-guard.test.cjs)

Recorre todas las pantallas con datos realistas (tests/e2e/realistic-data.cjs: 6 meses de fuerza, carrera, bici,
peso, ciclo, objetivos, contexto, un evento y una sesión a medias; datos sintéticos, nada personal) a 375 y 430 px,
y la app vacía a 375 px, en Chromium y en WebKit. Comprueba invariantes que no dependen de píxeles:

- ningún texto roto («null», «undefined», NaN, Infinity, «[object …]», «:-5», ritmos «h:mm:ss /km»);
- sin scroll horizontal ni nada que se salga por un lado (salvo dentro de un carrusel);
- la cabecera no tapa el principio y lo último queda por encima de la barra de pestañas;
- ningún texto de menos de 12 px y ningún objetivo táctil de menos de 44 px;
- ningún error en la consola.

Deja una captura de cada pantalla en `test-results/visual/` para revisarlas a ojo (no se comparan píxel a píxel:
una comparación así se rompe con cualquier cambio de fuente o de antialiasing y acaba ignorándose).
