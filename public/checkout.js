import { validateCustomer, formatDocument, formatPhone } from './validation.js';

const $ = id => document.getElementById(id);
const currency = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let product, payment, busy = false, checking = false, timer, uncertain = false;
const productId = new URLSearchParams(location.search).get('produto');
const storageKey = `black-ju:payment:${productId}`;
const storage = {
  get() { try { return JSON.parse(sessionStorage.getItem(storageKey)); } catch { return null; } },
  set(value) { try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* In-memory state remains usable. */ } },
};

function showError(message) { $('form-error').textContent = message; }
function setFieldsLocked(locked) {
  for (const input of document.querySelectorAll('#checkout-form input:not([type=radio])')) input.disabled = locked;
}
function updateStatus(status) {
  const messages = {
    pending: 'Aguardando o pagamento. A confirmação pode levar alguns instantes.',
    paid: 'Pagamento confirmado! O vendedor orientará o acesso ao conteúdo pelo email informado.',
    cancelled: 'Pagamento cancelado. Entre em contato com o vendedor antes de gerar outra cobrança.',
    expired: 'Este Pix expirou. Não pague este código. Entre em contato com o vendedor.',
  };
  $('payment-status').textContent = messages[status] || messages.pending;
  $('payment-status').className = status === 'paid' ? 'paid' : '';
  $('check-status').hidden = status !== 'pending';
  $('copy-pix').disabled = status !== 'pending';
  if (status !== 'pending') {
    clearTimeout(timer);
    $('qr-area').hidden = true;
    $('pix-code').hidden = true;
    document.querySelector('label[for="pix-code"]').hidden = true;
    $('generate').textContent = status === 'paid' ? 'Pagamento confirmado ✓' : 'Cobrança encerrada';
  }
}
function renderPayment() {
  setFieldsLocked(true);
  $('generate').disabled = true;
  $('generate').textContent = 'Código Pix gerado';
  $('pix-code').value = payment.copyPaste;
  $('payment-result').hidden = false;
  const qr = window.qrcode(0, 'M');
  qr.addData(payment.copyPaste, 'Byte'); qr.make();
  const img = document.createElement('img');
  img.src = qr.createDataURL(5, 20); img.alt = `QR code Pix de ${currency(product.amount)}`;
  img.width = 132; img.height = 132;
  $('qr-area').replaceChildren(img);
  $('expires-at').textContent = payment.expiresAt ? `Válido até ${new Date(payment.expiresAt).toLocaleString('pt-BR')}.` : '';
  updateStatus(payment.status);
  if (payment.status === 'pending') scheduleStatus();
}
async function request(path, body, timeout = 27000) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível confirmar a operação. Verifique com o vendedor.');
    error.retryable = data.retryable === true;
    throw error;
  }
  return data;
}
function scheduleStatus() {
  clearTimeout(timer);
  if (!document.hidden && payment?.status === 'pending') timer = setTimeout(() => checkStatus(false), 8000);
}
async function checkStatus(manual = true) {
  if (!payment || checking || payment.status !== 'pending') return;
  checking = true;
  $('check-status').disabled = true;
  if (manual) $('payment-status').textContent = 'Consultando o pagamento…';
  try {
    const result = await request('/api/pix-status', { token: payment.token }, 23000);
    if (result.amount !== product.amount || !['pending', 'paid', 'cancelled', 'expired'].includes(result.status)) throw new Error('Não foi possível validar a confirmação do pagamento.');
    payment.status = result.status;
    storage.set({ payment }); updateStatus(result.status);
  } catch (error) {
    if (manual) $('payment-status').textContent = 'Não foi possível consultar agora. Se você já pagou, não pague novamente. Tente consultar em instantes.';
  } finally { checking = false; $('check-status').disabled = false; scheduleStatus(); }
}

