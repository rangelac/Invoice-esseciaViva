# Essência Viva — cobranças de doação

Primeira versão com painel administrativo e página de pagamento por cartão de crédito à vista. O repositório usa Node.js 24, Express e SQLite. Os dados persistem em disco, separados por ambiente.

## Executar localmente

1. Instale Node.js 24 ou superior e Python 3.11 ou superior. Execute `npm ci` e `python -m pip install -r requirements.txt`. O gerador de PDF usa ReportLab. Se necessário, configure `PYTHON_BIN` com o caminho do Python no servidor.
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
7. Revise a identificação jurídica, contato e política de privacidade antes de publicar. O PDF usa o nome, endereço e telefone do Instituto presentes no modelo enviado; CNPJ e política de privacidade ainda precisam ser informados.

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

## Pagamento em outras moedas (DCC)

O valor enviado à Cielo e os totais de referência da organização continuam em **BRL**. A moeda do documento agora é escolhida na criação, como descrito abaixo. O fluxo DCC desta seção se aplica apenas a faturas emitidas em BRL. Para cartões estrangeiros elegíveis Visa/Mastercard à vista, a Cielo pode oferecer a moeda local do cartão (por exemplo USD, EUR ou GBP). O doador escolhe entre BRL e a oferta retornada; não é uma lista livre para cobrar arbitrariamente em qualquer moeda.

- A página usa a moeda, o valor convertido e o câmbio retornados pela Cielo. A oferta DCC usa somente a cotação da Cielo. A estimativa anterior para ajuste voluntário usa uma fonte externa, conforme a seção de valor ajustável.
- Nenhuma opção vem pré-selecionada. A tela informa valor em BRL, valor estrangeiro, câmbio, markup e vencimento da oferta. O markup documentado pela Cielo na consulta é de 16%, configurável em `CIELO_DCC_MARKUP_PERCENT` e preservado junto à oferta.
- A confirmação é enviada ao endpoint `/1/sales/{PaymentId}/confirm`, com `CurrencyConversion` verdadeiro para moeda estrangeira ou falso para BRL. Uma consulta independente confirma o resultado.
- O prazo máximo de 20 minutos começa antes da requisição de cotação; não é renovado ao atualizar a página. Cotações expiradas e respostas incertas não geram uma segunda tentativa automática.
- Moeda escolhida, cotação e horário de aceite persistem no banco. Um comprovante imprimível fica disponível na página após confirmação (simulações são identificadas).
- A precisão monetária segue as casas decimais ISO da moeda. A aplicação recusa valores inconsistentes com o câmbio retornado, em vez de exibir uma conversão calculada por suposição. Valide o formato e a unidade do `ConvertedAmount` das moedas de sua conta na homologação.
- O endpoint de confirmação documentado recebe somente um booleano. Respostas com mais de uma opção estrangeira são encaminhadas à conferência, pois não existe seleção documentada do código na confirmação.
- Cartões inelegíveis com status 12 e sem oferta podem confirmar em BRL. Há documentação legada citando status 11 para inelegibilidade, em conflito com o status geral de estorno; esse caso fica em conferência até validação com a Cielo.

### Ativar na conta real

Configure `CIELO_DCC_ENABLED=true` **somente após validar com a Cielo a habilitação do conversor e sua combinação com Silent Order Post na conta**. A criação tokenizada permanece em `/v2/sales/` conforme a documentação do SOP; a documentação específica do DCC exemplifica `/1/sales` com cartão. A compatibilidade da combinação, os valores de retorno e os requisitos da bandeira precisam ser homologados com a Cielo; não foram verificados em produção nesta entrega. Não foi feita nenhuma cobrança real.

Os endpoints de DCC consultados são documentados somente em produção. Por isso, a aplicação bloqueia ativar DCC no sandbox externo. Use o modo demo para revisar a experiência ou os testes com provedor simulado. O demo oferece exemplos USD, EUR, GBP, JPY e KWD com câmbio fictício; essa lista não limita as moedas reais retornadas pela Cielo.

Fontes oficiais:
- https://docs.cielo.com.br/ecommerce-cielo/docs/conversor-moedas-ecommerce
- https://docs.cielo.com.br/ecommerce-cielo/reference/conversor-moedas-disponiveis
- https://docs.cielo.com.br/ecommerce-cielo/reference/conversor-moedas-api
- https://docs.cielo.com.br/ecommerce-cielo/reference/confirmar-conversao
- https://docs.cielo.com.br/ecommerce-cielo/docs/fluxos-alternativos-conversao

## Bitcoin (BTC na rede Bitcoin)

É um meio independente da Cielo. Ao criar a cobrança, preencha opcionalmente `Valor alternativo em Bitcoin`. O valor BTC é fixado pela ONG, com até oito casas decimais; não há câmbio automático. O valor BRL continua como referência administrativa, inclusive nos totais (não significa liquidação bancária em reais).

