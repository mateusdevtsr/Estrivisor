# Estrivisor no Android

O app do celular usa a mesma tela e o mesmo código do app do PC. O que muda fica nesta pasta:

- `ponte/ponte.js` faz no celular o papel do `main.js`/`preload.js` (login, servidor, sessão).
- `ponte/tela.js` + `celular.css` reorganizam a tela em uma coluna (gavetas de canais e membros).
- `nativo/` tem o código Android da chamada (aviso "Na chamada" e alto-falante).
- `montar-www.js` monta a pasta `www/`; `ajustar-android.js` ajusta o projeto Android gerado.

O APK é montado pelo GitHub Actions (`.github/workflows/android.yml`): aba **Actions > App Android > Run workflow**.
Ele também roda sozinho quando uma versão nova é publicada e anexa o `Estrivisor-Android.apk` na release.

Segredos necessários (Settings > Secrets and variables > Actions): `TOKEN_SERVER_URL`, `INVITE_KEY`, `LIVEKIT_URL`
(os mesmos do `.env` do PC). Para atualizações instalarem por cima, adicione também a assinatura:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_SENHA`, `ANDROID_KEY_ALIAS`.

No servidor: `CELULAR_REDIRECT_URI=https://api.SEU-DOMINIO/auth/celular/retorno` no `server.env`, e o mesmo
endereço cadastrado no Discord Developer Portal > OAuth2 > Redirects.

Ainda não existe no celular: transmitir a tela, janela flutuante, sala de cinema e status no Discord.
