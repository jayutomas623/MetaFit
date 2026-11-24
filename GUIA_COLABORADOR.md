# Guía para colaboradores de MetaFit

Este documento es para quien descarga el proyecto por primera vez en su laptop. Explica:

1. [Las zonas protegidas que **no se deben modificar**](#1-zonas-protegidas-no-modificar)
2. [Cómo levantar el proyecto paso a paso](#2-levantar-el-proyecto-paso-a-paso-windows)
3. [Cómo trabajar con Claude Code en este repo](#3-trabajar-con-claude-code)
4. [Cómo está armada la app](#4-cómo-está-armada-la-app)
5. [Qué pantallas siguen estáticas](#5-estado-de-cada-pantalla-dinámica-o-estática)
6. [Análisis del proyecto y tareas pendientes](#6-análisis-del-proyecto-y-tareas-pendientes)
7. [Cómo probar y subir cambios](#7-cómo-probar-y-subir-cambios)

> **Estado actual:** la app funciona **solo de forma local**. Todos los datos (usuario, plan, dieta, rutinas, avance diario) se guardan en el propio celular con Zustand + AsyncStorage. El frontend **todavía no se conecta al backend de Django**, y por ahora debe seguir así.

---

## 1. Zonas protegidas (NO MODIFICAR)

Estas partes están calibradas con mediciones reales y probadas en el celular. Si se cambian, las medidas o el conteo dejan de funcionar. **No se tocan**, ni para "limpiar" ni para "mejorar", salvo acuerdo explícito con el responsable del proyecto.

| # | Qué es | Dónde | Por qué no se toca |
|---|---|---|---|
| 1 | **"La matriz" de calibración del backend.** Detección de la persona con HOG, cálculo de `h_rel`, `w_rel` y proporción, y la capa "MATRIZ GEOMÉTRICA A 2 METROS" que ajusta la estatura y el peso de la red neuronal. | [`backend/usuarios/ia_service.py`](backend/usuarios/ia_service.py) (todo el archivo) | Calibrada para una persona a 2 m con zoom 1x. Cualquier número que cambie descalibra la estimación. |
| 2 | **Pesos de la red neuronal** (ResNet18 con 2 salidas). | [`backend/usuarios/IA_ANN/modelo_metafit_mejorado.pth`](backend/usuarios/IA_ANN/modelo_metafit_mejorado.pth) | Es el modelo entrenado. Reemplazarlo o cambiar su arquitectura en `ia_service.py` rompe la predicción. |
| 3 | **Fórmulas biométricas de la cámara** (estatura, peso, IMC): línea de la coronilla, línea del suelo, `alturaRelativa * 281 - 2`, peso por ancho de silueta con IMC base 25,5, y sus filtros (buffers, EMA, histéresis). | [`frontend/src/screens/PantallaCamaraBiometrica.tsx`](frontend/src/screens/PantallaCamaraBiometrica.tsx), secciones 1 a 4 de `handleWebViewMessage` | Es la estimación que usa hoy la app, calibrada con personas reales. Solo se puede tocar lo que rodea a las fórmulas (ciclo de vida de la cámara, interfaz), nunca las fórmulas. |
| 4 | **Motor 2D de ejercicios:** cálculo de ángulos (`VectorMath`), umbrales de cada ejercicio (`EXERCISE_CONFIG`: articulaciones y ángulos de inicio, objetivo y final) y la máquina de estados que cuenta repeticiones. | [`frontend/src/services/exerciseEngine.ts`](frontend/src/services/exerciseEngine.ts) | Cuenta bien de perfil y está validado en el celular. **No activar 3D** (`poseWorldLandmarks`): ya se probó, arruinó el curl de bíceps y se revirtió. |
| 5 | **Captura de la cámara** (resolución 640×480, zoom bloqueado en 1x, una sola cámara a la vez). | [`frontend/src/services/mediapipeWebView.ts`](frontend/src/services/mediapipeWebView.ts) | Las fórmulas (#3) y el motor (#4) dependen de que la imagen llegue siempre igual. Cambiar la resolución o el zoom altera las medidas. |

**Con precaución (consultar antes de cambiar):** la fórmula de % de grasa y las categorías de IMC y grasa en [`frontend/src/models/Usuario.ts`](frontend/src/models/Usuario.ts) (`UsuarioLogic`), y las métricas de `Perfil` en [`backend/usuarios/models.py`](backend/usuarios/models.py). De ellas dependen el Dashboard, el Plan personalizado y la Nutrición; un cambio ahí cambia todos los números de la app.

---

## 2. Levantar el proyecto paso a paso (Windows)

### 2.1 Programas necesarios (una sola vez)

| Programa | Versión | Para qué |
|---|---|---|
| [Git](https://git-scm.com/download/win) | cualquiera reciente | Descargar el proyecto |
| [Node.js](https://nodejs.org/) | **20 o superior** (LTS) | Ejecutar la app (Expo) |
| [Python](https://www.python.org/downloads/) | **3.11 o 3.12** (no 3.13 ni 3.14) | Solo si vas a usar el backend |
| **Expo Go** (en el celular) | compatible con **Expo SDK 58** | Abrir la app en el teléfono |
| **Claude Code** | — | Ver la [sección 3](#3-trabajar-con-claude-code) |

### 2.2 Descargar el proyecto

Abre PowerShell en la carpeta donde quieras guardarlo:

```powershell
git clone https://github.com/jayutomas623/MetaFit.git
```

```powershell
cd MetaFit
```

### 2.3 App móvil (lo único necesario para probar la app hoy)

```powershell
cd frontend
```

```powershell
npm install
```

```powershell
copy .env.local.example .env.local
```

El archivo `.env.local` solo hará falta cuando se conecte el backend. Si quieres dejarlo listo, ejecuta `ipconfig`, copia la "Dirección IPv4" de tu Wi-Fi y ponla en `frontend/.env.local`:

```
EXPO_PUBLIC_API_URL=http://TU_IP:8000
```

Arranca Expo (la primera vez con `-c` para limpiar la caché):

```powershell
npx expo start -c
```

### 2.4 Abrir la app en el celular

1. Conecta el celular **a la misma red Wi-Fi** que la laptop.
2. Abre **Expo Go** y escanea el QR que aparece en la terminal (en iPhone, con la cámara).
3. Acepta el permiso de cámara.
4. El celular necesita **internet**, porque la detección de cuerpo (MediaPipe) se descarga al abrir la cámara.
5. Si la red (por ejemplo, la de la universidad) no deja conectar, usa el túnel:

```powershell
npm run tunnel
```

### 2.5 Backend Django (opcional por ahora)

La app **no lo usa todavía**; solo es necesario si vas a trabajar en el backend. En **otra** pestaña de terminal:

```powershell
cd backend
```

```powershell
py -3.12 -m venv venv
```

```powershell
venv\Scripts\activate
```

Si PowerShell bloquea la activación, ejecuta esto una vez y vuelve a activar:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

```powershell
pip install -r requirements.txt
```

```powershell
python manage.py migrate
```

```powershell
python manage.py createsuperuser
```

```powershell
python manage.py runserver 0.0.0.0:8000
```

Para correr las pruebas del backend:

```powershell
python manage.py test usuarios
```

La guía de red más detallada (firewall, problemas frecuentes) está en [GUIA_EJECUCION.md](GUIA_EJECUCION.md).

---

## 3. Trabajar con Claude Code

### 3.1 Abrirlo en el proyecto

Abre Claude Code **en la carpeta raíz `MetaFit`** (no dentro de `frontend` ni de `backend`), ya sea desde la terminal con `claude` o desde la app de escritorio eligiendo esa carpeta.

Claude Code lee solo estos archivos al empezar:

- [`CLAUDE.md`](CLAUDE.md) (raíz): comandos, arquitectura y **la lista de zonas protegidas**. Si encuentras algo nuevo que no se debe tocar, agrégalo ahí.
- [`frontend/CLAUDE.md`](frontend/CLAUDE.md) → [`frontend/AGENTS.md`](frontend/AGENTS.md): reglas de Expo. Ese archivo dice que se use Expo Router, pero **esta app usa React Navigation**; manda lo que dice el `CLAUDE.md` de la raíz.
- [`frontend/.claude/settings.json`](frontend/.claude/settings.json): activa el plugin oficial de Expo.

### 3.2 Primer mensaje recomendado

Antes de pedir cambios, pídele que entienda el proyecto:

```
Lee CLAUDE.md y GUIA_COLABORADOR.md. Resúmeme la arquitectura y
las zonas protegidas que no debes modificar. No cambies nada todavía.
```

### 3.3 Reglas al pedirle cambios a Claude Code

- Recuérdale en cada tarea: **"No modifiques las zonas protegidas de GUIA_COLABORADOR.md (la matriz, las fórmulas biométricas, el motor 2D ni la captura de cámara)"**.
- **No conectar el backend** salvo que se acuerde; los datos siguen en el celular.
- Pídele que termine con `npx tsc --noEmit` (dentro de `frontend`) y que te muestre el resultado.
- Pídele que **no haga commit** hasta que lo pruebes en Expo Go.
- Para agregar librerías: `npx expo install <paquete>` (nunca `npm install <paquete>`). Una librería con código nativo puede no funcionar en Expo Go.
- Trabaja en una rama propia (ver [sección 7](#7-cómo-probar-y-subir-cambios)).

---

## 4. Cómo está armada la app

```
App.tsx → AppNavigator (stack)
  Carga → Acceso / Registro → Dashboard (pestañas inferiores)
                                 ├─ Ejercicios   (catálogo + cámara IA)
                                 ├─ Rutinas      (Rutina del Plan IA / Mis Rutinas Propias)
                                 ├─ Estado       (inicio: IMC, grasa, plan, calorías, actividad)
                                 ├─ Nutrición    (Plan Recomendado IA / Mi Dieta Propia)
                                 └─ Perfil
  CamaraBiometrica  (medir peso y estatura con la cámara, desde Registro)
  PlanPersonalizado (objetivo, frecuencia, "Seguir este plan")
```

| Pieza | Archivo | Qué hace |
|---|---|---|
| Datos guardados | [`services/useStore.ts`](frontend/src/services/useStore.ts) | Sesión, perfil, puntos semanales y, por usuario (`planes[correo]`): configuración del Plan IA, dieta propia, rutinas propias y avance de cada día. |
| Tipos del plan | [`models/Plan.ts`](frontend/src/models/Plan.ts) | Objetivo, frecuencia, comidas propias, rutinas propias, registro diario. |
| Generador del plan | [`services/recomendador.ts`](frontend/src/services/recomendador.ts) | A partir de peso, estatura, edad, género, objetivo y frecuencia calcula calorías, macros, agua, menú y rutina semanal. **Los números del plan se cambian aquí, no en las pantallas.** |
| Plan activo | [`services/usePlanActivo.ts`](frontend/src/services/usePlanActivo.ts) | Fuente única de "qué toca hoy" para Dashboard, Nutrición y Rutinas, según el modo elegido (IA o propio). |
| Cámara de ejercicios | [`components/ModalCamaraBiomecanica.tsx`](frontend/src/components/ModalCamaraBiomecanica.tsx) | Recibe la meta de repeticiones; en ejercicios de un solo lado hace Lado 1 → pausa de 4 s → Lado 2. Voz de guía y de corrección. |
| Motor de ejercicios | [`services/exerciseEngine.ts`](frontend/src/services/exerciseEngine.ts) | **Protegido.** Cuenta repeticiones solo si están bien hechas. |
| Componentes del plan | [`components/plan/`](frontend/src/components/plan/) | Selectores, chips, barras de progreso y la sección de Nutrición. |

---

## 5. Estado de cada pantalla (dinámica o estática)

| Pantalla | Estado | Qué falta |
|---|---|---|
| **Estado** (inicio) | Dinámica | IMC, grasa, plan activo, calorías del día y actividad salen de los datos. Los **puntos semanales nunca se reinician** (ver 6.1). El "rango ideal 300+ pts" es fijo. |
| **Plan personalizado** | Dinámica | — |
| **Nutrición** | Dinámica (plan IA y dieta propia) | El **"Analizar comida" por foto es simulado**: siempre devuelve el mismo plato (485 kcal) tras 1,6 s, en [`PantallaNutricion.tsx`](frontend/src/screens/PantallaNutricion.tsx) (`_procesarAnalisisIA`). |
| **Rutinas** | Dinámica (plan IA y rutinas propias) | No hay historial de días anteriores (solo se ve hoy). |
| **Ejercicios** | Semi-estática | El catálogo, el nivel, las "series × reps" y las ventajas son texto fijo ([`models/Ejercicio.ts`](frontend/src/models/Ejercicio.ts)). No guarda resultados de cada sesión ni récords personales. |
| **Perfil** | Parcial | Solo edita peso, estatura y edad. No permite cambiar nombre, **género** ni objetivo, ni volver a medir con la cámara. |
| **Acceso** (login) | Simulada | **No valida la contraseña**: cualquier correo entra. Un correo nuevo entra con valores por defecto (175 cm, 74 kg, 24 años). |
| **Registro** | Parcial | Guarda los datos en el celular pero no la contraseña. El aviso tras la medición menciona "entorno (A4)" y "malla 3D", que la app no usa. |
| **Cámara biométrica** | Dinámica | **Protegida** (ver sección 1). |
| **CamaraPose** | **Falsa y sin uso** | Cuenta repeticiones inventadas con temporizadores y ninguna pantalla navega a ella. Está registrada en [`AppNavigator.tsx`](frontend/src/navigation/AppNavigator.tsx). |

---

## 6. Análisis del proyecto y tareas pendientes

Todas estas tareas respetan la regla de mantener los datos en el celular. Las de prioridad alta son errores o datos que confunden al usuario.

### 6.1 Prioridad alta

1. **Los puntos de actividad semanal nunca se reinician.** `sumarPuntosActividad` suma al día de la semana pero no detecta que empezó una semana nueva, así que el gráfico mezcla semanas ([`useStore.ts`](frontend/src/services/useStore.ts)). Guardar la fecha del lunes de la semana actual y reiniciar los puntos cuando cambie.
2. **Cambiar de usuario borra el perfil anterior.** Hay un solo `usuarioActual`: si inicia sesión otro correo, se pierden el peso, la estatura y la edad del anterior (los planes sí se separan por correo). Guardar los perfiles por correo, igual que `planes`.
3. **El login no valida nada.** Guardar en el registro un hash local de la contraseña (o un PIN) y comprobarlo al entrar, sin backend. Si el correo no existe, mandar al Registro en vez de crear un usuario con valores por defecto.
4. **"Analizar comida" es falso.** Opciones:
   - quitarlo o marcarlo como "demo";
   - convertirlo en un registro manual que agregue la comida a "Mi Dieta Propia";
   - más adelante, conectarlo a un servicio real de reconocimiento de alimentos.
5. **Pantalla `CamaraPose` falsa.** Eliminarla (archivo y ruta en `AppNavigator.tsx`), porque la cámara real es `ModalCamaraBiomecanica`.

### 6.2 Prioridad media

6. **Historial y progreso:** el avance de cada día ya se guarda (`planes[correo].registro`), pero solo se muestra hoy. Agregar una vista semanal o mensual de comidas y series cumplidas, y una gráfica de peso en el tiempo (guardar cada cambio de peso del Perfil con su fecha).
7. **Perfil completo:** editar nombre, género y objetivo, y un botón "Volver a medir con la cámara" que abra `CamaraBiometrica`.
8. **Ejercicios con datos reales:** guardar cada serie terminada (fecha, reps válidas, no contadas, errores frecuentes) y mostrar "última vez" y "mejor marca" en cada tarjeta.
9. **Limpiar datos viejos:** el registro diario crece sin límite; borrar automáticamente los días de hace más de, por ejemplo, 90 días.
10. **Texto engañoso del Registro:** cambiar el aviso que menciona "A4" y "malla 3D" por uno que describa la estimación por cámara. Es solo texto del `Alert` en [`PantallaRegistro.tsx`](frontend/src/screens/PantallaRegistro.tsx), no las fórmulas.
11. **Recordatorios:** notificaciones locales para las comidas y el entrenamiento del día (con `expo-notifications`; verificar que funcione en Expo Go).

### 6.3 Prioridad baja / limpieza

12. **Código sin uso:**
    - `components/ApartadoAlimentos.tsx`, `components/CustomIcons.tsx` y `listaRutinasEjemplo` en `models/Rutina.ts`;
    - `exerciseEngine.ts` y `exerciseEngine.js` en la raíz, que son copias viejas;
    - `backend/test_img.jpg`.
13. **Calidad:** el proyecto no tiene ESLint configurado ni pruebas del frontend. Lo más útil sería probar `recomendador.ts` y `usePlanActivo.ts`, que son funciones puras.
14. **MediaPipe desde internet:** la cámara descarga MediaPipe de jsDelivr cada vez. Sin internet no funciona; a futuro se podría empaquetar dentro de la app.
15. **Backend, para cuando se conecte:**
    - `SECRET_KEY` está escrita en `settings.py`, con `DEBUG = True`, `ALLOWED_HOSTS = ['*']` y CORS abierto. Sirve para desarrollo, pero hay que moverlo a variables de entorno antes de publicar.
    - `mediapipe` está en `requirements.txt` pero el backend no lo usa: es una dependencia pesada que se puede quitar.
    - El modelo `Perfil` (backend) y `UsuarioLogic` (app) usan la misma fórmula de grasa (Deurenberg), pero duplicada. Al conectar, conviene que una sola parte la calcule, **sin tocar `ia_service.py`**.
16. **Documentación de Expo:** `frontend/AGENTS.md` pide Expo Router, pero la app usa React Navigation. Aclararlo o ajustarlo para que nadie migre la navegación por error.

---

## 7. Cómo probar y subir cambios

### Antes de subir algo

1. Typecheck sin errores. Dentro de `frontend`:

```powershell
npx tsc --noEmit
```

2. Probar en Expo Go el flujo que tocaste y estos tres básicos:
   - **Registro con medición por cámara:** entra y sal varias veces de la cámara; no debe hacer zoom ni dejar de detectar.
   - **Ejercicio con cámara:** por ejemplo, un curl de bíceps de perfil, con el cambio de lado.
   - **Plan:** Plan personalizado → "Seguir este plan" → marcar una comida en Nutrición y una serie en Rutinas → que el Dashboard se actualice.
3. Confirmar que **no cambiaste ninguna zona protegida**:

```powershell
git diff --stat
```

Si aparece `ia_service.py`, el `.pth`, o cambios en las fórmulas de `PantallaCamaraBiometrica.tsx` o en los ángulos de `exerciseEngine.ts`, revierte esa parte.

### Flujo con Git

Trabaja en una rama propia y abre un Pull Request en GitHub para que el responsable lo revise antes de unirlo a `main`:

```powershell
git checkout -b nombre-de-tu-tarea
```

```powershell
git add -A
```

```powershell
git commit -m "Descripción corta del cambio"
```

```powershell
git push -u origin nombre-de-tu-tarea
```

Nunca subas `frontend/.env.local`, `backend/venv`, `backend/db.sqlite3` ni `node_modules`; ya están en `.gitignore`.
