// GET /api/me → { email }
import { json, methods } from '../_lib/http.js';

export const onRequest = methods({
  GET: async ({ data }) => json({ email: data.email }),
});
