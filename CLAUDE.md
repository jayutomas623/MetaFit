# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MetaFit is a fitness app (Spanish-language codebase and UI) with a Django REST backend (`backend/`) and an Expo / React Native frontend (`frontend/`). `frontend/CLAUDE.md` (→ `frontend/AGENTS.md`) holds Expo-specific rules and applies when working there.

`README.md` gives the overview, `GUIA_EJECUCION.md` the network/setup details, and `GUIA_COLABORADOR.md` the onboarding guide for new collaborators: setup, protected zones, which screens are still static, and the prioritized backlog. The frontend was ported from Flutter, so comments like "Similar to ... in Dart" are leftovers.

## Protected zones — do NOT modify ("la matriz")

These are calibrated with real measurements and validated on devices. Do not change them, even to refactor, unless the user explicitly asks for that specific change:

1. `backend/usuarios/ia_service.py`, the whole file: HOG person box → `h_rel`/`w_rel`/aspect ratio → the "MATRIZ GEOMÉTRICA A 2 METROS" height/weight calibration on top of the ResNet18 output.
2. `backend/usuarios/IA_ANN/modelo_metafit_mejorado.pth`: the trained weights (and the ResNet18 architecture in `ia_service.py` that loads them).
3. The on-device biometric formulas in `PantallaCamaraBiometrica.tsx`, sections 1–4 of `handleWebViewMessage`: crown/floor lines, `alturaRelativa * 281 - 2`, silhouette-width weight with IMC base 25.5, and their buffers/EMA/hysteresis. Camera lifecycle and UI around them may change; the math may not.
4. The 2D exercise engine math in `exerciseEngine.ts`: `VectorMath`, the `EXERCISE_CONFIG` joints and angle thresholds, and the rep state machine. Never enable 3D / `poseWorldLandmarks`.
5. Camera capture in `mediapipeWebView.ts`: 640×480 request, zoom locked to 1x, single camera owner. Formulas 3–4 depend on frames arriving the same way.

Ask before changing the body-fat formula and the IMC/fat categories in `frontend/src/models/Usuario.ts` (`UsuarioLogic`) or the `Perfil` metrics in `backend/usuarios/models.py`; every number in the app derives from them.

## Commands

### Backend (run from `backend/`)
```bash
py -3.12 -m venv venv && .\venv\Scripts\Activate.ps1   # use Python 3.11/3.12 (torch/mediapipe wheels); venv/ and db.sqlite3 are gitignored
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver             # http://127.0.0.1:8000, admin at /admin/
python manage.py test usuarios                                             # all tests
python manage.py test usuarios.tests.UsuarioAPITests.test_login_usuario_exitoso_devuelve_token  # single test
```
`views.py` imports `ia_service` at module level, so torch/torchvision/opencv must be installed even to run the tests.

### Frontend (run from `frontend/`)
```bash
npm install
npx expo start          # or: npm run start / start:clear / tunnel / android / ios / web
npx expo install <pkg>  # always use this instead of npm install <pkg>
npx tsc --noEmit        # typecheck
npx expo lint
```
There are no frontend tests.

### Proxy (repo root)
`node proxy.js` runs a CORS-adding HTTP proxy on `0.0.0.0:8085` that forwards everything to Django on `127.0.0.1:8000` (for reaching the backend from devices or tunnels).

## Architecture

### Backend
- Single app `usuarios` under `config/`. Custom user model `usuarios.Usuario` (`AUTH_USER_MODEL`) with a `rol` field (`Usuario` / `Administrador`), a one-to-one `Perfil`, and `MedicionCorporal` history.
- Body-composition metrics (IMC/BMI, fat %, lean/muscle mass, water, BMR, visceral fat, fat category) are computed as **properties on `Perfil`** in `models.py` and returned read-only by `PerfilSerializer`. `MedicionCorporal` instead stores precomputed values sent by the client.
- Auth uses DRF TokenAuthentication: `registro/` and `login/` return `{token, usuario}`, and clients send `Authorization: Token <key>`. The global default permission is `AllowAny`, so each view sets its own `permission_classes`.
- Endpoints live under `/api/usuarios/`: `registro/`, `login/`, `perfil/`, `me/`, `mediciones/` (paginated, PAGE_SIZE 10), and `analizar-imagen/`.
- `analizar-imagen/` (`ia_service.AnalizadorCorporal`) accepts multipart `imagen` or `imagen_base64`. It runs OpenCV HOG person detection, then a ResNet18 with 2 outputs (weights in `usuarios/IA_ANN/modelo_metafit_mejorado.pth`) to predict weight and height. The model is lazily cached at class level. Heights under 3 are treated as meters and converted to cm.
- Dev settings: `ALLOWED_HOSTS=['*']`, `CORS_ALLOW_ALL_ORIGINS`, SQLite.