O endereço Bitcoin foi extraído do QR Code fornecido pelo proprietário e configurado apenas no `.env` local. O checksum é validado na inicialização. Não foram usados os outros dois QR Codes (USDT/Ethereum e Binance Pay), que não são endereços de Bitcoin. Não são necessárias nem aceitas chaves privadas ou frases de recuperação.

- Demo: fluxo simulado, sem endereço real, QR Code ou link de carteira. Um TXID fictício pode ser usado para testar a conferência administrativa.
- Produção: configure `BITCOIN_ADDRESS` (mainnet SegWit/Taproot) e `ENABLE_BITCOIN=true`, além dos requisitos gerais do ambiente. O endereço é copiado para a cobrança ao selecionar Bitcoin, mantendo o destino mesmo se a configuração mudar depois.
- Selecionar Bitcoin reserva a cobrança para esse meio e bloqueia o cartão. Não há troca automática após emitir as instruções para evitar pagamento duplicado.
- O QR Code contém endereço e valor em BTC. Não aceita USDT, Ethereum, Lightning nem Binance Pay.
- O doador pode informar o TXID, mas isso só muda o estado para conferência; não declara a cobrança paga.
- No painel, `Conferir Bitcoin` exige TXID, índice da saída (`vout`, a partir de zero) e confirmação de que o administrador identificou o doador. A consulta somente de leitura à API Esplora da Blockstream verifica endereço, valor mínimo, idade da transação e pelo menos três confirmações em um bloco na cadeia principal. A mesma saída não pode quitar duas cobranças.
- Como o endereço é compartilhado, o TXID público sozinho não prova quem pagou; a associação ao doador é responsabilidade da ONG. Para automação completa e maior privacidade, uma evolução será usar um endereço exclusivo por cobrança via processador próprio de pagamentos Bitcoin.
- A implementação verifica uma saída por cobrança, não soma pagamentos parciais. Excedentes são registrados em satoshis e devem ser conciliados pela ONG. Não faz envios, saques ou devoluções.
- A verificação depende de um explorador externo, não é validação por nó próprio. Após a baixa não há monitoramento de reorganizações da rede nem atualização automática. Guarde e confira os comprovantes na carteira.

Referências: https://github.com/Blockstream/esplora/blob/master/API.md e https://developer.bitcoin.org/devguide/payment_processing.html.

## Débito — requisito ainda pendente

Débito ainda não está implementado. Exige autenticação 3DS; não basta mudar `CreditCard` para `DebitCard`. A integração precisa das credenciais 3DS, do código do estabelecimento (EC), do nome cadastrado e do MCC para gerar o token, além da etapa de autenticação no navegador e validação do resultado na autorização. O número de usuário do portal não deve ser presumido como EC. O conversor de moedas não se aplica ao débito.

Referências: https://docs.cielo.com.br/ecommerce-cielo/docs/cart%C3%A3o-de-debito e https://docs.cielo.com.br/ecommerce-cielo/v3.0-en/docs/create-access-token.

## Moeda escolhida na criação e fatura PDF

O formulário permite escolher a moeda **antes de emitir a fatura**. O catálogo inclui as moedas ISO reconhecidas pelo runtime e Bitcoin. Essa é a moeda do documento, não uma declaração de que a Cielo liquida em todas elas.

- Moeda, valor em unidades mínimas, precisão, endereço do doador e número sequencial `EV-000001` são persistidos. Faturas antigas são migradas para BRL sem mudar os valores existentes.
- Para moeda diferente de BRL, o administrador informa também o equivalente fixo em reais. Esse equivalente original não muda automaticamente. Quando a ONG autoriza ajuste, o doador pode revisar outra estimativa antes do pagamento. A página e o PDF mostram os valores claramente; apenas o equivalente BRL é enviado para a Cielo. Os limites atuais de pagamento em reais permanecem R$ 1 a R$ 100.000.
- A escolha documental não força o DCC nem garante uma cobrança nativa em dólar/euro. Para faturas estrangeiras, o fluxo não oferece nova escolha DCC. Cobrança nativa e liquidação em moeda estrangeira exigiriam outro arranjo/provedor compatível.
- Em BTC, o valor principal também define o valor da alternativa Bitcoin; o equivalente em BRL serve para cartão e totais de referência.
- O botão **Baixar PDF** fica disponível ao finalizar a criação, na lista e na página de pagamento. O PDF contém número da fatura, emissão, vencimento, descrição, moeda, total, situação e QR Code para o link exclusivo `/p/:id`. Não aponta para uma página genérica de doação.
- O PDF administrativo contém os dados do destinatário. O download pelo link público omite nome, e-mail e endereço do doador, preservando a mesma separação de dados da API pública.
- Nome, endereço e telefone institucionais foram extraídos do PDF de referência fornecido pelo usuário. Não foram copiados os dados do pagador nem o valor daquela fatura.
- `PUBLIC_URL` define o destino do QR Code. Em localhost, o PDF avisa que o link só funciona na própria máquina. Para enviar a terceiros, publique em HTTPS e configure a URL pública antes de gerar o PDF.
- PDFs são gerados sob demanda, sem gravar dados pessoais em arquivos de cache; no máximo três renderizações simultâneas, com tempo e tamanho limitados. O servidor usa Python com ReportLab via entrada padrão, sem interpolar dados em comandos.
- O comprovante de pagamento anterior e a fatura são documentos distintos: a fatura pode ser emitida antes do pagamento. Não é nota fiscal.

