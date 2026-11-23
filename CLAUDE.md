# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MetaFit is a fitness app (Spanish-language codebase and UI) with a Django REST backend (`backend/`) and an Expo / React Native frontend (`frontend/`). `frontend/CLAUDE.md` (→ `frontend/AGENTS.md`) holds Expo-specific rules and applies when working there.

`README.md` gives the overview and `GUIA_EJECUCION.md` the step-by-step setup (laptop + Expo Go). The frontend was ported from Flutter, so comments like "Similar to ... in Dart" are leftovers.

## Do not modify "la matriz"

The team treats the calibration layer as off-limits: the geometric calibration in `backend/usuarios/ia_service.py` (HOG box → `h_rel`/`w_rel` → height/weight adjustment) and the on-device estimation formulas in `PantallaCamaraBiometrica.tsx` (sections 1–4 of `handleWebViewMessage`: crown/floor lines, `alturaRelativa * 281 - 2`, silhouette-width weight, and their filters). Fix camera capture and lifecycle around them, never the math.

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
- **State is local only.** `src/services/useStore.ts` is a zustand store persisted to AsyncStorage (session, profile, custom routines, weekly activity points). Right now login and registration only call `iniciarSesion` locally; the frontend makes **no HTTP calls to the Django backend**. Connecting them is open work.
- **Pose tracking runs inside a WebView.** `src/services/mediapipeWebView.ts` builds the shared HTML used by both `ModalCamaraBiomecanica.tsx` and `PantallaCamaraBiometrica.tsx`. It loads MediaPipe Pose from jsDelivr, posts landmarks through `window.ReactNativeWebView.postMessage`, and exposes `window.detenerCamara` / `reanudarCamara` / `toggleCameraFacing`. Screens must inject `SCRIPT_DETENER_CAMARA` before unmounting, or the next open finds the camera busy.
- `src/services/exerciseEngine.ts` (`ExerciseEngine.processLandmarks`) uses one body side per chain, a per-exercise config (`EXERCISE_CONFIG`: joints, start/target/finish angles, form rules with tips), and a rep state machine (`readyUp/descending/bottom/ascending`). A rep counts only with full range, a return to finish, no sustained form errors, and a minimum duration; otherwise it is reported as rejected with a reason. `getSessionSummary()` feeds the end-of-set recommendations. Voice feedback uses `expo-speech`.
- Backend URL comes from `EXPO_PUBLIC_API_URL` in `frontend/.env.local` via `src/services/apiConfig.ts`.
- `exerciseEngine.ts` / `exerciseEngine.js` at the repo root are stale copies that differ from `frontend/src/services/exerciseEngine.ts`. Edit the one under `frontend/src/services/`.
- Theme colors live in `src/theme/colors.ts`. Domain models (`Usuario`, `Rutina`, `Ejercicio`) are in `src/models/`.