### Frontend
- **Navigation uses React Navigation, not Expo Router** (`frontend/AGENTS.md` says to use Expo Router, but this app doesn't). `App.tsx` → `src/navigation/AppNavigator.tsx`, a native stack: Carga → Acceso/Registro → Dashboard, plus the CamaraPose and CamaraBiometrica screens. `PantallaDashboard` hosts a bottom-tab navigator for the main sections (rutinas, ejercicios, nutrición, estado, perfil).
- **State is local only.** `src/services/useStore.ts` is a zustand store persisted to AsyncStorage (session, profile, weekly activity points, and per-user `planes`). Right now login and registration only call `iniciarSesion` locally; the frontend makes **no HTTP calls to the Django backend**. Connecting them is open work.
- **Pose tracking runs inside a WebView.** `src/services/mediapipeWebView.ts` builds the shared HTML used by both `ModalCamaraBiomecanica.tsx` and `PantallaCamaraBiometrica.tsx`. It loads MediaPipe Pose from jsDelivr, posts landmarks through `window.ReactNativeWebView.postMessage`, and exposes `window.detenerCamara` / `reanudarCamara` / `toggleCameraFacing`. Screens must inject `SCRIPT_DETENER_CAMARA` before unmounting, or the next open finds the camera busy.
- `src/services/exerciseEngine.ts` (`ExerciseEngine.processLandmarks`) uses one body side per chain, a per-exercise config (`EXERCISE_CONFIG`: joints, start/target/finish angles, form rules with tips), and a rep state machine (`readyUp/descending/bottom/ascending`). A rep counts only with full range, a return to finish, no sustained form errors, and a minimum duration; otherwise it is reported as rejected with a reason. `getSessionSummary()` feeds the end-of-set recommendations. Voice feedback uses `expo-speech`.
  The engine is 2D only: do NOT feed `poseWorldLandmarks` (a 3D attempt broke the bicep curl and was reverted). Voice corrections (`vozCorreccion`, sustained posture error or bad detection for ~3 s, 5 s cooldown) are a separate layer that never changes counting.
- `ModalCamaraBiomecanica` takes `metaReps` (per side for unilateral exercises, see `EJERCICIOS_UNILATERALES`) and runs unilateral sets as Lado 1 → 4 s transition (frames ignored, then `reiniciarSeguimiento()`) → Lado 2. `onCompletarSerie(reps, detalle)` reports the result.
- Only one WebView may own the camera: `tomarCamara(ref)` before mounting and `soltarCamara(ref)` on blur/close (`mediapipeWebView.ts`).
- Backend URL comes from `EXPO_PUBLIC_API_URL` in `frontend/.env.local` via `src/services/apiConfig.ts`. The frontend intentionally stays local-only (Zustand + AsyncStorage); do not wire it to Django unless asked.
- **Plan / nutrition / routines are one system.** `src/services/recomendador.ts` (`generarPlan(perfil, configIA)`) is a pure function producing calories, macros, water, meal options (from an `ALIMENTOS` catalog with per-unit macros) and a 7-day routine from the chosen frequency. Per-user decisions live in the store under `planes[correo]` (`DatosPlanUsuario` in `src/models/Plan.ts`: IA config, `planIAActivo`, `modoNutricion`/`modoRutinas` = `'ia' | 'propio'`, own meals, own routines, and a per-date `registro`). `src/services/usePlanActivo.ts` is the single source that resolves "what applies today" for `PantallaEstado` (dashboard), `SeccionNutricion` (Nutrición tab), `PantallaRutinas` and `PantallaPlanPersonalizado`. Change numbers in the recommender, not in screens.
- `exerciseEngine.ts` / `exerciseEngine.js` at the repo root are stale copies that differ from `frontend/src/services/exerciseEngine.ts`. Edit the one under `frontend/src/services/`.
- Theme colors live in `src/theme/colors.ts`. Domain models (`Usuario`, `Rutina`, `Ejercicio`) are in `src/models/`.
