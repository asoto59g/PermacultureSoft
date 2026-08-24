# Manual de uso

Guía práctica de PermacultureSoft. Para instalación y arquitectura, ver el
[README](../README.md).

**Abrir la aplicación.** Doble clic en el acceso *PermacultureSoft* del
escritorio (o, en la carpeta del proyecto, `PermacultureSoft.vbs` en
Windows, `PermacultureSoft.desktop` en Linux, `PermacultureSoft.command` en
macOS). No hace falta terminal. Deja abierta la ventana pequeña de control
mientras trabajas; al terminar, pulsa *Detener y salir*. Si es la primera
vez en ese equipo, ejecuta antes el instalador (`scripts\Instalar.cmd`,
`scripts/install.sh` o `scripts/Instalar.command`): al terminar abre la
aplicación sola. Detalle, archivos y solución de problemas: [lanzador de
escritorio](LANZADOR.md) (parte 1 del video). Recorrido visual de diseño y
parte 2 del guion: [flujo de trabajo](WORKFLOW.md).

---

## 1. Antes de empezar: el DEM

Todo el análisis parte del modelo digital de elevación. La calidad del
resultado no supera la del DEM que se cargue.

**Formato.** GeoTIFF (`.tif` / `.tiff`), una banda, con sistema de coordenadas
definido. Se acepta lon/lat (EPSG:4326), pero conviene un sistema **proyectado
en metros**: CRTM05 (EPSG:5367) en Costa Rica, o el huso UTM que corresponda.
En grados, el tamaño de celda no es uniforme y las pendientes salen sesgadas.

**Resolución.** Entre 1 y 10 m por celda es el rango útil para diseño de finca.
Con celdas más gruesas se pierden las vaguadas que definen keylines y sitios de
embalse; con celdas mucho más finas el ruido del levantamiento empieza a dominar
las pendientes.

**Sin dato.** Si el ráster trae `nodata`, se respeta: el polígono envolvente
sigue el borde real de las celdas con dato, no el rectángulo del archivo.

**Tamaño.** Un DEM de una finca de 200 ha a 5 m son unos 5 MB y procesa en
segundos. Rásters de varios cientos de MB harán lento cada análisis; conviene
recortarlos al área de interés antes de cargarlos.

---

## 2. La interfaz

La pantalla tiene cuatro zonas:

- **Panel izquierdo.** Carga del DEM, parámetros de keyline, tubería y camino,
  guardado del proyecto, y el botón *Clima del sitio*. Abajo, el árbol de capas
  con las dos pestañas: **LAYERS** (capas del proyecto, agrupadas por los diez
  niveles de la Escala de Permanencia) y **SURFACES** (parámetros de análisis).
- **Barra superior del mapa.** Las herramientas. Las que necesitan DEM aparecen
  desactivadas hasta que se cargue uno.
- **Panel derecho.** Análisis de superficies: mapas derivados, presión por
  gravedad, aptitud de embalse, sombra solar y aptitud de edificación.
- **Barra inferior.** Coordenadas, cota bajo el cursor, zoom y mensajes de
  estado. El mensaje de estado indica qué espera la herramienta activa.

El fondo cartográfico se cambia con **Calles / Oscuro / Satélite / Topo**. La
casilla *Hillshade / terrain* añade relieve sombreado global, útil para ubicarse
antes de cargar el DEM propio.

---

## 3. Flujo de trabajo

El orden sigue la Escala de Permanencia: se decide primero lo que no se puede
mover después. Cada nivel condiciona al siguiente.

### 3.1 · Clima

Se puede consultar antes de tener DEM; en ese caso usa el centro del mapa.

Pulsa **Clima del sitio**. El panel se abre en la parte inferior con:

- **Seis variables:** Temperatura, Lluvia, Evapotranspiración ET0, Radiación,
  Humedad relativa y Balance P − ET0.
- **Tres resoluciones:** Diaria, Mensual y Anual.
- **Normal de 5, 10, 20 o 30 años**, en el selector de la esquina.

En resolución **diaria** se superponen la normal del período y el año en curso;
la casilla *Suavizar 7 días* aplica media móvil para que se lea la tendencia y
no el ruido. En temperatura se dibuja además la banda mínima–máxima.

En **mensual** se comparan la normal y el año en curso mes a mes. Es la vista
que responde la pregunta de diseño más frecuente: cuántos meses secos hay y qué
tan profundos son.

