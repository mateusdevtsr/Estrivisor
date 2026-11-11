#!/usr/bin/env node
// ============================================================
// Monta a pasta www/ do app de celular a partir dos arquivos do app do PC (pasta de cima).
// - Copia a tela e os módulos (os mesmos do PC) e o livekit-client.
// - Junta a ponte (ponte/ponte.js) num arquivo só com o esbuild, já com o endereço do servidor e a
//   chave do app, que vêm de variáveis de ambiente (segredos do GitHub) — nunca ficam no repositório.
// - Ajusta o index.html: tela de celular, ponte antes do app, estilo do celular.
//
// Uso (precisa de: npm install na pasta celular e npm install na pasta de cima):
//   TOKEN_SERVER_URL=https://api.SEU-DOMINIO INVITE_KEY=... LIVEKIT_URL=wss://livekit.SEU-DOMINIO node montar-www.js
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const WWW = path.join(__dirname, 'www');

const ARQUIVOS = [
  'index.html', 'estrivisor-app.js', 'estilo.js', 'areas.js', 'sons.js', 'ruido/ruido-pacote.js', 'ruido.js',
  'arquivos.js', 'novidades.js', 'espectadores.js', 'desenho.js', 'social.js', 'perfil.js', 'somboard.js',
  'cinema.js', 'imagens.js', 'icone.png', 'node_modules/livekit-client/dist/livekit-client.umd.js'
];

function erro(msg) { console.error('\n[montar-www] ' + msg + '\n'); process.exit(1); }

const TOKEN_SERVER_URL = String(process.env.TOKEN_SERVER_URL || '').trim().replace(/\/+$/, '');
const INVITE_KEY = String(process.env.INVITE_KEY || '').trim();
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '').trim();
if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(TOKEN_SERVER_URL)) erro('TOKEN_SERVER_URL precisa ser https://api.SEU-DOMINIO (sem barra no fim).');
if (!INVITE_KEY) erro('Falta INVITE_KEY (a mesma do .env do app do PC).');
if (LIVEKIT_URL && !/^wss:\/\//.test(LIVEKIT_URL)) erro('LIVEKIT_URL precisa começar com wss://');
const versao = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(String(versao))) erro('Não achei a versão no package.json da pasta do app do PC.');

// 1) Copia os arquivos
fs.rmSync(WWW, { recursive: true, force: true });
for (const rel of ARQUIVOS) {
  const de = path.join(RAIZ, rel);
  if (!fs.existsSync(de)) erro(`Arquivo não encontrado: ${rel} (rode "npm install" na pasta do app do PC antes).`);
  const para = path.join(WWW, rel);
  fs.mkdirSync(path.dirname(para), { recursive: true });
  fs.copyFileSync(de, para);
}
fs.copyFileSync(path.join(__dirname, 'celular.css'), path.join(WWW, 'celular.css'));

// 2) Junta a ponte
const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'ponte', 'ponte.js')],
  bundle: true, format: 'iife', target: ['chrome100'], minify: false, legalComments: 'none',
  outfile: path.join(WWW, 'ponte-celular.js'),
  define: {
    __TOKEN_SERVER_URL__: JSON.stringify(TOKEN_SERVER_URL),
    __INVITE_KEY__: JSON.stringify(INVITE_KEY),
    __LIVEKIT_URL__: JSON.stringify(LIVEKIT_URL || 'wss://livekit.estrivisor.com.br'),
    __VERSAO__: JSON.stringify(versao),
    // Notificações só ficam ligadas se o APK for montado com o google-services.json (TEM_FIREBASE=1).
    __PUSH_ATIVO__: JSON.stringify(process.env.TEM_FIREBASE === '1')
  }
});

// 3) Ajusta o index.html
const arqIndex = path.join(WWW, 'index.html');
let html = fs.readFileSync(arqIndex, 'utf8');
const trocar = (de, para, nome) => {
  if (!html.includes(de)) erro(`Não achei no index.html: ${nome}. O index.html mudou? Atualize o montar-www.js.`);
  html = html.replace(de, para);
};
// Celular: tela do tamanho do aparelho, sem zoom de pinça, ocupando a área do entalhe.
if (/<meta name="viewport"/.test(html)) html = html.replace(/<meta name="viewport"[^>]*>/, '');
trocar('<meta charset="UTF-8">', '<meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">', 'meta charset');
// O Android injeta um pedacinho de script do próprio Capacitor na página: precisa de 'unsafe-inline' só aqui.
// (Mensagens e nomes continuam sendo mostrados como texto, nunca como HTML.)
trocar("script-src 'self' blob: 'wasm-unsafe-eval'", "script-src 'self' 'unsafe-inline' blob: 'wasm-unsafe-eval'", 'CSP script-src');
trocar('<script src="./node_modules/livekit-client/dist/livekit-client.umd.js"></script>',
  '<script src="./ponte-celular.js"></script>\n    <script src="./node_modules/livekit-client/dist/livekit-client.umd.js"></script>', 'script do livekit');
trocar('</head>', '    <link rel="stylesheet" href="./celular.css">\n</head>', '</head>');
fs.writeFileSync(arqIndex, html);

console.log(`[montar-www] pronto: www/ (Estrivisor ${versao}) -> servidor ${TOKEN_SERVER_URL}`);
