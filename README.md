# SBS / SB · Informes kinésicos

Aplicación local para SB Sports y Centro Médico San Bartolomé. Integra lecturas de VALD y Kinvent, comparación inicial/control y exportación a PDF.

## Instalar o activar las actualizaciones

[Descargar el paquete de instalación](https://raw.githubusercontent.com/andresleivakine-oss/sbs-sb-informes/main/downloads/SBS_SB_Conectado.zip)

Requiere Windows y Python 3.10 o posterior. Si ya tienes una versión instalada, abre **Actualizar SBS SB** desde Inicio y selecciona este ZIP, sin extraerlo. Si no tienes ese acceso, extrae el ZIP completo y abre `INSTALAR.bat`.

Desde la versión 0.5.0 aparece **Actualizar aplicación** dentro de la pantalla. Comprueba versiones al abrir; cuando exista una nueva, la descarga, verifica SHA-256 y pide confirmación antes de reiniciar e instalar. No exige cuenta GitHub en cada equipo. El menú Inicio conserva la actualización manual como respaldo.

## Datos y conexiones

Cada computador conserva las claves con DPAPI del usuario Windows y su identidad del centro, fuera de la carpeta reemplazada al actualizar. Los informes se guardan localmente con Guardar HTML o Imprimir/PDF. Este repositorio y las peticiones del actualizador no contienen claves reales ni fichas de pacientes.

La cuenta que publique en este repositorio controla el código de las actualizaciones. Mantén protegida su autenticación.

## Validación

Lectores, reglas, manifiesto, hash, versión y filtros probados con respuestas simuladas. Kinvent: búsqueda e historial observados previamente en cuenta real; lectura de valores pendiente de contraste con una evaluación conocida. VALD: acceso observado en cuenta real. La instalación/reapertura automática debe probarse en Windows antes de distribuir a todo el equipo.

Semáforo de fuerza bilateral definido por el centro: <15% verde, 15–20% amarillo, >20% rojo. Indica simetría, no recuperación de fuerza absoluta. GROC solo final.

## Mantener las versiones

Código en `app/`. `updates/latest.json` contiene versión, ruta y SHA-256 del ZIP; `updates/packages/` conserva los paquetes por su hash. `downloads/SBS_SB_Conectado.zip` apunta al paquete más reciente para instalaciones iniciales. Se publican código, ZIP y manifiesto en el mismo commit. No se suben `conexiones.dpapi`, `identidad.json` ni informes.
