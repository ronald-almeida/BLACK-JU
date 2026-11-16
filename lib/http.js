import { PaymentError } from './payment.js';

export function secure(response) {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

export function readPost(request) {
  if (request.method !== 'POST') throw new PaymentError('Método não permitido.', 405, true);
  const origin = request.headers.origin;
  const host = request.headers.host;
  const validHost = typeof host === 'string' && /^[a-z0-9.-]+(?::\d+)?$/i.test(host);
  const validOrigin = validHost && (origin === `https://${host}` || (!process.env.VERCEL && ['http://127.0.0.1:4173', 'http://localhost:4173'].includes(origin)));
  if (!validOrigin || request.headers['sec-fetch-site'] === 'cross-site') throw new PaymentError('Origem não autorizada.', 403, true);
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new PaymentError('Formato de requisição inválido.', 415, true);
  let body = request.body;
  if (Number(request.headers['content-length']) > 4096) throw new PaymentError('Requisição muito grande.', 413, true);
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 4096) throw new PaymentError('Requisição muito grande.', 413, true);
    try { body = JSON.parse(body); } catch { throw new PaymentError('Dados inválidos.', 400, true); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PaymentError('Dados inválidos.', 400, true);
  if (Buffer.byteLength(JSON.stringify(body)) > 4096) throw new PaymentError('Requisição muito grande.', 413, true);
  return body;
}

export function storeUrl(request) {
  const configured = process.env.STORE_URL?.trim();
  if (configured) return new URL(configured).origin;
  const canonical = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (canonical) return `https://${canonical}`;
  return `https://${request.headers.host}`;
}

export function sendError(response, error) {
  if (error instanceof PaymentError) return response.status(error.status).json({ error: error.message, retryable: error.retryable });
  console.error('checkout_error', { type: error?.name ?? 'UnknownError' });
  return response.status(500).json({ error: 'Não foi possível concluir a operação. Verifique com o vendedor antes de tentar novamente.', retryable: false });
}
