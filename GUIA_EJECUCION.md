# Guía de ejecución de MetaFit (laptop con Windows + celular con Expo Go)

Esta guía levanta el backend (Django) y el frontend (Expo / React Native) en una laptop y prueba la app desde el celular con **Expo Go**.

> **Antes de empezar**
> - **Python 3.11 o 3.12.** Versiones más nuevas (3.13, 3.14) suelen no tener paquetes de `torch` ni `mediapipe`.
> - **Node.js 20 o superior** y `npm`.
> - **Expo Go compatible con Expo SDK 58**, que es el SDK que usa el proyecto.
> - La laptop y el celular deben estar **en la misma red Wi-Fi**.

---

## Paso 0: clonar el repositorio y anotar la IP de la laptop

```powershell
git clone https://github.com/jayutomas623/MetaFit.git MetaFit
cd MetaFit
ipconfig
```

En la salida de `ipconfig`, busquen el adaptador **Wi-Fi** y anoten la **Dirección IPv4** (por ejemplo `192.168.1.50`). La necesitan en los pasos siguientes.

---

## Pestaña 1: Backend (Django), en la carpeta `MetaFit\backend`

```powershell
cd backend
py -3.12 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000
```

- **Error de permisos al activar el entorno en PowerShell:** ejecuten una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y repitan `venv\Scripts\activate`.
- **`0.0.0.0:8000`:** hace que Django escuche en la red local, no solo en la laptop, para que los celulares puedan conectarse.
- **Superusuario:** `createsuperuser` crea la cuenta con `rol = Usuario`, el valor por defecto. Si debe ser administrador de la app, cámbienle el rol en el panel `http://127.0.0.1:8000/admin/`.
- **Pruebas del backend:** `python manage.py test usuarios`.

### Abrir el puerto 8000 en el firewall (una sola vez)

En una terminal **como administrador**:

```powershell
netsh advfirewall firewall add rule name="Django 8000" dir=in action=allow protocol=TCP localport=8000
```

La red Wi-Fi debe estar configurada como **Privada** en Windows.

### Comprobar la conexión desde el celular

Abran `http://<IP-de-la-laptop>:8000/admin/` en el navegador del celular. Si carga la página del panel, la red está bien.

---

## Pestaña 2: Frontend (Expo), en la carpeta `MetaFit\frontend`

```powershell
cd frontend
npm install
copy .env.local.example .env.local
```

Editen `frontend/.env.local` y pongan **su** IP:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:8000
```

Luego arranquen Expo:

```powershell
npx expo start -c
```

- Usen `npx expo start -c` la primera vez y cada vez que cambien `.env.local`, porque limpia la caché. El resto de las veces basta con `npm start`.
- **No usen `localhost` ni `127.0.0.1`** en `.env.local`: en el celular esas direcciones apuntan al propio teléfono, no a la laptop.
- `.env.local` está en `.gitignore`: cada integrante pone su propia IP y no se sube al repositorio.
- La URL se lee en `frontend/src/services/apiConfig.ts`. Cualquier llamada futura al backend debe construirse a partir de `API_URL`.

> **Estado actual:** la app todavía **no hace peticiones al backend**. El login y el registro guardan la sesión solo en el celular, así que la app funciona en Expo Go aunque Django esté apagado. La IP queda configurada para cuando se conecte el API.

---

## Celular

1. Conecten el celular **a la misma red Wi-Fi** que la laptop.
2. Abran **Expo Go**.
3. Escaneen el código QR que muestra la terminal de la Pestaña 2:
   - **Android:** desde la propia app Expo Go.
   - **iPhone:** con la app de cámara del sistema.
   
   También pueden escribir en Expo Go la URL `exp://<IP-de-la-laptop>:8081` que aparece en la terminal.
4. Acepten el **permiso de cámara** cuando la app lo pida.
5. El celular **necesita internet**: la detección de cuerpo (MediaPipe) se descarga desde jsDelivr al abrir la cámara.

---

## Problemas frecuentes

| Problema | Solución |
|---|---|
| El QR no conecta en la red de la universidad (aísla los dispositivos) | En la Pestaña 2 usen `npm run tunnel`. El túnel solo cubre Expo, no Django. |
| El celular no abre `http://<IP>:8000/admin/` | Revisen la regla del firewall, que la red sea **Privada**, que Django corra con `0.0.0.0:8000` y que la IP sea la del adaptador Wi-Fi. |
| `pip install` falla con `torch` o `mediapipe` | Están usando una versión de Python muy nueva. Borren `venv` y créenlo con `py -3.12 -m venv venv`. |
| Error con `resnet18(pretrained=False)` al analizar imágenes | Versión de torchvision muy nueva. Fijen una versión anterior de `torchvision` en `requirements.txt`. |
| Expo Go dice que el proyecto usa un SDK incompatible | Actualicen Expo Go a una versión que soporte Expo SDK 58. |
| La app no toma los cambios de `.env.local` | Reinicien Expo con `npx expo start -c`. |