O modelo visual foi conferido em PNG e o conteúdo do QR Code foi decodificado após renderizar o PDF. Testes cobrem valores EUR/JPY/KWD/BTC, conservação do equivalente BRL e acesso aos downloads.


## Valor ajustável pelo doador

Na criação, marque **Permitir que o doador altere o valor para cartão**. Por padrão, faturas novas e antigas continuam com valor fixo. Essa autorização aceita doações menores ou maiores e encerra a solicitação pelo valor confirmado; a diferença não é uma dívida nem gera cobrança adicional.

- Antes de enviar o cartão, o doador escolhe BRL, USD, EUR, GBP, CAD, AUD, CHF ou JPY, recebe uma sugestão, edita o valor e clica em **Revisar e usar este valor**. Essa lista é de moedas de referência, não de moedas garantidas de débito no cartão.
- A estimativa real usa a API Frankfurter v2 (referência diária, não cotação ao vivo nem da Cielo). Exibe fonte/data; rejeita dados inválidos ou com mais de sete dias. Há cache de dez minutos. Não envia dados pessoais ao serviço. Na indisponibilidade, oferece tentar depois ou escolher BRL, sem substituir por câmbio fictício. Demo usa taxas explicitamente fictícias.
- O servidor grava uma estimativa com identificador aleatório, vinculada à fatura e válida por dez minutos. O navegador não define o câmbio nem o total BRL. A criação da cobrança na Cielo usa o valor da estimativa validada no servidor; valor e estimativa são fixados atomicamente quando começa o pagamento. Estimativas de outra fatura, vencidas ou posteriores ao início são recusadas.
- O campo `amount` do banco mantém o equivalente BRL original; `payment_amount` guarda o valor de cartão e `donation_json` preserva a escolha e referência. A API expõe `originalAmount` e o `amount` efetivo. Painel, conciliação e PDF distinguem a fatura original da doação ajustada.
- Depois do envio à Cielo, não se altera a estimativa nem se cria outra tentativa automática. DCC, quando habilitado, apresenta a oferta da Cielo para o valor ajustado e exige escolha separada. Não há garantia de debitar exatamente o valor estrangeiro desejado.
- Bitcoin mantém seu valor fixo, sem usar a estimativa de cartão.

Fonte: https://frankfurter.dev/

## Preparação para publicação

`npm run check:production` lê `.env.production` e lista requisitos ausentes sem imprimir segredos ou efetuar transações. O arquivo é privado e ignorado pelo Git. A configuração local `.env` continua em demo até estarem disponíveis o domínio HTTPS e as credenciais SOP. Credenciais comerciais não substituem Client ID e Client Secret do SOP.

A imagem do `Dockerfile` contém Node 24 e Python/ReportLab e executa como usuário sem privilégios. `.dockerignore` exclui credenciais, dados e artefatos locais. A imagem foi preparada, mas precisa ser construída e validada no ambiente de hospedagem; não houve publicação nesta entrega.

Para o responsável pela hospedagem:
1. Configure os segredos na hospedagem, `PAYMENT_MODE=production`, `ENABLE_LIVE_PAYMENTS=true`, `PUBLIC_URL=https://seu-dominio` e as quatro credenciais Cielo/SOP.
2. Monte um volume persistente em `/app/data` com escrita pelo UID 1000. Guarde backups consistentes do SQLite, incluindo a política de recuperação. Nunca use armazenamento efêmero para o banco.
3. Encaminhe HTTPS ao serviço na porta 3000. Restrinja acesso à porta interna. Use uma instância para a sessão administrativa e o banco SQLite atuais.
4. Execute a verificação de produção e homologue crédito/SOP na conta. DCC permanece desativado até homologação específica. Débito permanece pendente de 3DS.
5. Valide aprovação, recusa, timeout e conciliação no ambiente final. A verificação de configuração e os testes simulados não comprovam autorização de pagamentos reais.

A atualização de pagamentos em conferência ainda é feita pelo botão **Consultar Cielo** no painel; não há webhook nem conciliação automática em segundo plano nesta versão.