En **anual** cada barra es un año y la línea punteada la normal del período.
Sirve para ver la variabilidad interanual, que es lo que determina el volumen
de almacenamiento necesario, no el promedio.

Debajo del gráfico van seis tarjetas de resumen y, **desplazando el panel hacia
abajo**, el pronóstico de 10 días de ECMWF con una tarjeta por día. Al final, la
lista de fuentes con el estado de cada una.

**Cómo leer el balance P − ET0.** Positivo significa que la lluvia supera la
demanda evaporativa de referencia y hay excedente para infiltrar o almacenar;
negativo, que el cultivo depende de reserva del suelo o de riego. El acumulado
mensual de los meses negativos es una primera estimación del déficit a cubrir.

**Origen de la lluvia.** Si hay un DEM cargado, la insignia junto al nombre del
sitio dice *Lluvia CHIRPS · por área*: la lluvia es el promedio de CHIRPS sobre
el polígono del DEM. Sin DEM dice *Lluvia ERA5 · puntual* y el dato viene de una
celda de reanálisis de 11 a 28 km, que en terreno montañoso puede desviarse
mucho. La primera consulta con polígono tarda cerca de 30 segundos; las
siguientes son inmediatas.

CHIRPS va unas tres semanas por detrás del presente. El panel indica hasta qué
fecha llega; después de ella la serie del año en curso usa ERA5 y el pronóstico.

### 3.2 · Geografía

**Cargar el DEM.** Ajusta *Intervalo curvas* (0.25, 0.50, 0.75 m y luego de 1
a 10 m) y pulsa **Importar**. Si el DEM ya está cargado, mover el deslizador
regenera las curvas sin volver a subir el archivo. Al terminar aparecen tres
capas bajo `2-GEOGRAPHY`: la superficie del DEM, el **límite del DEM** (el
polígono envolvente, en cian) y las curvas de nivel. La cámara se centra sola
en la finca. En intervalos sub-métricos las curvas enteras se dibujan más
gruesas y las intermedias más finas. Si el desnivel del DEM no cabe en el
techo de curvas, la barra de estado avisa el intervalo realmente dibujado.

El polígono envolvente no es decorativo: es el área sobre la que se promedia la
lluvia de CHIRPS. Al pasar el cursor por encima informa la superficie en
hectáreas y si sigue las celdas con dato o el rectángulo del ráster.

**Mapas derivados.** En el panel derecho, sección *Maps*:

| Mapa | Qué muestra | Para qué sirve |
| --- | --- | --- |
| Slope | Pendiente en porcentaje | Decidir qué es cultivable, mecanizable o forestal |
| Aspect | Orientación de la ladera | Exposición solar y al viento |
| Hillshade | Relieve sombreado | Lectura visual de la forma del terreno |
| Elevation | Cota clasificada | Zonificación altitudinal |
| Drainage | Acumulación de flujo | Dónde se concentra el agua: cauces y líneas de escorrentía |
| Wetness | Índice topográfico de humedad | Zonas que retienen humedad, candidatas a suelos profundos o a encharcamiento |

Dos parámetros afectan a todos:

- **Resample** (50 % por defecto). Reduce la resolución de trabajo. Bajarlo
  acelera mucho el cálculo a costa de detalle; útil para explorar y luego subir
  al 100 % para el resultado final.
- **Gaussian**. Suavizado previo. Con DEM de dron o LiDAR ruidoso, un valor de
  1 a 2 evita que la pendiente salga moteada. Con DEM limpio, déjalo en 0.

**Medir.** La herramienta *Medir* traza una polilínea y devuelve su longitud;
*Polígono* devuelve el área. Click en cada vértice, Enter o doble click para
cerrar.

La cota bajo el cursor aparece de forma continua en la barra inferior.

### 3.3 · Agua

**Cuenca.** Herramienta *Cuenca*, luego click en el punto de aforo. Delinea el
área que drena hacia ese punto y reporta su superficie. Colocar el aforo sobre
un cauce del mapa de *Drainage* da resultados coherentes; colocarlo en una
ladera devuelve una cuenca diminuta.

**Aptitud de embalse.** Sección *Dam Suitability* del panel derecho. Dos
parámetros:

- *Slope threshold* (8 % por defecto): pendiente máxima del vaso. Más alto
  admite sitios más inclinados, que requieren presas más altas para el mismo
  volumen.
