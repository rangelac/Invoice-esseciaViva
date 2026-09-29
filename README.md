# Essência Viva — cobranças de doação

Primeira versão com painel administrativo e página de pagamento por cartão de crédito à vista. O repositório usa Node.js 24, Express e SQLite. Os dados persistem em disco, separados por ambiente.

## Executar localmente

1. Instale Node.js 24 ou superior e execute `npm ci`.
2. Copie `.env.example` para `.env`.
3. Configure `ADMIN_PASSWORD` com uma senha exclusiva de pelo menos 16 caracteres.
4. Execute `npm start` e abra http://localhost:3000.

O padrão é **demo**: não chama a Cielo, não pede cartão e marca o pagamento como simulado. Use dados fictícios. Não use links locais para solicitar doações reais.

## Funcionalidades

- Login administrativo com cookie HttpOnly, SameSite e expiração de 8 horas.
- Criar cobrança com nome, e-mail opcional, finalidade, valor e vencimento (fim do dia no Acre).
- Link individual não enumerável; busca, filtros, totais e cópia do link.
- Cartão de crédito à vista via Silent Order Post (SOP). Número/CVV seguem diretamente à Cielo; o servidor recebe só PaymentToken e bandeira.
- Autorização com captura automática e confirmação por consulta à Cielo.
- Em falha ou timeout, bloqueia nova tentativa e permite consultar pelo MerchantOrderId. Não presume que uma requisição sem resposta falhou antes da cobrança.
- Nenhuma credencial real incluída. `.env` e bancos locais ficam fora do Git.

## Configuração da Cielo

Use `PAYMENT_MODE=sandbox` para homologação e preencha no `.env` as quatro credenciais do mesmo ambiente:

- `CIELO_MERCHANT_ID` e `CIELO_MERCHANT_KEY`.
- `CIELO_SOP_CLIENT_ID` e `CIELO_SOP_CLIENT_SECRET` do Silent Order Post.

O número de usuário do portal não é uma credencial destas APIs. O SOP requer habilitação no painel Cielo. A documentação publica credenciais específicas para testar o SOP; não misture as credenciais genéricas do e-commerce com as específicas do SOP. Não envie segredos pelo chat, nem os coloque em arquivos versionados.

Fluxo: OAuth2 no servidor → AccessToken SOP → script da Cielo no navegador → PaymentToken → POST `/v2/sales/` com captura → consulta `/1/sales/{PaymentId}`. Apenas Status 2 é confirmado como pago. Status 1 permanece autorizado. Notificações do navegador nunca são usadas como prova de pagamento.

## Publicação e operação

Esta entrega é uma base funcional local, ainda não homologada com a conta da ONG. Antes de receber dinheiro real:

1. Revogue a chave que foi compartilhada e configure novas credenciais no servidor.
2. Habilite cartão e SOP na conta, valide o fluxo completo no sandbox, incluindo recusa e indisponibilidade.
3. Use domínio próprio com HTTPS, `PUBLIC_URL=https://seu-dominio`, `PAYMENT_MODE=production`, `ENABLE_LIVE_PAYMENTS=true` e credenciais de produção. O sistema recusa produção sem esses requisitos.
4. Rode uma única instância, com volume persistente para `data/`, backups protegidos e acesso restrito. Por padrão escuta apenas em 127.0.0.1; para container use `HOST=0.0.0.0` atrás de um proxy HTTPS.
5. Configure limites de tráfego no proxy. O aplicativo não confia automaticamente em X-Forwarded-For; atrás de proxy seus limites internos poderão ser compartilhados por todos os visitantes.
6. Revise os requisitos de segurança/compliance e antifraude da Cielo para o estabelecimento. SOP reduz o tráfego de dados sensíveis no servidor, mas não constitui certificação PCI da página. 3DS/antifraude não estão implementados.
7. Preencha identificação jurídica, contato e política de privacidade da ONG antes de publicar para doadores. Esses dados não foram fornecidos.

**Conciliação:** clique em “Consultar Cielo” no painel para atualizar o pagamento, inclusive estornos e cancelamentos feitos na Cielo. A página do doador mostra o último status persistido, não consulta diretamente a adquirente. Não há webhook nem rotina automática nesta versão. Nunca recrie uma cobrança em conferência sem verificar o pedido na Cielo. Pagamentos recusados exigem novo link; não há retentativa automática. As consultas da Cielo têm janela de três meses.

O e-mail é cadastrado, mas não há envio automático. A cobrança é um convite de pagamento, não uma nota fiscal. Pix, boleto, recorrência, parcelamento e reembolsos pelo painel ficam fora desta primeira versão.

## Verificação

`npm test` executa testes locais com respostas simuladas do provedor (nenhuma cobrança externa). `npm run check` verifica a sintaxe. Para o teste visual, execute `npx playwright install chromium` e `npm run test:ui`; no Windows com Edge instalado, configure `UI_BROWSER_CHANNEL=msedge`. As capturas locais ficam em `.preview/`. A homologação real com o SOP exige as credenciais e o ambiente apropriados; testes locais não a substituem.

## Documentação oficial utilizada

- https://docs.cielo.com.br/ecommerce-cielo/docs/integrando-com-o-sop
- https://docs.cielo.com.br/ecommerce-cielo/reference/criar-pagamento-credito
- https://docs.cielo.com.br/ecommerce-cielo/reference/consulta-paymentid-api
- https://docs.cielo.com.br/ecommerce-cielo/reference/consulta-merchantorderid-api
- https://github.com/Braspag/silent-order-post

Referências consultadas em 28/09/2026.
