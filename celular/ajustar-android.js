#!/usr/bin/env node
// ============================================================
// Depois do "npx cap add android" / "npx cap sync android": ajusta o projeto Android gerado.
// - Código nativo da chamada (aviso "Na chamada", alto-falante) e a tela principal.
// - Permissões (microfone, notificação da chamada) e o link estrivisor://login (volta do login).
// - Versão igual à do app do PC (package.json da pasta de cima).
// - Ícone do Estrivisor (precisa do ImageMagick: "magick" ou "convert").
// - Assinatura fixa, se ANDROID_KEYSTORE_PATH estiver definido (senão, sai a versão de teste "debug").
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AQUI = __dirname;
const ANDROID = path.join(AQUI, 'android');
const APP = path.join(ANDROID, 'app');
const erro = (msg) => { console.error('\n[ajustar-android] ' + msg + '\n'); process.exit(1); };
if (!fs.existsSync(APP)) erro('Pasta android/ não existe. Rode antes: npx cap add android');

// 1) Código nativo
const pastaJava = path.join(APP, 'src', 'main', 'java', 'com', 'estrivisor', 'celular');
fs.mkdirSync(pastaJava, { recursive: true });
for (const f of ['MainActivity.java', 'VozPlugin.java', 'VozServico.java']) fs.copyFileSync(path.join(AQUI, 'nativo', f), path.join(pastaJava, f));

// 2) AndroidManifest.xml
const arqManifesto = path.join(APP, 'src', 'main', 'AndroidManifest.xml');
let m = fs.readFileSync(arqManifesto, 'utf8');
const PERMISSOES = [
  'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.POST_NOTIFICATIONS', 'android.permission.WAKE_LOCK',
  'android.permission.BLUETOOTH_CONNECT'
];
const faltando = PERMISSOES.filter((p) => !m.includes(`"${p}"`)).map((p) => `    <uses-permission android:name="${p}" />`).join('\n');
if (faltando) m = m.replace('<application', `${faltando}\n\n    <application`);
if (!m.includes('.VozServico')) {
  m = m.replace('</application>', '        <service android:name=".VozServico" android:exported="false" android:foregroundServiceType="microphone" />\n    </application>');
}
if (!m.includes('android:scheme="estrivisor"')) {
  const inicio = m.indexOf('android:name=".MainActivity"');
  if (inicio < 0) erro('Não achei a MainActivity no AndroidManifest.xml.');
  const fimFiltro = m.indexOf('</intent-filter>', inicio);
  if (fimFiltro < 0) erro('Não achei o intent-filter da MainActivity.');
  const depois = fimFiltro + '</intent-filter>'.length;
  m = m.slice(0, depois) + `

            <!-- Volta do login com Discord: estrivisor://login?ticket=... -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="estrivisor" android:host="login" />
            </intent-filter>` + m.slice(depois);
}
fs.writeFileSync(arqManifesto, m);

// 3) Versão (igual à do PC). versionCode: 3.15.1 -> 31501
const versao = JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'package.json'), 'utf8')).version;
const [a, b, c] = versao.split('.').map((n) => parseInt(n, 10) || 0);
const codigo = a * 10000 + b * 100 + c;
const arqGradle = path.join(APP, 'build.gradle');
let g = fs.readFileSync(arqGradle, 'utf8');
g = g.replace(/versionCode\s+\d+/, `versionCode ${codigo}`).replace(/versionName\s+"[^"]*"/, `versionName "${versao}"`);

// 4) Assinatura fixa (as atualizações só instalam por cima se a assinatura for sempre a mesma)
if (process.env.ANDROID_KEYSTORE_PATH && !g.includes('signingConfigs.estrivisor')) {
  g += `
// Assinatura do Estrivisor (dados vêm das variáveis de ambiente do GitHub Actions; nada fica no repositório)
android {
    signingConfigs {
        estrivisor {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_SENHA")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_SENHA") ?: System.getenv("ANDROID_KEYSTORE_SENHA")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.estrivisor
        }
    }
}
`;
}
fs.writeFileSync(arqGradle, g);

// 5) Ícone
const icone = path.join(AQUI, '..', 'icone.png');
const TAMANHOS = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
let im = null;
for (const cmd of ['magick', 'convert']) { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); im = cmd; break; } catch (e) {} }
if (im && fs.existsSync(icone)) {
  const res = path.join(APP, 'src', 'main', 'res');
  for (const [pasta, px] of Object.entries(TAMANHOS)) {
    const destino = path.join(res, pasta);
    fs.mkdirSync(destino, { recursive: true });
    for (const nome of ['ic_launcher.png', 'ic_launcher_round.png']) {
      execFileSync(im, [icone, '-resize', `${px}x${px}`, '-background', 'none', '-gravity', 'center', '-extent', `${px}x${px}`, path.join(destino, nome)]);
    }
  }
  // Sem o ícone "adaptável" do modelo: o Android usa os PNGs acima.
  fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
} else {
  console.warn('[ajustar-android] ImageMagick não encontrado: o app fica com o ícone padrão do Capacitor.');
}

console.log(`[ajustar-android] pronto: versão ${versao} (${codigo})${process.env.ANDROID_KEYSTORE_PATH ? ', assinatura do Estrivisor' : ', sem assinatura fixa (debug)'}`);
