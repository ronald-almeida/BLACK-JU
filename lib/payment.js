import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateCustomer } from '../public/validation.js';
import catalog from '../public/catalog.json' with { type: 'json' };
import { PaymentError } from './payment-error.js';
import { quantumCredentials, quantumPay } from './quantumpay.js';
export { PaymentError } from './payment-error.js';

export function getProduct(productId) {
  const product = catalog.find(item => item.id === productId);
  if (!product) throw new PaymentError('Produto não encontrado. Volte ao catálogo e escolha uma oferta.', 400, true);
  return product;
}

function normalizeCustomer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PaymentError('Preencha seus dados.', 400, true);
  const limits = { name: 120, email: 254, confirmEmail: 254, document: 18, phone: 20 };
  const customer = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new PaymentError('Confira os dados do comprador.', 400, true);
    customer[key] = input[key].trim();
  }
  customer.email = customer.email.toLowerCase();
  const errors = validateCustomer(customer);
  if (/[a-z]/i.test(customer.document)) errors.document = 'Este pagamento aceita CPF ou CNPJ numérico.';
  if (Object.keys(errors).length) throw new PaymentError(Object.values(errors)[0], 400, true);
  customer.document = customer.document.replace(/\D/g, '');
  customer.phone = customer.phone.replace(/\D/g, '');
  return customer;
}

function signature(content) {
  return createHmac('sha256', quantumCredentials().apiSecret).update('black-ju-quantumpay-receipt-v2:').update(content).digest('base64url');
}

export function createReceipt(transactionId, product, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ provider: 'quantumpay', transactionId, productId: product.id, amount: product.amount, expiresAt: now + 7 * 86400000 })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function readReceipt(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) throw new PaymentError('Referência de pagamento inválida.', 401);
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra) throw new PaymentError('Referência de pagamento inválida.', 401);
  let receipt;
  try { receipt = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new PaymentError('Referência de pagamento inválida.', 401); }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.provider !== 'quantumpay') throw new PaymentError('Referência de pagamento inválida.', 401);
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new PaymentError('Referência de pagamento inválida.', 401);
  const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
  if (typeof receipt.transactionId !== 'string' || !validId.test(receipt.transactionId) || receipt.amount !== getProduct(receipt.productId).amount || !Number.isFinite(receipt.expiresAt) || receipt.expiresAt <= now) {
    throw new PaymentError('Referência de pagamento expirada ou inválida.', 401);
  }
  return receipt;
}

export function crc16(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function validatePixCode(code, amount) {
  if (typeof code !== 'string' || code.length > 4096 || !code.startsWith('000201') || !/6304[0-9a-f]{4}$/i.test(code) || crc16(code.slice(0, -4)) !== code.slice(-4).toUpperCase()) {
    throw new PaymentError('A cobrança foi solicitada, mas o código Pix não pôde ser validado. Não repita a compra; verifique com o vendedor.');
  }
  const bytes = Buffer.from(code, 'utf8');
  const fields = new Map();
  for (let offset = 0; offset < bytes.length;) {
    const tag = bytes.subarray(offset, offset + 2).toString();
    const lengthText = bytes.subarray(offset + 2, offset + 4).toString();
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) throw new PaymentError('Código Pix inválido. Verifique com o vendedor.');
    const length = Number(lengthText);
    if (offset + 4 + length > bytes.length || fields.has(tag)) throw new PaymentError('Código Pix inválido. Verifique com o vendedor.');
    fields.set(tag, bytes.subarray(offset + 4, offset + 4 + length).toString('utf8'));
    offset += length + 4;
  }
  if (fields.get('53') !== '986' || fields.get('58') !== 'BR' || !code.toLowerCase().includes('br.gov.bcb.pix')) throw new PaymentError('Código Pix inválido. Verifique com o vendedor.');
  if (fields.has('54') && Math.round(Number(fields.get('54')) * 100) !== amount) throw new PaymentError('O valor retornado não corresponde à compra. Verifique com o vendedor.');
  return code;
}

export async function createPayment(productId, customerInput, storeUrl, fetchImpl = fetch) {
  const product = getProduct(productId);
  const customer = normalizeCustomer(customerInput);
  if (!storeUrl.startsWith('https://')) throw new PaymentError('O checkout precisa de uma conexão segura.', 400, true);
  const title = product.checkoutName || product.name;
  const result = await quantumPay(fetchImpl).request('/api/v1/pix/in/qrcode', {
    method: 'POST',
    body: JSON.stringify({
      amountInCents: product.amount,
      description: `${title} | Black Dobrada da Ju`.slice(0, 140),
      customer: { name: customer.name, email: customer.email, documentType: customer.document.length === 11 ? 'cpf' : 'cnpj', document: customer.document, phone: customer.phone },
      items: [{ title, tangible: false, quantity: 1, amountInCents: product.amount }],
    }),
  });
  const transaction = result.data;
  if (result.success !== true || typeof transaction?.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(transaction.id) || transaction.status !== 'pending' || !validQuantumAmount(transaction, product.amount, false)) {
    throw new PaymentError('A resposta da cobrança precisa ser verificada. Não repita a compra; entre em contato com o vendedor.');
  }
  const copyPaste = validatePixCode(transaction.pix?.emv, product.amount);
  return {
    amount: product.amount,
    productId: product.id,
    copyPaste,
    token: createReceipt(transaction.id, product),
    expiresAt: typeof transaction.expiresAt === 'string' && Number.isFinite(Date.parse(transaction.expiresAt)) ? transaction.expiresAt : null,
    status: 'pending',
  };
}

export async function getPaymentStatus(token, fetchImpl = fetch) {
  const receipt = readReceipt(token);
  const result = await quantumPay(fetchImpl).request(`/api/v1/transactions/${encodeURIComponent(receipt.transactionId)}`);
  const transaction = result.data ?? result.transaction ?? result;
  if (transaction?.id !== receipt.transactionId || !validQuantumAmount(transaction, receipt.amount, true)) {
    throw new PaymentError('Não foi possível validar o status do pagamento.');
  }
  const statuses = { pending: 'pending', paid: 'paid', canceled: 'cancelled', refunded: 'cancelled', expired: 'expired' };
  const status = Object.hasOwn(statuses, transaction.status) ? statuses[transaction.status] : null;
  if (!status) throw new PaymentError('Status de pagamento ainda não reconhecido.');
  return { status, amount: receipt.amount };
}

function validQuantumAmount(transaction, expected, required) {
  const values = ['amountInCents', 'amount'].filter(key => Object.hasOwn(transaction, key)).map(key => transaction[key]);
  return (!required || values.length > 0) && values.every(value => Number.isSafeInteger(value) && value === expected);
}
