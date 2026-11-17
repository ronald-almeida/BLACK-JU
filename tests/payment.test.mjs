import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPayment, getPaymentStatus, createReceipt, readReceipt, crc16, validatePixCode, PaymentError } from '../lib/payment.js';
import { readPost } from '../lib/http.js';
import catalog from '../public/catalog.json' with { type: 'json' };

// Synthetic fixtures never leave this process. No live charge is generated.
const customer = { name: 'Pessoa Teste', email: 'teste@example.com', confirmEmail: 'teste@example.com', document: '52998224725', phone: '11999999999' };
const field = (tag, value) => tag + Buffer.byteLength(value).toString().padStart(2, '0') + value;
function pixCode(cents) {
  const text = field('00', '01') + field('26', field('00', 'br.gov.bcb.pix') + field('01', 'teste@example.com')) + field('52', '0000') + field('53', '986') + field('54', (cents / 100).toFixed(2)) + field('58', 'BR') + field('59', 'TESTE') + field('60', 'SAO PAULO') + field('62', field('05', 'TEST')) + '6304';
  return text + crc16(text);
}
const auth = () => Response.json({ success: true, token: 'synthetic_bearer_token', tokenType: 'Bearer', expiresIn: 1800000 });
const fake = (amount, extra = {}) => ({ success: true, data: { id: 'trx_test_12345', pix: { emv: pixCode(amount) }, status: 'pending', fees: 0, ...extra } });
const provider = handler => async (url, init) => url.endsWith('/api/auth') ? auth() : handler(url, init);
process.env.QUANTUMPAY_API_KEY = 'pk_test_only_not_a_real_key';
process.env.QUANTUMPAY_API_SECRET = 'sk_test_only_not_a_real_secret';
process.env.FIREBOT_API_KEY = 'fire_sk_live_test_only_not_a_real_key';

