// Studio F360 · /rolunk: a statikus Rólunk oldal, a csapat-névsor a foglaló kollégáiból (functions/_lib/rolunk.js).
// A _routes.json csak a /rolunk utat küldi ide; a /rolunk.html → /rolunk átirányítást továbbra is a
// statikus kiszolgálás végzi. Hiba esetén a statikus oldal megy ki változatlanul.
import { rolunkValasz } from './_lib/rolunk.js';

export const onRequest = (context) => rolunkValasz(context);
