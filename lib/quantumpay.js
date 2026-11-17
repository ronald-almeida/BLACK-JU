import { PaymentError } from './payment-error.js';

const API_BASE = 'https://api.quantumpay.com.br';
const clients = new WeakMap();

export function quantumCredentials() {
  const apiKey = process.env.QUANTUMPAY_API_KEY?.trim();
  const apiSecret = process.env.QUANTUMPAY_API_SECRET?.trim();
  if (!apiKey || !apiSecret || /[:\s]/.test(apiKey) || /\s/.test(apiSecret)) {
    throw new PaymentError('O Pix está temporariamente indisponível. Tente novamente mais tarde.', 503, true);
  }
  return { apiKey, apiSecret };
}

export function createQuantumPayClient(fetchImpl = fetch, now = Date.now) {
  let cached, pending;

  async function call(path, options, operation) {
    let response;
    try {
      response = await fetchImpl(`${API_BASE}${path}`, { ...options, redirect: 'error' });
    } catch {
      throw new PaymentError(operation === 'auth'
        ? 'Não foi possível conectar ao serviço de pagamento. Tente novamente em instantes.'
        : 'Não foi possível confirmar a resposta da cobrança. Não repita a compra agora; verifique com o suporte.', 502, operation === 'auth');
    }
    if (!response.ok) {
      // Never log provider bodies: they may echo credentials or customer information.
      console.error('quantumpay_http_error', { status: response.status, operation });
      let error;
      if (response.status === 401 || response.status === 403 || operation === 'auth') {
        error = new PaymentError('O Pix está temporariamente indisponível. Tente novamente mais tarde.', 503, true);
      } else if (response.status === 400 || response.status === 422) {
        error = new PaymentError('O serviço de pagamento recusou a geração do Pix. Confira seus dados ou entre em contato com o suporte.', 422, true);
      } else if (response.status === 429) {
        error = new PaymentError('O serviço de pagamento está ocupado. Aguarde um minuto antes de tentar novamente.', 429, true);
      } else {
        error = new PaymentError('O serviço não confirmou a operação. Aguarde e verifique com o suporte antes de repetir a compra.');
      }
      error.providerStatus = response.status;
      throw error;
    }
    let payload;
    try {
      const text = await response.text();
      if (text.length > 262144) throw new Error();
      payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.success === false) throw new Error();
    } catch {
      throw new PaymentError('Resposta inválida do serviço de pagamento. Verifique com o suporte.', 502, operation === 'auth');
    }
    return payload;
  }

  async function getToken() {
    const { apiKey, apiSecret } = quantumCredentials();
    const matches = value => value?.apiKey === apiKey && value?.apiSecret === apiSecret;
    if (matches(cached) && cached.expiresAt > now()) return cached.token;
    if (matches(pending)) return pending.promise;
    const entry = { apiKey, apiSecret };
    pending = entry;
    entry.promise = (async () => {
      const startedAt = now();
      const result = await call('/api/auth', {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`, 'content-type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(8000),
      }, 'auth');
      if (result.success !== true || result.tokenType !== 'Bearer' || typeof result.token !== 'string' || !result.token || /\s/.test(result.token) || result.token.length > 8192 || !Number.isFinite(result.expiresIn) || result.expiresIn <= 60000) {
        throw new PaymentError('Não foi possível autenticar o serviço de pagamento.', 503, true);
      }
      // expiresIn is in milliseconds, not seconds. Renew one minute early.
      if (pending === entry) cached = { apiKey, apiSecret, token: result.token, expiresAt: startedAt + Math.min(result.expiresIn, 1800000) - 60000 };
      return result.token;
    })();
    try { return await entry.promise; }
    finally { if (pending === entry) pending = undefined; }
  }

  async function request(path, options = {}) {
    const method = options.method || 'GET';
    const deadline = AbortSignal.timeout(21000);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken();
      if (deadline.aborted) throw new PaymentError('O serviço demorou para responder. Tente novamente em instantes.', 503, method === 'POST' && attempt === 0);
      try {
        return await call(path, {
          ...options, method,
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
          signal: AbortSignal.any([deadline, AbortSignal.timeout(16000)]),
        }, method === 'POST' ? 'create' : 'status');
      } catch (error) {
        if (error.providerStatus === 401 && cached?.token === token) cached = undefined;
        // Only read requests are retried automatically. A charge is never resent.
        if (method === 'GET' && error.providerStatus === 401 && attempt === 0) continue;
        throw error;
      }
    }
  }
  return { getToken, request };
}

export function quantumPay(fetchImpl = fetch) {
  if (!clients.has(fetchImpl)) clients.set(fetchImpl, createQuantumPayClient(fetchImpl));
  return clients.get(fetchImpl);
}