- *Smallest basin* (8 ha): área de captación mínima para considerar un sitio.
  Súbelo si aparecen demasiados candidatos irrelevantes.

Pulsa **Rebuild**. El resultado clasifica el terreno por aptitud y reporta la
superficie de cada clase.

**Presión por gravedad.** Herramienta *Presión*, luego click en la ubicación del
tanque o la fuente. Genera un campo que muestra, para cada punto de la finca, la
presión disponible por diferencia de cota. Es la forma rápida de saber si un
punto de riego se alcanza por gravedad o hace falta bombeo. Para mover la
fuente, vuelve a hacer click, o usa *Mover la fuente / Rebuild*.

Regla práctica: 10 metros de desnivel equivalen a 1 bar antes de pérdidas.

**Tubería.** Selecciona diámetro nominal (*DN mm*, de 32 a 200) y *Caudal de
diseño* en litros por segundo. Activa la herramienta *Tubería* y haz click en
cada vértice del trazo; Enter o doble click para cerrar.

Devuelve longitud, presión de trabajo, velocidad, pérdida de carga por
Hazen-Williams y una lista de cantidades con precios de referencia.

Qué vigilar: velocidad por encima de 2 m/s produce golpe de ariete y desgaste, y
por debajo de 0,5 m/s deja sedimentar. Si la pérdida de carga se come la presión
disponible, sube un diámetro antes que aceptar el resultado.

### 3.4 · Acceso

Fija *Pendiente máx.* (12 % por defecto, máximo 45) y *Ancho de calzada*
(4 m por defecto) en el panel izquierdo o en el derecho, sección *Acceso*.
**Trazar camino** (derecha) o la herramienta **Camino** de la barra: click en el
origen y el destino —o en varios puntos intermedios si quieres forzar el paso
por un lugar— y pulsa Enter.

**Caminos entre sitios** (panel derecho) sugiere rutas de menor costo desde el
sitio candidato #1 hacia los demás (hasta cinco). Hay que haber pulsado antes
*Buscar sitios*.

El algoritmo busca la ruta de menor costo entre esos puntos: penaliza la
pendiente de forma cuadrática, castiga con fuerza los tramos que exceden la
pendiente máxima y encarece el cruce de cauces. El resultado incluye longitud en
planta y real, pendiente media y máxima, **metros que quedan fuera de norma**,
movimiento de tierra, número de alcantarillas y presupuesto.

Los puntos sobre el trazo son las alcantarillas propuestas, en los cruces de
cauce detectados.

Dos advertencias. La pendiente se reporta sobre un perfil remuestreado cada
20 m, porque celda a celda lo que se mide es ruido del DEM. Y el trazo es una
alineación preliminar, no un diseño geométrico vial: no resuelve curvas
verticales, peralte ni radios mínimos.

### 3.5 · Ecosistemas · Keyline

El keyline es prefactibilidad de trazado, no diseño de obra. Sirve para comparar
alternativas sobre el DEM y llevar a campo los tramos que el semáforo deja en
verde o ámbar. Antes de trazarlo activa el mapa *Drainage*: el *keypoint* es el
quiebre de la vaguada, no un punto cualquiera de la ladera.

En el panel izquierdo, bloque **Keyline**, elige el modo y los controles. En la
barra superior pulsa la herramienta **Keyline**. El intervalo de *curvas* (arriba
del mismo panel) también cuenta: el modo *Madre* busca entre esas curvas.

#### Cómo se traza

| Modo | Para qué | Controles | Cómo se clica |
| --- | --- | --- | --- |
| **Contorno 1:n** | Conducir agua al estilo Yeomans: de la vaguada al lomo, con pendiente que corra y no erosione | *Caída* 1:200 a 1:800 (1:400 por defecto; 1:400–1:1000 es el rango habitual de campo) | Primer clic en el keypoint, segundo en el rumbo de cultivo |
| **Offset** | Patrón de cultivo paralelo a una guía. No conduce agua | *Offset* 2–50 m; *Líneas* 2–12 por lado | Dos clics: origen y rumbo de la guía |
| **Madre** | Un clic: elige la mejor curva cerca de esa cota y lanza offsets a ambos lados (lógica tipo plugin Basdonax) | *Espaciamiento* 2–50 m; *Líneas* por lado; *Intervalo curvas* más fino (0,50 m) da más candidatas | Un clic cerca del keypoint o de la cota de referencia |

