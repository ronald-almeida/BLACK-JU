import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuantumPayClient } from '../lib/quantumpay.js';
process.env.QUANTUMPAY_API_KEY = 'pk_test_only_not_a_real_key';
process.env.QUANTUMPAY_API_SECRET = 'sk_test_only_not_a_real_secret';
const tokenResponse = token => Response.json({ success: true, token, tokenType: 'Bearer', expiresIn: 1800000 });

test('Basic Auth fica no servidor; token é compartilhado e renovado com margem em milissegundos', async () => {
  let time = 0, calls = 0;
  const client = createQuantumPayClient(async (url, init) => {
    assert.equal(url, 'https://api.quantumpay.com.br/api/auth');
    assert.equal(init.headers.authorization, 'Basic ' + Buffer.from(process.env.QUANTUMPAY_API_KEY + ':' + process.env.QUANTUMPAY_API_SECRET).toString('base64'));
    assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST');
    return tokenResponse('test_token_' + ++calls);
  }, () => time);
  assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => client.getToken())), Array(10).fill('test_token_1'));
  assert.equal(calls, 1); time = 1739999; assert.equal(await client.getToken(), 'test_token_1');
  time = 1740000; assert.equal(await client.getToken(), 'test_token_2'); assert.equal(calls, 2);
});
test('Troca de Secret invalida o cache de autenticação', async () => {
  let calls = 0; const client = createQuantumPayClient(async () => tokenResponse('token_' + ++calls));
  await client.getToken(); const old = process.env.QUANTUMPAY_API_SECRET; process.env.QUANTUMPAY_API_SECRET = 'sk_different_test_secret';
  try { assert.equal(await client.getToken(), 'token_2'); } finally { process.env.QUANTUMPAY_API_SECRET = old; }
});
test('Autenticação malsucedida não cria cobrança e não bloqueia futuras autenticações', async () => {
  let calls = 0;
  const client = createQuantumPayClient(async url => {
    calls++; assert(url.endsWith('/api/auth'));
    if (calls === 1) throw new Error('connection failed');
    return tokenResponse('test_recovered_token');
  });
  await assert.rejects(client.request('/api/v1/pix/in/qrcode', { method: 'POST', body: '{}' }), error => error.retryable === true);
  assert.equal(calls, 1); assert.equal(await client.getToken(), 'test_recovered_token');
});
test('Resposta de autenticação inválida nunca vira Bearer de uma cobrança', async () => {
  for (const body of [{ success: true, token: 'x' }, { success: true, token: 'x', tokenType: 'Bearer', expiresIn: 1800 }, { success: true, token: 'bad\ntoken', tokenType: 'Bearer', expiresIn: 1800000 }]) {
    let calls = 0; const client = createQuantumPayClient(async () => { calls++; return Response.json(body); });
    await assert.rejects(client.request('/api/v1/pix/in/qrcode', { method: 'POST' }), error => error.status === 503 && error.retryable);
    assert.equal(calls, 1);
  }
});
test('Consulta com 401 renova uma vez; criação com 401 nunca é reenviada automaticamente', async () => {
  const oldError = console.error; console.error = () => {};
  try {
    for (const method of ['GET', 'POST']) {
      let authCalls = 0, requests = 0;
      const client = createQuantumPayClient(async (url, init) => {
        if (url.endsWith('/api/auth')) return tokenResponse('token_' + ++authCalls);
        requests++; assert.equal(init.headers.authorization, 'Bearer token_' + authCalls);
        return requests === 1 ? Response.json({}, { status: 401 }) : Response.json({ success: true });
      });
      if (method === 'GET') {
        await client.request('/api/v1/transactions/trx_test', { method }); assert.equal(requests, 2); assert.equal(authCalls, 2);
      } else {
        await assert.rejects(client.request('/api/v1/pix/in/qrcode', { method }), error => error.retryable);
        assert.equal(requests, 1); assert.equal(authCalls, 1); assert.equal(await client.getToken(), 'token_2');
      }
    }
  } finally { console.error = oldError; }
});
test('Erros não vazam credenciais ou dados pessoais e não repetem operações incertas', async () => {
  const oldError = console.error; const logs = []; console.error = (...args) => logs.push(args);
  try {
    for (const status of [400, 422, 429, 500]) {
      let calls = 0;
      const client = createQuantumPayClient(async url => {
        if (url.endsWith('/api/auth')) return tokenResponse('test_private_bearer');
        calls++;
        return Response.json({ error: process.env.QUANTUMPAY_API_SECRET + ' test_private_bearer teste@example.com 52998224725' }, { status });
      });
      await assert.rejects(client.request('/api/v1/pix/in/qrcode', { method: 'POST' }), error => error.retryable === (status !== 500));
      assert.equal(calls, 1);
    }
    const text = JSON.stringify(logs);
    for (const secret of [process.env.QUANTUMPAY_API_SECRET, 'test_private_bearer', 'teste@example.com', '52998224725']) assert(!text.includes(secret));
  } finally { console.error = oldError; }
});
