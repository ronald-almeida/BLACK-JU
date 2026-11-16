import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayment, getPaymentStatus, createReceipt, readReceipt, getProduct, crc16, validatePixCode, PaymentError } from '../lib/payment.js';
import { readPost } from '../lib/http.js';
import catalog from '../public/catalog.json' with {type:'json'};

// Synthetic fixtures never leave this process. No live charge is generated.
const customer={name:'Pessoa Teste',email:'teste@example.com',confirmEmail:'teste@example.com',document:'52998224725',phone:'11999999999'};
const field=(tag,value)=>tag+Buffer.byteLength(value).toString().padStart(2,'0')+value;
function pixCode(cents) {
  const text=field('00','01')+field('26',field('00','br.gov.bcb.pix')+field('01','teste@example.com'))+field('52','0000')+field('53','986')+field('54',(cents/100).toFixed(2))+field('58','BR')+field('59','TESTE')+field('60','SAO PAULO')+field('62',field('05','TEST'))+'6304';
  return text+crc16(text);
}
const fake=(amount, extra={})=>({success:true,transactionId:'fire_tx_test_12345',amount:amount/100,pixCopiaECola:pixCode(amount),status:'PENDING',...extra});
process.env.FIREBOT_API_KEY='fire_sk_live_test_only_not_a_real_key';
test('Cria todos os preços em reais usando somente o catálogo do servidor',async()=>{
  for(const product of catalog) {
    let calls=0;
    const result=await createPayment(product.id,{...customer,amount:1},'https://black-ju.example',async(url,init)=>{
      calls++;assert.equal(url,'https://firebotbr.com/api/v1/pix/create');assert.equal(init.method,'POST');
      const body=JSON.parse(init.body);assert.equal(body.amount,product.amount/100);assert.equal(body.productType,'DIGITAL');assert.equal(body.customer.cpf,customer.document);assert(body.description.includes('Black Dobrada'));
      return Response.json(fake(product.amount));
    });
    assert.equal(calls,1);assert.equal(result.amount,product.amount);assert.equal(readReceipt(result.token).productId,product.id);
  }
});
test('Rejeita produto inexistente, CPF inválido, emails divergentes e campos excessivos antes de chamar Firebot',async()=>{
  let calls=0;const fetcher=()=>{calls++;throw new Error('Must not be called')};
  for(const [id,buyer] of [['missing',customer],[catalog[0].id,{...customer,document:'11111111111'}],[catalog[0].id,{...customer,confirmEmail:'outro@example.com'}],[catalog[0].id,{...customer,name:'a'.repeat(121)}]]) {
    await assert.rejects(createPayment(id,buyer,'https://example.com',fetcher),error=>error.status===400&&error.retryable);
  }
  assert.equal(calls,0);
});
test('Não aceita QR com CRC incorreto ou valor diferente',()=>{
  assert.equal(validatePixCode(pixCode(39700),39700),pixCode(39700));
  assert.throws(()=>validatePixCode(pixCode(49700),39700),PaymentError);
  assert.throws(()=>validatePixCode(pixCode(39700).slice(0,-1)+'Z',39700),PaymentError);
});
test('Resposta da criação com valor incorreto não é exibida como cobrança válida',async()=>{
  await assert.rejects(createPayment(catalog[0].id,customer,'https://example.com',async()=>Response.json(fake(1))),PaymentError);
});
test('Token adulterado ou expirado não permite consultar transação',()=>{
  const token=createReceipt('fire_tx_test_12345',catalog[0]);assert.equal(readReceipt(token).amount,39700);
  assert.throws(()=>readReceipt(token+'bad'),PaymentError);
  assert.throws(()=>readReceipt(createReceipt('fire_tx_test_12345',catalog[0],0)),PaymentError);
});
test('Só confirma pagamento com PAID, identidade e valor corretos',async()=>{
  const token=createReceipt('fire_tx_test_12345',catalog[0]);
  const result=await getPaymentStatus(token,async()=>Response.json({transaction:{transactionId:'fire_tx_test_12345',amount:397,status:'PAID'}}));
  assert.equal(result.status,'paid');
  for(const transaction of [{transactionId:'fire_tx_other',amount:397,status:'PAID'},{transactionId:'fire_tx_test_12345',amount:1,status:'PAID'},{amount:397,status:'PAID'},{transactionId:'fire_tx_test_12345',amount:397,status:'UNKNOWN'}]) {
    await assert.rejects(getPaymentStatus(token,async()=>Response.json({transaction})),PaymentError);
  }
});
test('Falha de rede não repete cobrança e bloqueia nova tentativa automática',async()=>{
  let calls=0;
  await assert.rejects(createPayment(catalog[0].id,customer,'https://example.com',async()=>{calls++;throw new Error('timeout')}),error=>error.retryable===false);
  assert.equal(calls,1);
});
test('Sem chave, retorna indisponibilidade sem chamar provedor',async()=>{
  const key=process.env.FIREBOT_API_KEY;delete process.env.FIREBOT_API_KEY;let calls=0;
  try {await assert.rejects(createPayment(catalog[0].id,customer,'https://example.com',async()=>{calls++}),error=>error.status===503&&error.retryable);assert.equal(calls,0);}
  finally {process.env.FIREBOT_API_KEY=key;}
});
test('Protege método, origem, JSON e tamanho da requisição',()=>{
  const request={method:'POST',headers:{host:'black-ju.example',origin:'https://black-ju.example','content-type':'application/json'},body:{productId:catalog[0].id,customer}};
  assert.equal(readPost(request).productId,catalog[0].id);
  for(const bad of [{...request,method:'GET'},{...request,headers:{...request.headers,origin:'https://attacker.example'}},{...request,body:'x'.repeat(4097)},{...request,body:'{'},{...request,headers:{...request.headers,'content-type':'text/plain'}}]) assert.throws(()=>readPost(bad),PaymentError);
});