*Líneas* es el número de keylines a cada lado de la guía (offset y madre) o el
número de paseos en contorno 1:n. *Replanteo* (5–25 m, 10 m por defecto) marca
puntos blancos sobre cada tramo, con cadena y cota del DEM.

Tras generar, la barra de estado resume: cuántos tramos *aceptar / revisar /
ajustar / rediseñar*, cuántos cortes en drenaje y cuántos puntos de replanteo.

#### Cómo se lee el resultado

Cada tramo recibe un **ICL** (índice de calidad de línea, mismos umbrales que el
plugin Basdonax *Keyline from DEM*): pendiente longitudinal máxima, radio
mínimo, longitud y clase hidrológica. El color es el semáforo:

| Color | Estado | ICL | Qué hacer |
| --- | --- | --- | --- |
| Verde | ACEPTAR | ≥ 85 | Candidato a llevar a campo |
| Ámbar | REVISAR | 70–84 | Mirar el motivo en el cursor; suele bastar un ajuste de rumbo o caída |
| Naranja | AJUSTAR | 55–69 | Pendiente, radio o cruce de agua fuera de rango; redibuja o acorta |
| Rojo | REDISENAR | menor de 55 | No usar ese tramo; cambia modo, keypoint o caída |

Pasa el cursor por la **línea**: verás índice, ICL, pendiente máxima y el texto
de revisión (`pendiente alta`, `radio bajo`, `intercepta drenaje potencial`…).
La **guía** (línea madre o el segmento de rumbo) se etiqueta *Guía keyline*.

**Cortes en drenaje.** Si un tramo cruza una vaguada con acumulación de unos
**2 ha** o más (el mismo umbral que las alcantarillas del camino), se parte y
queda un **punto azul**. El cursor dice *Corte en drenaje potencial*. En fincas
pequeñas o DEM de 10 m es normal que no haya cortes: no alcanza el umbral.

**Replanteo.** Puntos blancos cada N metros. El cursor muestra la cadena
(`Replanteo 40 m · 96.2 m`) — distancia a lo largo del tramo y cota. Van en el
GeoJSON de la capa: *Exportar JSON* los incluye para estaca o GPS.

#### Qué no es

No sustituye el plugin de QGIS para replanteo de maquinaria, ni un diseño
geométrico de terraza. En un DEM de 10 m con poco desnivel el ICL sale duro
(naranja o rojo) aunque el trazo sea razonable: la pendiente se mide sobre
celdas gruesas. Baja *Resample* no mejora el ICL; un DEM más fino sí.

El umbral de 2 ha no se puede cambiar en la interfaz. El ICL no usa el WDI ni
la fase de «construcción» del plugin.

### 3.6 · Edificaciones

Sección *Aptitud de edificación* del panel derecho. Ajusta *Pendiente máx.*
(12 %) y *Plataforma mínima* (20 m, el lado del área plana que necesitas) y pulsa
**Buscar sitios**.

Clasifica el terreno en cinco categorías, de *Poor* a *Excellent*, y coloca hasta
ocho sitios candidatos ordenados por puntaje. Cada uno informa cota, pendiente,
orientación y superficie de plataforma disponible.

La puntuación pondera pendiente (35 %), sequedad respecto al flujo concentrado
(20 %), posición relativa en la ladera (15 %), orientación solar hacia el ecuador
(15 %) y fracción de plataforma construible (15 %). Es un cribado de terreno: no
considera suelo, acceso, servicios ni normativa.

### 3.10 · Energía

Sección *Solar / sombra*. Fija el *Día del año* (1 a 365) y la *Hora local*, y
pulsa **Rebuild sombra**. El mapa muestra qué está iluminado y qué en sombra en
ese instante.

Los momentos que vale la pena revisar son los solsticios a primera y última hora:
día 172 y día 355 hacia las 8:00 y las 16:00. Es cuando la sombra es máxima y
donde se decide la ubicación de paneles, invernaderos y frutales exigentes.

---

## 4. Presupuesto

El panel izquierdo acumula las cantidades de todas las tuberías y caminos del
proyecto en una tabla única, con precios unitarios de referencia y total.

Son órdenes de magnitud para **comparar alternativas de trazo**, no una
cotización. Los precios unitarios están fijos en el código y no reflejan mercado
local ni condiciones de obra.

---