test('Cria todas as 20 ofertas em centavos pela QuantumPay, sem aceitar preço do cliente', async () => {
  for (const product of catalog) {
    let calls = 0;
    const result = await createPayment(product.id, { ...customer, amount: 1 }, 'https://black-ju.example', provider(async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.quantumpay.com.br/api/v1/pix/in/qrcode');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, 'Bearer synthetic_bearer_token');
      const body = JSON.parse(init.body);
      assert.equal(body.amountInCents, product.amount);
      assert.equal(body.customer.document, customer.document);
      assert.equal(body.customer.documentType, 'cpf');
      assert.equal(body.customer.phone, customer.phone);
      assert.equal(body.customer.confirmEmail, undefined);
      assert.deepEqual(body.items, [{ title: product.checkoutName || product.name, tangible: false, quantity: 1, amountInCents: product.amount }]);
      assert(body.description.length <= 140);
      return Response.json(fake(product.amount));
    }));
    assert.equal(calls, 1); assert.equal(result.amount, product.amount); assert.equal(result.status, 'pending'); assert.equal(result.expiresAt, null);
    assert.equal(readReceipt(result.token).provider, 'quantumpay'); assert.equal(readReceipt(result.token).productId, product.id);
    assert(!JSON.stringify(result).includes(process.env.QUANTUMPAY_API_SECRET));
  }
});
test('Envia CNPJ como cnpj e respeita expiração informada pelo provedor', async () => {
  const result = await createPayment(catalog[0].id, { ...customer, document: '11222333000181' }, 'https://example.com', provider(async (_url, init) => {
    assert.equal(JSON.parse(init.body).customer.documentType, 'cnpj');
    return Response.json(fake(39700, { expiresAt: '2026-11-17T12:00:00.000Z' }));
  }));
  assert.equal(result.expiresAt, '2026-11-17T12:00:00.000Z');
});
test('Dados inválidos e origem insegura são rejeitados antes de autenticar ou cobrar', async () => {
  let calls = 0; const fetcher = () => { calls++; throw new Error('Must not be called'); };
  for (const [id, buyer] of [['missing', customer], [catalog[0].id, { ...customer, document: '11111111111' }], [catalog[0].id, { ...customer, confirmEmail: 'outro@example.com' }], [catalog[0].id, { ...customer, name: 'a'.repeat(121) }]]) {
    await assert.rejects(createPayment(id, buyer, 'https://example.com', fetcher), error => error.status === 400 && error.retryable);
  }
  await assert.rejects(createPayment(catalog[0].id, customer, 'http://example.com', fetcher), PaymentError); assert.equal(calls, 0);
});
test('Não aceita QR com CRC incorreto ou valor diferente', () => {
  assert.equal(validatePixCode(pixCode(39700), 39700), pixCode(39700));
  assert.throws(() => validatePixCode(pixCode(49700), 39700), PaymentError);
  assert.throws(() => validatePixCode(pixCode(39700).slice(0, -1) + 'Z', 39700), PaymentError);
});
test('Criação rejeita respostas inconsistentes, status pago e identificadores inválidos', async () => {
  for (const response of [fake(1), fake(39700, { amountInCents: 397 }), fake(39700, { amount: 1 }), fake(39700, { amountInCents: 39700, amount: 397 }), fake(39700, { id: '../wrong' }), fake(39700, { id: null }), fake(39700, { status: 'paid' }), fake(39700, { pix: {} }), { success: true }, { success: false, data: fake(39700).data }]) {
    await assert.rejects(createPayment(catalog[0].id, customer, 'https://example.com', provider(async () => Response.json(response))), error => error instanceof PaymentError && !error.retryable);
  }
});
test('Token adulterado, expirado ou vinculado a outro provedor não permite consultar', async () => {
  const token = createReceipt('trx_test_12345', catalog[0]); assert.equal(readReceipt(token).amount, 39700);
  let calls = 0; await assert.rejects(getPaymentStatus(token + 'bad', () => { calls++; }), PaymentError); assert.equal(calls, 0);
  assert.throws(() => readReceipt(createReceipt('trx_test_12345', catalog[0], 0)), PaymentError);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), provider: 'firebot' })).toString('base64url');
  assert.throws(() => readReceipt(forged + '.' + signature), PaymentError);
});
test('Consulta confirma apenas ID, valor em centavos e status reconhecido', async () => {
  const token = createReceipt('trx_test_12345', catalog[0]);
  for (const [status, expected] of Object.entries({ pending: 'pending', paid: 'paid', canceled: 'cancelled', refunded: 'cancelled', expired: 'expired' })) {
    for (const field of ['amountInCents', 'amount']) {
      const result = await getPaymentStatus(token, provider(async (url, init) => {
        assert.equal(url, 'https://api.quantumpay.com.br/api/v1/transactions/trx_test_12345'); assert.equal(init.method, 'GET');
        return Response.json({ success: true, data: { id: 'trx_test_12345', [field]: 39700, status } });
      }));
      assert.deepEqual(result, { status: expected, amount: 39700 });
    }
  }
  for (const transaction of [{ id: 'trx_other', amount: 39700, status: 'paid' }, { id: 'trx_test_12345', amount: 397, status: 'paid' }, { id: 'trx_test_12345', amount: '39700', status: 'paid' }, { id: 'trx_test_12345', amount: 39700, amountInCents: 1, status: 'paid' }, { id: 'trx_test_12345', status: 'paid' }, { id: 'trx_test_12345', amount: 39700, status: 'toString' }, { amount: 39700, status: 'paid' }]) {
    await assert.rejects(getPaymentStatus(token, provider(async () => Response.json({ data: transaction }))), PaymentError);
  }
});
test('Cobranças Firebot anteriores continuam sendo consultadas sem credenciais QuantumPay', async () => {
  const payload = Buffer.from(JSON.stringify({ transactionId: 'fire_tx_old_12345', productId: catalog[0].id, amount: 39700, expiresAt: Date.now() + 86400000 })).toString('base64url');
  const signature = createHmac('sha256', process.env.FIREBOT_API_KEY).update('black-ju-receipt-v1:').update(payload).digest('base64url');
  const key = process.env.QUANTUMPAY_API_KEY; delete process.env.QUANTUMPAY_API_KEY;
  try {
    const result = await getPaymentStatus(payload + '.' + signature, async (url, init) => {
      assert.equal(url, 'https://firebotbr.com/api/v1/pix/fire_tx_old_12345'); assert.notEqual(init.method, 'POST'); assert.equal(init.headers['x-api-key'], process.env.FIREBOT_API_KEY);
      return Response.json({ transaction: { transactionId: 'fire_tx_old_12345', amount: 397, status: 'PAID' } });
    });
    assert.deepEqual(result, { status: 'paid', amount: 39700 });
  } finally { process.env.QUANTUMPAY_API_KEY = key; }
});
test('Falha de rede após envio não repete a cobrança nem habilita nova compra', async () => {
  let calls = 0;
  await assert.rejects(createPayment(catalog[0].id, customer, 'https://example.com', provider(async () => { calls++; throw new Error('timeout'); })), error => error.retryable === false);
  assert.equal(calls, 1);
});
test('Sem qualquer uma das credenciais, não chama nenhum provedor nem usa Firebot como fallback', async () => {
  for (const name of ['QUANTUMPAY_API_KEY', 'QUANTUMPAY_API_SECRET']) {
    const value = process.env[name]; delete process.env[name]; let calls = 0;
    try {
      await assert.rejects(createPayment(catalog[0].id, customer, 'https://example.com', async () => { calls++; }), error => error.status === 503 && error.retryable);
      assert.equal(calls, 0);
    } finally { process.env[name] = value; }
  }
});
test('Protege método, origem, JSON e tamanho da requisição', () => {
  const request = { method: 'POST', headers: { host: 'black-ju.example', origin: 'https://black-ju.example', 'content-type': 'application/json' }, body: { productId: catalog[0].id, customer } };
  assert.equal(readPost(request).productId, catalog[0].id);
  for (const bad of [{ ...request, method: 'GET' }, { ...request, headers: { ...request.headers, origin: 'https://attacker.example' } }, { ...request, body: 'x'.repeat(4097) }, { ...request, body: '{' }, { ...request, headers: { ...request.headers, 'content-type': 'text/plain' } }]) assert.throws(() => readPost(bad), PaymentError);
});
