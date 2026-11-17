# Black Dobrada da Ju

Página de vendas baseada na referência fornecida pelo proprietário, com as imagens e capas locais, 15 ofertas de cursos e 5 combos. O checkout independente segue os anexos e usa exclusivamente Pix pela QuantumPay, sem alegar proteção ou processamento Hotmart.

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

O servidor local usa http://127.0.0.1:4173. Para cobranças, configure `QUANTUMPAY_API_KEY` e `QUANTUMPAY_API_SECRET` em um arquivo `.env.local` ignorado pelo Git e execute `node --env-file=.env.local scripts/serve.mjs`. `STORE_URL` permite informar uma origem HTTPS canônica para testes autorizados.

## Vercel

Projeto `black-ju`, equipe `ronald-almeida-4717s-projects`, repositório `ronald-almeida/BLACK-JU`, branch `main`. Framework Other, Node 24.x, build `node scripts/build.mjs`, saída `dist`. As funções estão em `api/`.

Configure `QUANTUMPAY_API_KEY` e `QUANTUMPAY_API_SECRET` como Secret em Production. O código não contém credenciais. `GET /api/health` informa apenas se as credenciais estão configuradas. `GET /api/health?check=provider` também testa a autenticação, sem criar cobranças e sem retornar o token. Mudanças de variável exigem novo deploy.

## QuantumPay

Integração baseada na [documentação oficial](https://docs.quantumpay.com.br/), consultada em 16/11/2026:

- [Autenticação](https://docs.quantumpay.com.br/pages/auth/generate-token): `POST https://api.quantumpay.com.br/api/auth`, Basic Auth com API Key e Secret. Token Bearer mantido somente em memória no servidor, compartilhado entre chamadas simultâneas na mesma instância e renovado um minuto antes da expiração. `expiresIn` é expresso em milissegundos.
- [Criação](https://docs.quantumpay.com.br/pages/pix-in/create-qrcode): `POST /api/v1/pix/in/qrcode`, `amountInCents` em centavos, descrição de até 140 caracteres, cliente com CPF/CNPJ numérico e um item digital (`tangible: false`). Preço e item vêm do catálogo do servidor.
- A resposta usa `data.id`, `data.pix.emv` e `data.status`. QR e Copia e Cola só são exibidos após validar identificador, status inicial, valores retornados (quando presentes) e CRC do BR Code. A criação documentada pode omitir o valor; se o EMV contiver valor, ele também deve corresponder à oferta.
- [Consulta descrita no fluxo PIX IN](https://docs.quantumpay.com.br/pages/pix-in/overview): `GET /api/v1/transactions/{id}`. A API local exige recibo assinado vinculado ao provedor, oferta, transação e valor. Só `paid`, ID correspondente e valor inteiro em centavos (`amountInCents` ou `amount`) confirmam a compra. Respostas sem valor, com campos conflitantes ou status desconhecido não confirmam pagamento.
- `pending`, `paid`, `canceled`, `refunded` e `expired` são normalizados para os estados do checkout. Uma consulta rejeitada com 401 pode renovar o token e ser repetida uma vez; criação nunca é reenviada automaticamente.
- O QR é gerado no navegador a partir do código retornado pelo provedor, usando biblioteca local MIT em `public/vendor/`.

Os testes automatizados usam respostas controladas e não geram cobranças reais. A homologação de um pagamento real deve ser feita pelo proprietário antes de considerar confirmada a conciliação financeira. A autenticação de saúde não valida a liquidação de um pagamento.

## Operação

Criação e consulta de cobranças usam somente a QuantumPay. Referências sem esse provedor são rejeitadas antes de qualquer chamada externa. Uma cobrança salva é verificada antes de reexibir seu QR; referências inválidas deixam de ser exibidas e orientam contato com o suporte, sem gerar outra cobrança.

O checkout valida nome, emails, CPF/CNPJ numérico e celular no cliente e no servidor. A aba guarda a referência da cobrança em sessionStorage, sem os dados pessoais do formulário, para retomar um Pix após recarregar a página. Respostas incertas bloqueiam reenvio na mesma aba. A documentação de criação PIX IN não define um contrato de idempotência; não há garantia entre dispositivos ou abas nem reenvio automático de cobranças. Falhas de autenticação anteriores ao envio permitem nova tentativa.

A consulta de status ocorre a cada 12 segundos, recua progressivamente até 60 segundos em caso de erro, pausa quando a aba fica oculta e termina quando o pagamento é concluído ou cancelado. O prazo só é mostrado se o provedor informar a expiração. Após a API confirmar `paid` e o valor esperado, o checkout redireciona para `/obrigado.html`. Uma cobrança salva como paga é consultada novamente ao recarregar; o status no navegador, sozinho, não dispara o redirecionamento.

A página de obrigado orienta o comprador a liberar o acesso pelo WhatsApp do suporte, `+55 75 98839-3742`. O botão abre uma mensagem pronta, sem transmitir os dados do comprador nem o token da cobrança. A liberação é manual pela equipe: este projeto não cria contas de aluno, envia emails nem libera cursos automaticamente. A página de obrigado é pública e não é um comprovante de pagamento; o suporte deve conferir a compra no provedor antes da liberação. Não há banco próprio de pedidos nem webhook de liberação.

As páginas de detalhes resumem as informações do catálogo original e mantêm a navegação no novo site. Os CTAs de compra apontam para `/checkout.html?produto=<identificador>`.
