import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import catalog from '../public/catalog.json' with { type: 'json' };

export async function runChecks() {
  assert.equal(catalog.length,20);
  assert.equal(new Set(catalog.map(p=>p.id)).size,20);
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert(!/MONTE SEU COMBO|FALE COM NOSSA EQUIPE|pay\.hotmart\.com|Em até 12x|sem juros/i.test(html));
  for(const product of catalog) {
    assert.equal(product.amount,product.kind==='combo'?49700:product.previousOffer>30000?39700:product.previousOffer);
    assert(html.includes(`/checkout.html?produto=${product.id}`),`Missing checkout for ${product.id}`);
    for(const image of product.images||[product.image])await access(new URL('../public'+image,import.meta.url));
  }
  const assetLinks=[...html.matchAll(/(?:src|href)="(\/(?:assets-pre-black-ju\/[^"?#]+|[^"/?#]+\.(?:js|css|ico)))(?:[?#][^"]*)?"/g)].map(match=>match[1]);
  for(const asset of assetLinks)await access(new URL('../public'+asset,import.meta.url));
  return {offers:catalog.length,courses:catalog.filter(p=>p.kind==='course').length,combos:catalog.filter(p=>p.kind==='combo').length};
}
