# Estrivisor

Voz, chat e transmissão de tela entre amigos, no estilo do Discord: cada pessoa pode ter
o seu servidor (com canais de texto e de voz) e chamar os amigos com um código de convite.

## Como funciona

```
 App (Electron, no PC de cada um)
   │  login com Discord · servidores · convites · presença · pedido de token
   ▼
 https://api.SEU-DOMINIO  ──(Cloudflare Tunnel)──►  servidor do Estrivisor (Docker, no seu PC)
                                                      └─ dados/ (servidores, sessões)
 App  ◄──── voz, vídeo e chat (WebRTC) ────►  LiveKit Cloud
```

- **Servidor do Estrivisor** (`token-server/`): guarda servidores, canais, membros, convites e
  sessões de login, e entrega os tokens do LiveKit. Só ele conhece as chaves do LiveKit e o
  Client Secret do Discord.
- **Cloudflare Tunnel** (`cloudflared`): publica o servidor em HTTPS sem abrir porta no
  roteador e sem mostrar o IP da sua casa.
- **LiveKit Cloud**: transporta a voz, o vídeo e as mensagens dos canais.
- **App** (`main.js`, `preload.js`, `index.html`, `estrivisor-app.js`): o instalador que vai
  pros amigos. A sessão de login fica guardada criptografada pelo Windows.

## Configurar o servidor (uma vez, no PC que fica ligado)

Precisa de: Docker Desktop, um domínio na Cloudflare, um app no Discord Developer Portal e uma
conta no LiveKit Cloud.

1. **Domínio na Cloudflare.** Compre um domínio pela própria Cloudflare (Domain Registration)
   ou, se ele for de outro lugar (ex.: registro.br), adicione o site na Cloudflare e troque os
   servidores DNS no registrador pelos que a Cloudflare indicar.
2. **Discord.** Em [discord.com/developers/applications](https://discord.com/developers/applications),
   abra o seu app e vá em **OAuth2**:
   - em **Redirects**, adicione exatamente `http://127.0.0.1:53134/callback` e salve;
   - copie o **Client ID** e gere/copie o **Client Secret**.
3. **Arquivos de configuração** (ficam só no seu PC; o `.gitignore` já impede de subir):
   - copie `server.env.example` para `server.env` e preencha (LiveKit, `INVITE_KEY`, Discord);
   - copie `tunnel.env.example` para `tunnel.env` (o token vem no passo 4).
4. **Túnel.** No painel da Cloudflare, **Networking → Tunnels → Create a tunnel**, dê um nome,
   escolha **Docker** e copie o token (a parte longa depois de `--token`) para o `tunnel.env`.
5. **Subir tudo:** `docker compose up -d --build`. No painel, o túnel deve ficar *Healthy*.
6. **Publicar.** No túnel, **Routes → Add route → Published application**: subdomínio `api`,
   o seu domínio e, em *Service URL*, `http://token-server:8080`.
7. **Testar:** abra `https://api.SEU-DOMINIO/saude` no navegador. Tem que aparecer `{"ok":true}`.

## Configurar e gerar o app

1. Copie `.env.example` para `.env` e preencha (`TOKEN_SERVER_URL=https://api.SEU-DOMINIO`).
   Esse arquivo vai **dentro** do instalador: nunca coloque nele o Client Secret nem as chaves
   do LiveKit.
2. `npm install` e `npm start` para testar.
3. Aumente a `version` no `package.json` e rode `npm run dist` (com `GH_TOKEN` definido, o
   instalador é publicado nos Releases do GitHub e os apps instalados se atualizam sozinhos).

## Login obrigatório

O login pelo Discord é sempre obrigatório (não há mais modo de transição). Para expor só o
túnel e não a porta do servidor, use `"127.0.0.1:28080:8080"` no `docker-compose.yml`, feche a
porta 28080 no roteador e rode `docker compose up -d`.

## Segurança — o que está coberto

- A identidade de cada pessoa vem do login (Discord confirmado pelo servidor, ou um código
  criado pelo servidor para quem entra sem Discord). O app não consegue "dizer" que é outra pessoa.
- Só o dono do servidor mexe em canais, convites, membros e moderação; o servidor confere.
- As chaves de sessão ficam guardadas só como hash no servidor e criptografadas no PC de cada um.
- Tráfego com o servidor em HTTPS (túnel da Cloudflare); voz e vídeo criptografados pelo WebRTC.
- Tokens do LiveKit valem 15 minutos (só para entrar na sala).
- A `INVITE_KEY` vai dentro do instalador: ela só filtra quem usa o app, não identifica ninguém.
  Se vazar, troque nos dois `.env` e gere um instalador novo.
