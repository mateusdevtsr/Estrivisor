# Estrivisor

Voz, chat e transmissão de tela entre amigos, no estilo do Discord: cada pessoa pode ter
o seu servidor (com canais de texto e de voz) e chamar os amigos com um código de convite.
Uso restrito a maiores de 18 anos e a quem o administrador liberou.

## Como funciona

```
 App (Electron, no PC de cada um)
   │  login com Discord · servidores · convites · presença · pedido de token
   ▼
 https://api.SEU-DOMINIO ──(Cloudflare Tunnel)──► servidor do Estrivisor (Docker, num notebook/PC ligado)
                                                    └─ dados/ (servidores, mensagens, sessões) + backup semanal
 App ◄──── voz, vídeo e tela (WebRTC) ────► LiveKit (Docker, numa VPS) · wss://livekit.SEU-DOMINIO
```

- **Servidor do Estrivisor** (`token-server/`): guarda servidores, canais, mensagens, membros, convites,
  amigos e sessões de login, aplica as regras e a moderação, e entrega os tokens do LiveKit.
  Só ele conhece as chaves do LiveKit e o Client Secret do Discord.
- **Cloudflare Tunnel** (`cloudflared`): publica o servidor em HTTPS sem abrir porta no
  roteador e sem mostrar o IP de casa.
- **LiveKit** (`vps/`): transporta a voz, o vídeo e a tela. Roda numa VPS com o Caddy na frente (HTTPS).
- **App** (`main.js`, `preload.js`, `index.html`, `estrivisor-app.js`): o instalador que vai
  pros amigos. A sessão de login fica guardada criptografada pelo Windows.
- **Site** (`Site/`): página de download, termos de uso e política de privacidade.

## Configurar o servidor (uma vez, no computador que fica ligado)

Precisa de: Docker (no Linux, Docker Engine + Compose), um domínio na Cloudflare, um app no
Discord Developer Portal e o LiveKit rodando numa VPS (veja `vps/LEIA-ME-VPS.md`).

1. **Domínio na Cloudflare.** Compre um domínio pela própria Cloudflare (Domain Registration)
   ou, se ele for de outro lugar (ex.: registro.br), adicione o site na Cloudflare e troque os
   servidores DNS no registrador pelos que a Cloudflare indicar.
