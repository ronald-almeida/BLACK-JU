# Black Dobrada da Ju

Página de vendas baseada na referência fornecida pelo proprietário, com as imagens e capas locais, 15 ofertas de cursos e 5 combos. O checkout independente segue os anexos e usa exclusivamente Pix pela Firebot, sem alegar proteção ou processamento Hotmart.

## Preços

- Cursos com oferta original acima de R$ 300: R$ 397,00.
- TEA Para Professores: R$ 198,80, mantido.
- As duas entradas do pacote de 3 imersões: R$ 238,53, mantido.
- Todos os cinco combos: R$ 497,00.
- Sem cartão, parcelamento ou botão de montar combo com a equipe.

`public/catalog.json` é a fonte de dados usada pela interface e pelo servidor. O cliente envia apenas o identificador da oferta e os dados do comprador. Um preço enviado pelo navegador nunca define o valor da cobrança.

## Executar

Node.js 24, sem dependências para instalar:

```sh
node scripts/serve.mjs
node --test --test-isolation=none tests/*.test.mjs
node scripts/build.mjs
```

O servidor local usa http://127.0.0.1:4173. Para cobranças, configure `FIREBOT_API_KEY` em um arquivo `.env.local` ignorado pelo Git e execute `node --env-file=.env.local scripts/serve.mjs`. `STORE_URL` permite informar uma origem HTTPS canônica para testes autorizados.

## Vercel

Projeto `black-ju`, equipe `ronald-almeida-4717s-projects`, repositório `ronald-almeida/BLACK-JU`, branch `main`. Framework Other, Node 24.x, build `node scripts/build.mjs`, saída `dist`. As funções estão em `api/`.

Configure `FIREBOT_API_KEY` como Secret em Production. O código não contém credenciais. `GET /api/health` informa apenas se a chave está configurada; não testa sua validade no provedor. Mudanças de variável exigem novo deploy.

## Firebot

Contrato reutilizado da integração existente, baseada na documentação https://firebotbr.com/integracoes/docs consultada em 13/11/2026:

- `POST /api/v1/pix/create`, autenticação `x-api-key`, valor em reais, `productType: DIGITAL`, `storeUrl`, `description`, `customer.name/email/cpf/phone`, `qrStyle: plain`.
- QR e Copia e Cola só são exibidos após validar identificador, valor e CRC do BR Code.
- `GET /api/v1/pix/{transactionId}` consulta o status. A API local exige um recibo assinado vinculado à oferta, transação e valor. Só `PAID` com ID e valor correspondentes confirma a compra.
- O QR é gerado no navegador a partir do código retornado pelo provedor, usando biblioteca local MIT em `public/vendor/`.

Os testes automatizados usam respostas controladas e não geram cobranças reais. A resposta de consulta do provedor precisa conter `transactionId`, `amount` e `status`, diretamente ou dentro de `transaction`/`data`. A homologação de um pagamento real deve ser feita pelo proprietário antes de considerar confirmada a conciliação financeira.

## Operação

O checkout valida nome, emails, CPF/CNPJ numérico e celular no cliente e no servidor. A aba guarda a referência da cobrança em sessionStorage, sem os dados pessoais do formulário, para retomar um Pix após recarregar a página. Respostas incertas bloqueiam reenvio na mesma aba; não existe garantia de idempotência entre dispositivos ou abas, pois esse suporte não está documentado pela Firebot. Não há reenvio automático de cobranças.

A consulta de status pausa quando a aba fica oculta e termina quando o pagamento é concluído ou cancelado. O prazo só é mostrado se o provedor informar a expiração. Após a API confirmar `paid` e o valor esperado, o checkout redireciona para `/obrigado.html`. Uma cobrança salva como paga é consultada novamente ao recarregar; o status no navegador, sozinho, não dispara o redirecionamento.

A página de obrigado orienta o comprador a liberar o acesso pelo WhatsApp do suporte, `+55 75 98839-3742`. O botão abre uma mensagem pronta, sem transmitir os dados do comprador nem o token da cobrança. A liberação é manual pela equipe: este projeto não cria contas de aluno, envia emails nem libera cursos automaticamente. A página de obrigado é pública e não é um comprovante de pagamento; o suporte deve conferir a compra no provedor antes da liberação. Não há banco próprio de pedidos nem webhook de liberação.

As páginas de detalhes resumem as informações do catálogo original e mantêm a navegação no novo site. Os CTAs de compra apontam para `/checkout.html?produto=<identificador>`.
