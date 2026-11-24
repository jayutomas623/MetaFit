# Meta Fit 🏋️‍♂️

> Plataforma de entrenamiento, rutinas y seguimiento de condición física con **backend en Django REST Framework** y **app móvil en Expo / React Native (TypeScript)**. Incluye medición de peso y estatura con la cámara y conteo de repeticiones con visión por computadora (Google MediaPipe Pose).

👉 **¿Eres colaborador y acabas de descargar el proyecto? Empieza por [GUIA_COLABORADOR.md](GUIA_COLABORADOR.md)**: instalación paso a paso, uso con Claude Code, **zonas protegidas que no se deben modificar** y tareas pendientes.

👉 Detalles de red y problemas frecuentes (laptop + celular con Expo Go): [GUIA_EJECUCION.md](GUIA_EJECUCION.md).

---

## 📐 Arquitectura

```
MetaFit/
├── backend/                     # Django + Django REST Framework
│   ├── config/                  # settings, urls, wsgi, asgi
│   ├── usuarios/                # app principal
│   │   ├── models.py            # Usuario (con rol), Perfil (métricas corporales), MedicionCorporal
│   │   ├── views.py             # registro, login, perfil, me, mediciones, analizar-imagen
│   │   ├── serializers.py
│   │   ├── ia_service.py        # red neuronal (ResNet18) + "la matriz" de calibración
│   │   ├── IA_ANN/              # pesos del modelo (.pth)
│   │   └── tests.py
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/                    # Expo SDK 58 / React Native / TypeScript
│   ├── App.tsx                  # punto de entrada
│   ├── src/
│   │   ├── navigation/          # React Navigation (stack + pestañas del Dashboard)
│   │   ├── screens/             # Carga, Acceso, Registro, Dashboard, Rutinas, Ejercicios,
│   │   │                        # Nutrición, Estado, Perfil, CamaraBiometrica, CamaraPose
│   │   ├── components/          # UI reutilizable y ModalCamaraBiomecanica (sesión de ejercicio)
│   │   ├── services/
│   │   │   ├── exerciseEngine.ts    # motor de conteo y validación de repeticiones
│   │   │   ├── mediapipeWebView.ts  # cámara + MediaPipe dentro del WebView
│   │   │   ├── useStore.ts          # estado global (zustand + AsyncStorage)
│   │   │   └── apiConfig.ts         # URL del backend (EXPO_PUBLIC_API_URL)
│   │   ├── models/              # Usuario, Rutina, Ejercicio
│   │   └── theme/colors.ts      # paleta de la app
│   ├── .env.local.example       # plantilla para la IP del backend
│   └── package.json
│
├── proxy.js                     # proxy opcional con CORS: puerto 8085 → Django 8000
├── GUIA_EJECUCION.md            # guía de arranque paso a paso
└── README.md
```

---

## 🧰 Tecnologías

**Backend**
- Django 5–6 y Django REST Framework (autenticación por token)
- django-cors-headers, SQLite
- IA: PyTorch / torchvision (ResNet18), OpenCV (detector de personas HOG), Pillow

**Frontend**
- Expo SDK 58, React Native 0.88, React 19, TypeScript
- React Navigation (stack nativo + pestañas inferiores)
- zustand + AsyncStorage (sesión y datos locales)
- react-native-webview + Google MediaPipe Pose (detección de cuerpo en tiempo real)
- expo-camera (permisos), expo-speech (voz), react-native-svg (gráficas)

---

## 🚀 Arranque rápido

Resumen; el detalle (firewall, IP, Expo Go, problemas frecuentes) está en [GUIA_EJECUCION.md](GUIA_EJECUCION.md).

**Pestaña 1: Backend** (Python 3.11 o 3.12)
```powershell
cd backend
py -3.12 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000
```

**Pestaña 2: Frontend**
```powershell
cd frontend
npm install
copy .env.local.example .env.local     # y poner la IP de la laptop
npx expo start -c
```

Después escaneen el QR con **Expo Go** (mismo Wi-Fi que la laptop).

