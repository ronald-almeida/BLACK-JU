const $ = id => document.getElementById(id);
const money = amount => (amount/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
try {
  const response=await fetch('/catalog.json'); if(!response.ok)throw new Error();
  const product=(await response.json()).find(item=>item.id===new URLSearchParams(location.search).get('produto'));
  if(!product)throw new Error();
  document.title=product.name+' | Black Dobrada da Ju';
  $('cover').src=product.image;$('cover').alt='Capa de '+product.name;
  $('name').textContent=product.name;$('description').textContent=product.description;
  $('lessons').textContent=product.lessons||'Combo de cursos';
  for(const name of product.includes){const li=document.createElement('li');li.textContent=name;$('includes').append(li)}
  $('gift').textContent=product.gift;$('old-price').textContent=money(product.originalAmount);$('price').textContent=money(product.amount);
  $('buy').href='/checkout.html?produto='+product.id;
  if(product.checkoutName)$('buy').textContent='Quero o pacote de 3 imersões →';
  $('loading').hidden=true;document.querySelector('article').hidden=false;
}catch{$('loading').textContent='Curso não encontrado. Volte ao catálogo para escolher uma oferta.'}
