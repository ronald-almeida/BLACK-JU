import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';

function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('Saúde distingue configuração de autenticação sem gerar Pix nem revelar credenciais', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.QUANTUMPAY_API_KEY, secret: process.env.QUANTUMPAY_API_SECRET };
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++; assert.equal(url, 'https://api.quantumpay.com.br/api/auth');
    return Response.json({ success: true, token: 'health_test_bearer_private', tokenType: 'Bearer', expiresIn: 1800000 });
  };
  try {
    delete process.env.QUANTUMPAY_API_KEY;
    let res = response(); await health({ method: 'GET', url: '/api/health' }, res);
    assert.equal(res.code, 503); assert.deepEqual(res.body, { provider: 'QuantumPay', configured: false }); assert.equal(calls, 0);
    process.env.QUANTUMPAY_API_KEY = 'pk_test_health'; process.env.QUANTUMPAY_API_SECRET = 'sk_test_health';
    res = response(); await health({ method: 'GET', url: '/api/health' }, res);
    assert.equal(res.code, 200); assert.equal(res.body.authenticated, undefined); assert.equal(calls, 0);
    res = response(); await health({ method: 'GET', url: '/api/health?check=provider' }, res);
    assert.equal(res.code, 200); assert.deepEqual(res.body, { provider: 'QuantumPay', configured: true, authenticated: true }); assert.equal(calls, 1);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    res = response(); await health({ method: 'POST', url: '/api/health?check=provider' }, res);
    assert.equal(res.code, 405); assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [['QUANTUMPAY_API_KEY', previous.key], ['QUANTUMPAY_API_SECRET', previous.secret]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
