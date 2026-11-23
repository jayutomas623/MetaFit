/**
 * URL base del backend Django.
 *
 * Se configura en frontend/.env.local (ver .env.local.example):
 *   EXPO_PUBLIC_API_URL=http://<IP-de-tu-laptop>:8000
 *
 * En Expo Go el celular NO puede usar 127.0.0.1/localhost (apuntaría al propio
 * celular): debe ser la IP de la laptop en la misma red Wi-Fi.
 *
 * Nota: a la fecha la app aún no hace peticiones al backend (sesión local con zustand);
 * cualquier llamada futura debe construir sus URLs a partir de API_URL.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');

export const API_USUARIOS = `${API_URL}/api/usuarios`;