$('checkout-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!product || busy || payment || uncertain) return;
  const customer = Object.fromEntries(new FormData(event.currentTarget));
  customer.email = customer.email.trim().toLowerCase();
  customer.confirmEmail = customer.confirmEmail.trim().toLowerCase();
  const errors = validateCustomer(customer);
  if (/[a-z]/i.test(customer.document)) errors.document = 'Este pagamento aceita CPF ou CNPJ numérico.';
  for (const id of ['email', 'confirm-email', 'name', 'document', 'phone']) {
    $(id).setAttribute('aria-invalid', String(Boolean(errors[id])));
    $(`${id}-error`).textContent = errors[id] || '';
  }
  if (Object.keys(errors).length) { $(Object.keys(errors)[0]).focus(); return; }
  busy = true; showError(''); $('generate').disabled = true; $('generate').textContent = 'Gerando Pix…';
  // Persist before sending: an interrupted tab must not silently create a second charge.
  storage.set({ uncertain: true });
  try {
    const result = await request('/api/pix', { productId: product.id, customer });
    if (result.amount !== product.amount || !result.copyPaste || !result.token) throw new Error('A resposta precisa ser conferida com o vendedor antes de repetir a compra.');
    payment = result; storage.set({ payment }); renderPayment();
  } catch (error) {
    uncertain = error.retryable !== true;
    storage.set({ uncertain });
    showError(error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError ? 'Não foi possível confirmar a resposta da cobrança. Não repita a compra agora; verifique com o vendedor.' : error.message);
    $('generate').disabled = uncertain;
    $('generate').textContent = uncertain ? 'Verifique a cobrança com o vendedor' : 'Gerar código QR';
    $('form-error').focus();
  } finally { busy = false; }
});
$('document').addEventListener('input', event => { event.target.value = formatDocument(event.target.value); });
$('phone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); });
$('check-status').addEventListener('click', () => checkStatus());
$('copy-pix').addEventListener('click', async () => {
  if (!payment || payment.status !== 'pending') return;
  try { await navigator.clipboard.writeText(payment.copyPaste); $('copy-feedback').textContent = 'Código Pix copiado!'; }
  catch { $('pix-code').focus(); $('pix-code').select(); $('copy-feedback').textContent = 'Selecione e copie o código no campo abaixo.'; }
});
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && payment?.status === 'pending') checkStatus(false); });

try {
  const response = await fetch('/catalog.json');
  if (!response.ok) throw new Error();
  const catalog = await response.json();
  product = catalog.find(item => item.id === productId);
  if (!product) { $('loading').textContent = 'Produto não encontrado. Volte aos cursos e escolha uma oferta.'; }
  else {
    const title = product.checkoutName || product.name;
    document.title = `${title} | Checkout da Ju`;
    $('product-name').textContent = title;
    $('detail-name').textContent = title;
    $('product-price').textContent = $('detail-price').textContent = currency(product.amount);
    for (const [index, src] of (product.images || [product.image]).entries()) {
      const img = document.createElement('img'); img.src = src; img.alt = index === 0 ? `Capa de ${product.name}` : ''; $('product-art').append(img);
    }
    if (product.includes.length) {
      $('included-items').hidden = false;
      for (const name of [...product.includes, ...(product.gift ? [product.gift] : [])]) {
        const li = document.createElement('li'); li.textContent = name; $('included-items').append(li);
      }
    }
    $('loading').hidden = true; $('purchase').hidden = false;
    const saved = storage.get();
    if (saved?.payment?.amount === product.amount && saved.payment.token && saved.payment.copyPaste) {
      payment = saved.payment; renderPayment();
      if (payment.status === 'pending') checkStatus(false);
    } else if (saved?.uncertain) {
      uncertain = true; $('generate').disabled = true;
      $('generate').textContent = 'Verifique a cobrança com o vendedor';
      showError('Uma solicitação anterior ficou sem confirmação. Verifique com o vendedor antes de repetir a compra.');
    }
  }
} catch {
  $('loading').textContent = 'Não foi possível carregar a compra. Atualize a página ou volte aos cursos.';
}