2. **Discord.** Em [discord.com/developers/applications](https://discord.com/developers/applications),
   abra o seu app e vá em **OAuth2**:
   - em **Redirects**, adicione exatamente `http://127.0.0.1:53134/callback` e salve;
   - copie o **Client ID** e gere/copie o **Client Secret**.
3. **Arquivos de configuração** (ficam só no computador do servidor; o `.gitignore` já impede de subir):
   - copie `server.env.example` para `server.env` e preencha (LiveKit, `INVITE_KEY`, Discord, `ADMIN_DISCORD_IDS`);
   - copie `tunnel.env.example` para `tunnel.env` (o token vem no passo 4).
4. **Túnel.** No painel da Cloudflare, **Networking → Tunnels → Create a tunnel**, dê um nome,
   escolha **Docker** e copie o token (a parte longa depois de `--token`) para o `tunnel.env`.
5. **Subir tudo:** `docker compose up -d --build`. No painel, o túnel deve ficar *Healthy*.
6. **Publicar.** No túnel, **Routes → Add route → Published application**: subdomínio `api`,
   o seu domínio e, em *Service URL*, `http://token-server:8080`.
7. **Testar:** abra `https://api.SEU-DOMINIO/saude` no navegador. Tem que aparecer `{"ok":true}`.

A porta 28080 do servidor só escuta no próprio computador (`127.0.0.1:28080`); de fora, o
acesso é só pelo túnel. Não abra essa porta no roteador.

## Configurar e gerar o app

1. Copie `.env.example` para `.env` e preencha (`TOKEN_SERVER_URL=https://api.SEU-DOMINIO`).
   Esse arquivo vai **dentro** do instalador: nunca coloque nele o Client Secret nem as chaves
   do LiveKit.
2. `npm install` e `npm start` para testar.
3. Aumente a `version` no `package.json`, faça o commit e o push, e rode `npm run dist` com um
   `GH_TOKEN` definido **só naquela janela do PowerShell**. Use um token *fine-grained* limitado a
   este repositório, com permissão *Contents: Read and write* e validade. O instalador é
   publicado nos Releases do GitHub e os apps instalados se atualizam sozinhos. Confira se o
   release não ficou como *Draft*.

## Testes e manutenção

- **Testes do servidor:** `cd token-server && npm install && npm test` (rode antes de cada deploy).
- **Dependências do servidor:** o `package-lock.json` fixa as versões e o Docker usa `npm ci`.
  Para atualizar, mude o `package.json`, rode `npm install` e commite o lock.
- **Deploy do servidor:** copie os arquivos para o computador do servidor e rode
  `docker compose up -d --build token-server`; confira `docker compose ps` (deve estar *healthy*).
- **Versões fixas:** o `cloudflared` (no `docker-compose.yml`) e o LiveKit e o Caddy (em `vps/`)
  estão com versão definida, e só mudam quando você decide.
- **Backup:** o `backup.sh` roda todo domingo às 4h (cron em `/etc/cron.d/estrivisor-backup`),
  guarda as 4 últimas cópias no servidor e envia cada uma para a VPS (8 últimas) por uma chave SSH
  exclusiva. O resultado fica em `backup.log` e em `backups/status.txt` (que o painel mostra).
  Teste a restauração de vez em quando.
- **Versão mínima do app:** `APP_VERSAO_MINIMA` no `server.env` barra versões antigas com a
  mensagem "Atualize o Estrivisor". Só ligue depois que todo mundo atualizar.

## Painel de monitoramento

Abra `https://api.SEU-DOMINIO/painel` no navegador (PC ou celular) e entre com o Discord. Só as
contas em `ADMIN_DISCORD_IDS` entram; tentativas de outras contas ficam no Histórico do app.

- **O que mostra:** quem está online, em chamada e transmitindo agora (e nas últimas 24 h); pessoas
  ativas por dia, em 7 e em 30 dias; pessoas novas; mensagens por dia, por hora e por dia da
  semana (só a quantidade, nunca o texto); tempo em chamada; downloads e versões no GitHub;
  versões do app em uso; servidores; saúde do notebook (disco, memória, temperatura, erros, último
  backup) e do servidor de voz; moderação. Dá para baixar um CSV do período.
- **Configurar:** cadastre `https://api.SEU-DOMINIO/painel/retorno` em Discord Developer Portal →
  OAuth2 → Redirects e coloque o mesmo endereço em `PAINEL_REDIRECT_URI` no `server.env`.
- **De onde vêm os números:** o servidor anota as estatísticas em `dados/metricas.json` (números por
  dia, e quem esteve ativo só nos últimos 31 dias). Antes da instalação do painel, só as mensagens
  têm histórico (contado pelas mensagens guardadas). Os downloads vêm do GitHub e incluem as
  atualizações automáticas do app.
- **Segurança:** o painel só lê; liberar, punir e moderar continuam no app. A sessão do painel vale
  12 horas, fica num cookie protegido e cai se o servidor reiniciar.

## Segurança — o que está coberto

- A identidade de cada pessoa vem do login (Discord confirmado pelo servidor). O app não
  consegue "dizer" que é outra pessoa, e o servidor recusa pedidos sem sessão válida.
- Só entra quem o administrador liberou; punições (suspensão e banimento) valem na hora.
- Só o dono do servidor mexe em canais, convites, membros e moderação; o servidor confere.
- Os nomes das pessoas vêm sempre da conta, e as mensagens são limpas de caracteres invisíveis.
- As chaves de sessão ficam guardadas só como hash no servidor e criptografadas no PC de cada um.
- Tráfego com o servidor em HTTPS (túnel da Cloudflare); voz e vídeo criptografados pelo WebRTC.
- Tokens do LiveKit valem 15 minutos (só para entrar na sala).
- O código de amigo é sorteado pelo servidor e pode ser trocado em Configurações.
- Cada pessoa pode exportar os próprios dados e apagar a conta dentro do app.
- A `INVITE_KEY` vai dentro do instalador: ela só filtra quem usa o app, não identifica ninguém.
  Se vazar, troque nos dois `.env` e gere um instalador novo.