## 5. Guardar y recuperar

- **Guardar** deja el proyecto en el navegador; **Abrir local** lo recupera.
- **Exportar JSON** descarga un archivo con el proyecto, que se vuelve a cargar
  con el botón de importar proyecto.

Qué se guarda: la información del DEM (incluido su polígono), las capas
vectoriales, los dibujos y todos los parámetros. Qué **no** se guarda: los
rásters de análisis, porque abultarían el archivo; se regeneran con *Rebuild*.

El proyecto guarda el identificador del DEM, no el archivo. Si el backend se
reinicia y su carpeta `uploads/` se vació, habrá que volver a importar el DEM.

**Undo / Redo** cubren hasta 40 pasos. **Clear** borra análisis y dibujos, y no
se puede deshacer.

---

## 6. Atajos

| Tecla | Acción |
| --- | --- |
| `Enter` | Terminar el dibujo o el trazo en curso |
| `Esc` | Cancelar el dibujo en curso |
| `Ctrl + Z` | Deshacer |
| `Ctrl + Shift + Z` | Rehacer |
| Doble click | Equivale a Enter al dibujar |

---

## 7. Límites que conviene tener presentes

**El DEM manda.** Un modelo derivado de curvas interpoladas produce terrazas
falsas que aparecerán como pendientes escalonadas en todos los análisis.

**Las series climáticas son de malla.** Ni CHIRPS ni ERA5 son estaciones
meteorológicas. CHIRPS calibra satélite con pluviómetros y a 5 km resuelve bien
el gradiente de montaña, pero un microclima de ladera puede desviarse. Para
diseño definitivo de almacenamiento, contrasta con la estación más cercana.

**La hidráulica es de régimen permanente.** Hazen-Williams no modela transitorios
ni golpe de ariete, y no hay verificación de clase de presión de la tubería.

**El movimiento de tierra supone sección balanceada** de corte y relleno sobre
ladera uniforme. En terreno irregular, o si el diseño no compensa volúmenes, la
cifra real será mayor.

**Los costos son de referencia.** Precios unitarios fijos, sin transporte, sin
rendimientos locales, sin imprevistos.

En conjunto: la plataforma sirve para descartar rápido las malas alternativas y
llegar a la mesa de diseño con dos o tres opciones defendibles. La decisión final
necesita levantamiento de campo, ensayos de suelo e ingeniería de detalle.

---

## 8. Problemas frecuentes

**«No hay conexión con el API».** El backend no está corriendo. Si abriste la
aplicación con el acceso del escritorio, cierra la ventana de control y vuelve
a hacer doble clic. En desarrollo, arranca con `.\start-dev.ps1` o, por
separado, `cd backend` y
`.\venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000`. El detalle
del lanzador queda en `logs\backend.log`.

**Las herramientas de la barra están grises.** Falta cargar un DEM. Sólo
*Seleccionar*, las de dibujo y *Medir* funcionan sin él.

**Error de PROJ al arrancar el backend.** Hay una variable `PROJ_LIB` del sistema
(de PostGIS, casi siempre) tapando la base de datos de rasterio. Se corrige sola
al arrancar; si persiste, borra `PROJ_LIB` y `PROJ_DATA` del entorno.

**El clima tarda o avisa que falta CHIRPS.** ClimateSERV no respondió dentro del
tiempo disponible. La lluvia cae a ERA5 y el panel lo indica en la lista de
fuentes. Reintenta en un minuto.

**El análisis va lento.** Baja *Resample* al 25–50 % mientras exploras, y súbelo
sólo para el resultado que vayas a entregar.

**La cuenca sale minúscula.** El punto de aforo cayó en una ladera. Activa el
mapa *Drainage*, ubica el cauce y coloca el aforo encima.

**El keyline sale todo rojo o no corta en la vaguada.** En DEM de 10 m el ICL
castiga la pendiente celda a celda; prueba *Contorno 1:n* con caída más suave
(1:600–1:800) o *Madre* con intervalo de curvas 0,50 m. Los cortes azules
sólo aparecen si la acumulación llega a ~2 ha: en una finca de veinte hectáreas
puede no haber ninguno, y eso no invalida el trazo.

**La herramienta Keyline pide dos clics y elegí Madre.** Un clic basta. Si no
pasa nada, confirma que el DEM está cargado y que el clic cayó sobre celdas con
elevación, no sobre el nodata del borde.
