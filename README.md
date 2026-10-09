# Estrivisor — hospedando no seu PC + gerando o instalador para os amigos

## Visão geral

Duas partes bem separadas:

1. **Servidor** (só na sua máquina): LiveKit + servidor de token, rodando
   via Docker. Fica ligado o tempo todo que você quiser que o app funcione
   pros seus amigos — se desligar seu PC, ninguém consegue entrar.
2. **Cliente** (instalado no PC de cada amigo): o `.exe` gerado pelo
   `electron-builder`. Não precisa de Node.js nem Docker — é um programa
   completo, como qualquer outro instalador do Windows.

Eles se falam por dois endereços que você expõe do seu roteador:
LiveKit (porta 7880/7881 + faixa UDP) e o servidor de token (porta 8080).

## Passo 1 — Dynamic DNS (endereço fixo pra sua casa)

Seu provedor de internet troca seu IP de vez em quando, então em vez de
usar o IP direto, usamos um serviço gratuito de DNS dinâmico:

1. Crie uma conta grátis em https://www.duckdns.org
2. Crie um subdomínio, ex: `meuapp.duckdns.org`
3. Siga as instruções do próprio DuckDNS pra instalar o cliente deles no
   seu PC (um programinha pequeno que atualiza o IP automaticamente)

## Passo 2 — Abrir as portas no roteador (port forwarding)

No painel administrativo do seu roteador (geralmente `192.168.0.1` ou
`192.168.1.1`), encontre "Port Forwarding" / "Virtual Server" e libere,
apontando todas para o IP local do seu PC (ex: `192.168.1.50`):

| Porta         | Protocolo | Serviço              |
|---------------|-----------|----------------------|
| 7880          | TCP       | LiveKit (sinalização)|
| 7881          | TCP       | LiveKit (fallback)   |
| 50000–50100   | UDP       | LiveKit (mídia)      |
| 8080          | TCP       | Servidor de token    |

## Passo 3 — Configurar os segredos do servidor

Copie `server.env.example` para `server.env` e preencha com suas chaves
reais do LiveKit (as mesmas que estão em `livekit.yaml`) e escolha uma
`INVITE_KEY` — é a "senha" que seus amigos vão precisar pra pedir token,
sem ser a chave criptográfica de verdade.

**Esse arquivo (`server.env`) nunca deve sair do seu PC.**

## Passo 4 — Subir o servidor

```
docker compose up -d --build
docker compose logs -f
```

Confirme que o serviço `estrivisor-token-server` subiu sem erro.

## Passo 5 — Configurar o app cliente (o que vai pros amigos)

Copie `.env.example` para `.env` (na raiz do projeto, junto com
`main.js`) e preencha:

```
LIVEKIT_URL=ws://meuapp.duckdns.org:7880
TOKEN_SERVER_URL=http://meuapp.duckdns.org:8080
INVITE_KEY=a-mesma-chave-que-voce-colocou-em-server.env
```

Esse `.env` (sem as chaves reais do LiveKit) é o que vai dentro do `.exe`.

## Passo 6 — Gerar o instalador (.exe)

```
npm install
npm run dist
```

O instalador fica em `dist/Estrivisor Setup X.Y.Z.exe` (X.Y.Z = a versão do package.json). Envie esse
arquivo pros seus amigos — eles só precisam rodar o instalador, **não
precisam instalar Node.js, Docker nem nada além disso**.

## Testando

1. Você abre o Estrivisor (via `npm start` ou o próprio instalado) e
   entra numa sala, ex: `sala-dos-guri`
2. Seu amigo abre o dele, entra na **mesma sala**
3. Qualquer um dos dois clica em "Iniciar transmissão" e escolhe uma
   janela/tela

## Segurança — o que melhorou e o que ainda é uma pegada informal

- ✅ A chave criptográfica real do LiveKit (`LIVEKIT_API_SECRET`) nunca
  sai do seu PC agora — só o servidor de token a conhece.
- ✅ Cada participante recebe só as permissões da sala (`roomJoin`,
  `canPublish`, `canSubscribe`), sem privilégio de admin.
- ⚠️ A conexão usa `ws://` e `http://` simples (sem TLS), porque
  configurar certificado válido pra um IP residencial dá mais trabalho.
  Isso significa que o tráfego de sinalização (não o vídeo em si, que já
  é criptografado pelo próprio WebRTC) passa sem criptografia extra pela
  internet. Para um grupo pequeno de amigos de confiança, isso costuma
  ser aceitável — mas não é o ideal para uso mais sério. Se quiser
  fechar essa lacuna depois, dá pra colocar um Caddy na frente com TLS
  automático via Let's Encrypt, usando seu domínio DuckDNS.
- ⚠️ A `INVITE_KEY` não impede mal-intencionados de tentar adivinhar a
  senha por força bruta indefinidamente — para mais segurança, considere
  trocar essa chave periodicamente.