### Comandos útiles

| Comando | Carpeta | Para qué |
|---|---|---|
| `python manage.py test usuarios` | `backend` | Pruebas del backend |
| `npx tsc --noEmit` | `frontend` | Verificar tipos de TypeScript |
| `npm run tunnel` | `frontend` | Expo por túnel si la red bloquea la conexión local |
| `node proxy.js` | raíz | Proxy con CORS hacia Django (opcional) |

---

## 🔌 API del backend

Todas las rutas cuelgan de `/api/usuarios/`. Las protegidas requieren la cabecera `Authorization: Token <key>`.

| Ruta | Método | Auth | Descripción |
|---|---|---|---|
| `registro/` | POST | No | Crea usuario + perfil y devuelve `{token, usuario}` |
| `login/` | POST | No | Devuelve `{token, usuario}` |
| `perfil/` | GET / PATCH | Sí | Perfil con métricas calculadas (IMC, % grasa, masa magra, TMB…) |
| `me/` | GET | Sí | Usuario autenticado |
| `mediciones/` | GET / POST | Sí | Historial de mediciones corporales (paginado, 10 por página) |
| `analizar-imagen/` | POST | No | Estima peso y estatura desde una foto (`imagen` o `imagen_base64`) |

Panel de administración: `http://127.0.0.1:8000/admin/`. Roles: `Usuario` (por defecto) y `Administrador`.

---

## ⚙️ Cómo funciona

- **Datos locales:** el login, el registro, el plan, la dieta, las rutinas y el avance diario se guardan **solo en el celular** (Zustand + AsyncStorage). La app **todavía no llama al backend**, a propósito. La URL del backend ya se configura en `frontend/.env.local`.
- **Plan personalizado, Nutrición y Rutinas:** el Plan personalizado calcula calorías, macros, agua, menú y rutina semanal según tus medidas, tu objetivo y tu frecuencia de entrenamiento. Con "Seguir este plan" se activa en Nutrición y en Mis Rutinas, donde también puedes usar tu propia dieta o tus propias rutinas y marcar lo que cumpliste cada día. El Dashboard muestra el plan activo y el avance de hoy.
- **Peso y estatura con cámara:** desde el Registro se abre la cámara. MediaPipe detecta el cuerpo y la app estima estatura (de la coronilla al suelo) y peso (por el ancho de la silueta) directamente en el celular. La medida se fija al quedarse quieto o con CAPTURAR, y se guarda levantando la mano o con GUARDAR.
- **Ejercicios con IA:** en Ejercicios, el motor (`exerciseEngine.ts`) calcula el ángulo de la articulación clave y sigue cada repetición (en posición → descenso → fondo → subida). Una repetición **solo cuenta** si llega al rango completo, vuelve a la posición inicial, no tiene errores de postura sostenidos y no es demasiado rápida. Si no, se marca como **"No contada"** con su motivo y un consejo. Al finalizar la serie se muestra un resumen con recomendaciones. En los ejercicios de un solo lado, la cámara cuenta el Lado 1, pide girar y luego cuenta el Lado 2.
- **Zonas protegidas (no modificar):**
  - la matriz de calibración `backend/usuarios/ia_service.py` y el modelo `.pth`;
  - las fórmulas biométricas de `PantallaCamaraBiometrica.tsx`;
  - el motor 2D de `exerciseEngine.ts`;
  - la captura de cámara de `mediapipeWebView.ts`.

  El detalle está en [GUIA_COLABORADOR.md](GUIA_COLABORADOR.md#1-zonas-protegidas-no-modificar).

---

## 🎨 Diseño

- Estilo limpio inspirado en iOS: tarjetas blancas con bordes redondeados y sombras suaves.
- Color primario `#FF2D55`, con acentos ámbar (`#F59E0B`) y verde (`#10B981`); la paleta completa está en `frontend/src/theme/colors.ts`.
- Navegación con transiciones tipo fade entre pantallas y barra de pestañas flotante en el Dashboard.
