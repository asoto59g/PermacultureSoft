# Lanzador de escritorio

PermacultureSoft se puede abrir en Windows con un doble clic, sin terminal.
Sirve para el equipo de trabajo: cada quien lo corre en su PC, sobre capas
gratuitas, y apaga los servidores al cerrar la ventana de control.

El desarrollo con recarga automática sigue siendo `start-dev.ps1`. Este
lanzador sirve la interfaz **compilada** (`next start`) y el API de Python
en segundo plano.

---

## Una vez por equipo

1. Instala [Python 3.11+](https://www.python.org/downloads/) (marca *Add python.exe to PATH*) y [Node.js 20 LTS](https://nodejs.org/).
2. Clona o copia esta carpeta.
3. Ejecuta `scripts\Instalar.cmd`.

Eso crea el entorno de Python, instala dependencias, compila la interfaz,
deja un acceso **PermacultureSoft** en el escritorio y **abre la aplicación**
(ventana de control y navegador). No hace falta un segundo clic.

Para sólo recrear el icono: `scripts\CrearAccesoEscritorio.cmd`.

Tras un `git pull`, vuelve a ejecutar `Instalar.cmd` para recompilar; al
terminar vuelve a abrir la aplicación.

---

## Uso diario

1. Doble clic en el acceso del escritorio, o en `PermacultureSoft.vbs` dentro
   de la carpeta del proyecto.
2. Aparece una ventana pequeña. No hay consola negra.
3. Cuando los servidores responden se abre el navegador (Edge en modo
   aplicación; si no está, el predeterminado) en `http://127.0.0.1:3000`.
4. Mientras esa ventana esté abierta, la aplicación vive.
5. **Detener y salir** apaga los dos servidores.

Si ya estaba corriendo, un segundo doble clic sólo abre otra ventana del mapa.

---

## Qué archivos intervienen

| Archivo | Función |
| --- | --- |
| `PermacultureSoft.vbs` | Punto de doble clic. Arranca PowerShell oculto. |
| `scripts\launcher.ps1` | Ventana de control, arranque y apagado de FastAPI y Next.js. |
| `scripts\Instalar.cmd` | Instalación de una sola vez; al terminar abre la aplicación. |
| `scripts\install.ps1` | Lógica del instalador y del acceso de escritorio. |
| `scripts\CrearAccesoEscritorio.cmd` | Sólo regenera el `.lnk` del escritorio. |
| `logs\` | Bitácoras (`launcher.log`, `backend.log`, `frontend.log`). No se versionan. |

El backend escucha en `127.0.0.1:8000`. El frontend, en `127.0.0.1:3000`.
Next.js reenvía `/api/*` a FastAPI, excepto las rutas de clima que viven en
Next.js.

---

## Problemas frecuentes

**«Falta la instalación».** Ejecuta `scripts\Instalar.cmd`.

**El puerto 3000 u 8000 está ocupado.** Cierra la otra instancia (o
`start-dev.ps1`) y vuelve a intentar.

**La ventana se queda en «Preparando…».** Revisa `logs\launcher.log`. En redes
con proxy corporativo el lanzador fuerza `127.0.0.1` y un proxy vacío para no
colgarse.

**Tras actualizar el código se ve la versión vieja.** `Instalar.cmd` otra vez.
El lanzador no recompila en cada arranque (recorrer `src` en OneDrive tardaba
decenas de segundos).

**Linux / macOS.** No hay lanzador de escritorio. Usa `start-dev.ps1` o los
dos servidores por separado, como indica el [README](../README.md).
