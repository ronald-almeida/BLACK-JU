import { quantumCredentials, quantumPay } from '../lib/quantumpay.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ error: 'Método não permitido.' });
  let configured = false;
  try { quantumCredentials(); configured = true; } catch { /* No secrets in the response. */ }
  const status = { provider: 'QuantumPay', configured };
  if (!configured) return response.status(503).json(status);
  if (new URL(request.url, 'http://localhost').searchParams.get('check') === 'provider') {
    try { await quantumPay().getToken(); status.authenticated = true; }
    catch { return response.status(503).json({ ...status, authenticated: false }); }
  }
  return response.status(200).json(status);
}
