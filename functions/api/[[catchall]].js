// Minden más /api/* út: JSON 404 (ne essen át a statikus 404.html-re vagy a főoldalra)
import { json } from '../_lib/http.js';

export const onRequest = () => json({ error: 'Ismeretlen API-végpont.' }, 404);
