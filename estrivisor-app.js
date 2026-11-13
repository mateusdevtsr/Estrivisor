// ============================================================
// Estrivisor — servidor com canais de texto e voz (v2)
// ============================================================

// ---------- Notificações flutuantes ----------
function mostrarNotificacao(mensagem, tipo) {
    const container = document.getElementById('container-notificacoes');
    const nota = document.createElement('div');
    const ehInfo = tipo === 'info';
    nota.className = 'notificacao' + (ehInfo ? ' info' : '');
    if (!ehInfo) nota.setAttribute('role', 'alert');
    const texto = document.createElement('div');
    texto.className = 'nota-texto';
    texto.textContent = mensagem;
    const fechar = document.createElement('button');
    fechar.type = 'button'; fechar.className = 'nota-fechar'; fechar.textContent = '✕';
    fechar.title = 'Fechar'; fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.addEventListener('click', () => nota.remove());
    nota.append(texto, fechar);
    container.appendChild(nota);
    // Erro fica mais tempo (dá pra ler com calma); passar o mouse por cima segura o aviso na tela.
    const duracao = ehInfo ? 4500 : Math.min(12000, 7000 + String(mensagem || '').length * 30);
    let timer = setTimeout(() => nota.remove(), duracao);
    nota.addEventListener('mouseenter', () => clearTimeout(timer));
    nota.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(() => nota.remove(), 2500); });
}

// ---------- Cor de avatar consistente ----------
function corDoAvatar(texto) {
    let hash = 0;
    for (let i = 0; i < texto.length; i++) hash = texto.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 48%, 38%)`;
}

// ---------- Segurança: textos e imagens vindos de OUTRAS pessoas ----------
// Nomes e avatares chegam de outros participantes. Nome nunca pode virar
// HTML (senão um nome malicioso rodaria código no app dos outros).
function escaparHtml(texto) {
    return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Só aceitamos avatares hospedados no CDN do Discord.
const REGEX_AVATAR_DISCORD = /^https:\/\/cdn\.discordapp\.com\/[A-Za-z0-9_\-\/\.]+(\?[A-Za-z0-9_=&\-]*)?$/;
function urlAvatarSegura(url) {
    if (typeof url !== 'string' || url.length > 250) return null;
    return REGEX_AVATAR_DISCORD.test(url) ? url : null;
}

// Mostra o avatar (foto do Discord, ou a inicial do nome sobre uma cor).
function aplicarAvatar(el, identidade, nome, avatarUrl) {
    if (!el) return;
    const url = urlAvatarSegura(avatarUrl);
    el.style.backgroundColor = corDoAvatar(identidade || nome || '?');
    if (url) {
        el.textContent = '';
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
    } else {
        el.textContent = (nome || '?').charAt(0).toUpperCase();
        el.style.backgroundImage = 'none';
    }
}

// Lê o avatar que o servidor colocou no "metadata" do participante.
// O apelido é livre; o nome da CONTA vem do servidor. Quando são diferentes, a tela mostra os dois:
// "Apelido (Nome da conta)", pra ninguém se passar por outra pessoa só trocando o apelido.
function contaDoParticipante(p) {
    try { const d = JSON.parse((p && p.metadata) || '{}'); return typeof d.conta === 'string' ? d.conta.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : ''; }
    catch (e) { return ''; }
}
function contaDiferente(nome, conta) {
    const c = typeof conta === 'string' ? conta.trim().slice(0, 40) : '';
    return c && c.toLowerCase() !== String(nome || '').trim().toLowerCase() ? c : '';
}
function htmlNomeComConta(nome, conta) {
    const c = contaDiferente(nome, conta);
    return escaparHtml(nome) + (c ? ` <span class="nome-conta" title="Nome da conta desta pessoa">(${escaparHtml(c)})</span>` : '');
}
function avatarDoParticipante(p, alternativo) {
    try {
        const dados = JSON.parse((p && p.metadata) || '{}');
        return urlAvatarSegura(dados.avatar) || alternativo || null;
    } catch (e) {
        return alternativo || null;
    }
}

function slug(texto) {
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'canal';
}

// Migração da época em que o app se chamava "Concord": copia o nome e o
// servidor salvos pras chaves novas (só se as novas ainda não existirem).
// Pode apagar este bloco quando todo mundo já tiver aberto o app novo.
[['concord_nome', 'estrivisor_nome'], ['concord_servidor', 'estrivisor_servidor']].forEach(([velha, nova]) => {
    const valor = localStorage.getItem(velha);
    if (valor !== null && localStorage.getItem(nova) === null) localStorage.setItem(nova, valor);
});

// ---------- Perfil do usuário ----------
// A conta vem do LOGIN e é confirmada pelo servidor:
//   - com Discord: "discord:<id>" (o servidor confere com o próprio Discord)
//   - sem Discord: "local:<código>" (o servidor cria o código)
// "Nome" é o que aparece pros outros: o nome da conta ou um apelido escolhido aqui.
let nomeUsuarioAtual = '';
let identidadeUsuarioAtual = '';
let avatarUsuarioAtual = null;
let origemPerfil = null; // 'discord' | 'manual' | null (ainda sem conta)
let contaAtual = null;   // { usuario, tipo, nome, avatar } como o servidor informou

function obterNomeUsuario() {
    return nomeUsuarioAtual;
}
function obterIdentidadeUsuario() {
    return identidadeUsuarioAtual;
}

// Pede o token de uma sala (a conta vai junto pelo processo principal; aqui só o nome exibido).
function pedirToken(sala) {
    return window.electronAPI.gerarToken({ sala, nome: obterNomeUsuario() });
}

function aplicarPerfil({ identidade, nome, avatar, origem }) {
    identidadeUsuarioAtual = identidade;
    nomeUsuarioAtual = nome;
    avatarUsuarioAtual = urlAvatarSegura(avatar);
    origemPerfil = origem;
    document.getElementById('nome-usuario-exibido').textContent = nome;
    aplicarAvatar(document.getElementById('avatar-usuario-exibido'), identidade, nome, avatarUsuarioAtual);
    conectarPresenca();
    atualizarPresencaDiscord(); // app aberto + conta definida = "Online no Estrivisor"
}

function adotarConta(conta) {
    contaAtual = conta;
    const apelido = (localStorage.getItem('estrivisor_nome_manual') || '').trim();
    aplicarPerfil({
        identidade: conta.usuario,
        nome: apelido || conta.nome,
        avatar: conta.avatar,
        origem: conta.tipo === 'discord' ? 'discord' : 'manual'
    });
}

// ---------- Tela de login / perfil ----------
// modo "entrar": sem conta (Discord ou só um nome) | modo "perfil": apelido e sair da conta
function erroLogin(texto) {
    document.getElementById('login-erro').textContent = texto || '';
}

function mostrarTelaLogin(modo) {
    const entrar = modo !== 'perfil';
    document.getElementById('login-entrar').style.display = entrar ? 'flex' : 'none';
    document.getElementById('login-perfil').style.display = entrar ? 'none' : 'flex';
    document.getElementById('login-aguardando').style.display = 'none';
    definirBotoesLogin(true);
    erroLogin('');
    let campo;
    if (entrar) {
        campo = document.getElementById('input-login-local');
        campo.value = (localStorage.getItem('estrivisor_nome') || '').trim();
    } else {
        campo = document.getElementById('input-login-nome');
        campo.value = (localStorage.getItem('estrivisor_nome_manual') || '').trim();
        campo.placeholder = contaAtual ? contaAtual.nome : '';
        document.getElementById('dica-login').textContent = contaAtual && contaAtual.tipo === 'discord'
            ? `Você entrou com o Discord (${contaAtual.nome}). Se quiser um apelido só aqui, digite abaixo; em branco usa o nome do Discord.`
            : 'Você entrou sem Discord. Pode trocar o nome que aparece pros outros quando quiser.';
    }
    document.getElementById('tela-login').style.display = 'flex';
    if (!entrar) setTimeout(() => campo.focus(), 50); // na tela de entrar, o destaque é o botão do Discord
}
function esconderTelaLogin() {
    document.getElementById('tela-login').style.display = 'none';
}
function definirBotoesLogin(ativos) {
    ['btn-login-discord', 'btn-login-local', 'input-login-local'].forEach((id) => {
        document.getElementById(id).disabled = !ativos;
    });
}

document.getElementById('btn-login-discord').addEventListener('click', async () => {
    erroLogin('');
    definirBotoesLogin(false);
    document.getElementById('login-aguardando').style.display = 'flex';
    let r;
    try { r = await window.electronAPI.loginDiscord(); }
    catch (e) { r = { ok: false, erro: 'Não consegui abrir o login.' }; }
    document.getElementById('login-aguardando').style.display = 'none';
    definirBotoesLogin(true);
    if (r && r.ok && r.conta) {
        esconderTelaLogin();
        adotarConta(r.conta);
        mostrarNotificacao(`Bem-vindo, ${r.conta.nome}!`, 'info');
    } else if (!(r && r.cancelado)) {
        erroLogin((r && r.erro) || 'O login não deu certo. Tente de novo.');
    }
});
document.getElementById('btn-login-cancelar').addEventListener('click', () => {
    window.electronAPI.cancelarLogin().catch(() => {});
});

async function entrarSemDiscord() {
    const nome = document.getElementById('input-login-local').value.replace(/\s+/g, ' ').trim();
    if (!nome) return erroLogin('Digite um nome pra continuar.');
    erroLogin('');
    definirBotoesLogin(false);
    let r;
    try { r = await window.electronAPI.loginLocal(nome); }
    catch (e) { r = { ok: false, erro: 'Não consegui falar com o servidor.' }; }
    definirBotoesLogin(true);
    if (!r || !r.ok) return erroLogin((r && r.erro) || 'Não deu certo. Tente de novo.');
    localStorage.setItem('estrivisor_nome', nome);
    esconderTelaLogin();
    adotarConta(r.conta);
}
document.getElementById('btn-login-local').addEventListener('click', entrarSemDiscord);
document.getElementById('input-login-local').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') entrarSemDiscord();
});

// Modo "perfil": salvar o apelido.
document.getElementById('btn-login-entrar').addEventListener('click', () => {
    if (!contaAtual) return;
    const apelido = document.getElementById('input-login-nome').value.replace(/\s+/g, ' ').trim();
    localStorage.setItem('estrivisor_nome_manual', apelido);
    adotarConta(contaAtual);
    esconderTelaLogin();
});
document.getElementById('input-login-nome').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login-entrar').click();
    if (e.key === 'Escape') esconderTelaLogin();
});
document.getElementById('btn-login-fechar').addEventListener('click', esconderTelaLogin);

// Volta o app ao estado "sem conta" (saiu da conta ou a sessão venceu).
async function encerrarContaNoApp() {
    await sairCanalVoz();
    sairDoTextoAtual();
    pararPing();
    fecharAmigos();
    pararAmigos();
    fecharAjustes();
    fecharTelaInicio();
    servidorAtual = SERVIDOR_VAZIO;
    meusServidores = [];
    presencaParticipantes.clear();
    sessaoIniciadaPara = null;
    contaAtual = null;
    identidadeUsuarioAtual = '';
    nomeUsuarioAtual = '';
    avatarUsuarioAtual = null;
    origemPerfil = null;
    document.getElementById('nome-usuario-exibido').textContent = '—';
    aplicarAvatar(document.getElementById('avatar-usuario-exibido'), '', '?', null);
    aplicarNomeServidor();
    renderizarListaCanais();
    renderizarBarraServidores();
    atualizarControlesDoServidor();
    atualizarListaOnline();
    mostrarAreaVazia();
    atualizarPresencaDiscord();
}

document.getElementById('btn-login-sair-conta').addEventListener('click', async () => {
    const r = await pedirTexto({
        titulo: 'Sair da conta?',
        dica: 'Você sai das chamadas e volta pra tela de login. Seus servidores continuam lá quando você entrar de novo.',
        semCampo: true,
        rotuloOk: 'Sair'
    });
    if (!r) return;
    try { await window.electronAPI.sairDaConta(); } catch (e) { /* sai mesmo assim */ }
    await encerrarContaNoApp();
    mostrarTelaLogin('entrar');
});

// O servidor avisou que a sessão venceu (ou foi encerrada em outro lugar).
window.electronAPI.aoExpirarSessao(async (mensagem) => {
    await encerrarContaNoApp();
    mostrarTelaLogin('entrar');
    erroLogin(mensagem || '');
    mostrarNotificacao(mensagem || 'Sua sessão expirou. Entre de novo.');
});

// Decide quem a pessoa é ao abrir o app: conta salva ou tela de login.
async function iniciarPerfil() {
    let estado = null;
    try { estado = await window.electronAPI.contaAtual(); } catch (e) { /* segue pro login */ }
    if (estado && estado.conta) return adotarConta(estado.conta);
    mostrarTelaLogin('entrar');
}

// ============================================================
// Servidores: ficam guardados no servidor do Estrivisor (aqui só o que está na tela)
// ============================================================
// Cada servidor tem um id fixo (ex.: "s1a2b3c4d5"); a sala de cada canal é "idDoServidor__idDoCanal".
const SERVIDOR_VAZIO = { id: '', chave: '', nome: 'Estrivisor', icone: null, cor: null, souDono: false, versao: 0, canais: [], membros: [] };
const CHAVE_SERVIDOR_ATUAL = 'estrivisor_servidor_atual';
const REGEX_ICONE_SERVIDOR = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}$/;
let servidorAtual = SERVIDOR_VAZIO;
let meusServidores = [];

function nomeSalaCanal(canal) {
    return `${servidorAtual.id}__${canal.id}`;
}

// Fala com o servidor do Estrivisor (a chave de convite fica só no processo principal).
async function api(metodo, caminho, corpo) {
    const r = await window.electronAPI.apiServidor({ metodo, caminho, corpo });
    if (!r.ok) {
        const erro = new Error(r.erro || 'Erro ao falar com o servidor.');
        erro.status = r.status;
        erro.codigo = r.codigo;
        if (r.codigo === 'aceite') exigirTermosAgora();
        throw erro;
    }
    return r.dados;
}

// O nome do servidor que a pessoa tinha na versão antiga (só pra sugerir ao criar o novo).
function nomeServidorAntigo() {
    try {
        const velho = JSON.parse(localStorage.getItem('estrivisor_servidor') || 'null');
        const nome = velho && typeof velho.nome === 'string' ? velho.nome.trim() : '';
        return nome && nome !== 'Meu Servidor' ? nome.slice(0, 30) : '';
    } catch (e) { return ''; }
}


// ============================================================
// Estado de conexão: um Room pro canal de TEXTO aberto, outro
// pro canal de VOZ em que a pessoa entrou — são independentes.
// ============================================================

let roomVoz = null;
let canalVozAtual = null;
let souAnfitriaoVoz = false;

let microfoneAtivo = false;
let reaplicandoAudio = 0; // >0 enquanto o app mesmo mexe na trilha do microfone (não é o dono do servidor mutando)
let microfoneTesteAtivo = false;
let streamTesteMic = null;
let audioTesteMic = null;

let idTileLocal = null;
let intervaloDiagnostico = null;
let identidadesFalando = new Set();
const qualidadePorIdentidade = new Map();
const volumesPorIdentidade = new Map();
const elementosAudioPorIdentidade = new Map();
const tiles = new Map(); // trackSid -> { videoEl, nome, ehVoce }
let trackEmFoco = null;
let fonteEscolhidaDropdown = null;

const PERFIS_QUALIDADE = {
    // Simulcast desligado: com ele o espectador pode receber uma camada reduzida (menos FPS) e o
    // computador de quem transmite gasta mais processamento codificando várias versões.
    automatico:  { resolution: { width: 1920, height: 1080 }, maxFramerate: 30, maxBitrate: 4_000_000, simulcast: false },
    alta:        { resolution: { width: 1920, height: 1080 }, maxFramerate: 60, maxBitrate: 8_000_000, simulcast: false },
    balanceado:  { resolution: { width: 1280, height: 720 },  maxFramerate: 30, maxBitrate: 2_000_000, simulcast: false },
    economia:    { resolution: { width: 854,  height: 480 },  maxFramerate: 15, maxBitrate: 700_000,   simulcast: false },
};

// Volumes que a pessoa escolheu (0–100%) ficam guardados por identidade, pra voltarem no próximo uso.
const CHAVE_VOLUMES = 'estrivisor_volumes';
let volumesSalvos = null;
function lerVolumesSalvos() {
    if (volumesSalvos) return volumesSalvos;
    volumesSalvos = {};
    try {
        const bruto = JSON.parse(localStorage.getItem(CHAVE_VOLUMES) || '{}');
        Object.entries(bruto || {}).slice(0, 200).forEach(([id, v]) => {
            const ok = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
            if (v && typeof v === 'object') volumesSalvos[id] = { microfone: ok(v.microfone) ? v.microfone : 100, compartilhamento: ok(v.compartilhamento) ? v.compartilhamento : 100 };
        });
    } catch (e) { /* dado corrompido: começa do zero */ }
    return volumesSalvos;
}
function salvarVolumes() {
    const saida = {};
    volumesPorIdentidade.forEach((v, id) => { if (v.microfone !== 100 || v.compartilhamento !== 100) saida[id] = { microfone: v.microfone, compartilhamento: v.compartilhamento }; });
    volumesSalvos = saida;
    try { localStorage.setItem(CHAVE_VOLUMES, JSON.stringify(saida)); } catch (e) {}
}

function garantirEntradaAudio(identity) {
    if (!volumesPorIdentidade.has(identity)) {
        const salvo = lerVolumesSalvos()[identity];
        volumesPorIdentidade.set(identity, salvo ? { ...salvo } : { microfone: 100, compartilhamento: 100 });
    }
    if (!elementosAudioPorIdentidade.has(identity)) elementosAudioPorIdentidade.set(identity, { microfone: new Set(), compartilhamento: new Set() });
}

function mapearQualidade(q) {
    switch (q) {
        case LivekitClient.ConnectionQuality.Excellent: return 'excelente';
        case LivekitClient.ConnectionQuality.Good: return 'boa';
        case LivekitClient.ConnectionQuality.Poor: return 'ruim';
        default: return 'desconhecida';
    }
}

// ============================================================
// Renderização da lista de canais (sidebar)
// ============================================================
// ---------- Excluir canais (só o dono; some pra todo mundo do servidor) ----------
function mostrarAreaVazia() {
    document.getElementById('cabecalho-canal').innerHTML = '<span>Selecione um canal na lateral</span>';
    document.getElementById('area-texto').style.display = 'none';
    document.getElementById('area-voz').style.display = 'none';
    document.getElementById('area-vazia').style.display = 'flex';
    atualizarCinemaDuplo();
}

// Layout Cinema: o chat do canal de texto aberto fica ao lado da transmissão (lado a lado).
// Nos outros layouts, voz e texto continuam alternando como sempre.
const layoutCinemaAtivo = () => document.body.classList.contains('layout-cinema');
function atualizarCinemaDuplo() {
    const texto = document.getElementById('area-texto').style.display === 'flex';
    const voz = document.getElementById('area-voz').style.display === 'flex';
    document.body.classList.toggle('cinema-duplo', layoutCinemaAtivo() && texto && voz);
}

async function excluirCanal(canal) {
    if (!servidorAtual.souDono) return;
    const ehVoz = canal.tipo === 'voz';
    const r = await pedirTexto({
        titulo: `Excluir "${canal.nome}"?`,
        dica: 'O canal some pra todo mundo do servidor (quem estiver dentro dele é desconectado).',
        semCampo: true,
        rotuloOk: 'Excluir'
    });
    if (!r) return;

    try {
        await api('DELETE', `/servidores/${servidorAtual.id}/canais/${encodeURIComponent(canal.id)}`);
    } catch (err) {
        return mostrarNotificacao('Não foi possível excluir o canal: ' + err.message);
    }

    // Se você está dentro desse canal, sai (o servidor também desconecta).
    if (ehVoz && canalVozAtual && canalVozAtual.id === canal.id) {
        const olhandoEle = document.getElementById('area-voz').style.display === 'flex';
        await sairCanalVoz();
        if (olhandoEle) mostrarAreaVazia();
    }
    if (!ehVoz && canalTextoAtual && canalTextoAtual.id === canal.id) {
        sairDoTextoAtual();
        if (document.getElementById('area-texto').style.display === 'flex') mostrarAreaVazia();
    }

    await recarregarServidorAtual();
    mostrarNotificacao(`Canal "${canal.nome}" excluído.`, 'info');
}

async function renomearCanal(canal) {
    const r = await pedirTexto({ titulo: 'Renomear canal', valor: canal.nome, max: 30 });
    if (!r || r.texto === canal.nome) return;
    try {
        await api('PATCH', `/servidores/${servidorAtual.id}/canais/${encodeURIComponent(canal.id)}`, { nome: r.texto });
        await recarregarServidorAtual();
    } catch (err) { mostrarNotificacao('Não foi possível renomear: ' + err.message); }
}

async function alternarAprovacaoCanal(canal) {
    try {
        await api('PATCH', `/servidores/${servidorAtual.id}/canais/${encodeURIComponent(canal.id)}`, { aprovacao: !canal.aprovacao });
        await recarregarServidorAtual();
        mostrarNotificacao(canal.aprovacao ? 'Entrada livre nesse canal.' : 'Agora o canal pede sua aprovação pra entrar (vale pra quem entrar daqui pra frente).', 'info');
    } catch (err) { mostrarNotificacao('Não foi possível alterar: ' + err.message); }
}

function adicionarControlesDeCanal(item, canal) {
    if (!servidorAtual.souDono) return; // só o dono mexe nos canais
    const lixo = document.createElement('span');
    lixo.className = 'btn-excluir-canal';
    lixo.title = 'Excluir canal';
    lixo.textContent = '🗑️';
    lixo.addEventListener('click', (e) => { e.stopPropagation(); excluirCanal(canal); });
    item.appendChild(lixo);
    item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        abrirMenu(e.clientX, e.clientY, () => ({
            cabecalho: canal.nome,
            itens: [
                { id: 'renomear', rotulo: '✏️ Renomear canal', acao: () => renomearCanal(canal) },
                ...(canal.tipo === 'voz' ? [{ id: 'aprovacao', rotulo: canal.aprovacao ? '🔓 Tirar aprovação de entrada' : '🔒 Exigir aprovação pra entrar', acao: () => alternarAprovacaoCanal(canal) }] : []),
                { id: 'excluir', rotulo: '🗑️ Excluir canal', perigo: true, acao: () => excluirCanal(canal) }
            ]
        }));
    });
}

function renderizarListaCanais() {
    document.getElementById('nome-servidor-cabecalho').textContent = servidorAtual.nome;

    const listaTexto = document.getElementById('lista-canais-texto');
    const listaVoz = document.getElementById('lista-canais-voz');
    listaTexto.innerHTML = '';
    listaVoz.innerHTML = '';

    servidorAtual.canais.filter(c => c.tipo === 'texto').forEach(canal => {
        const item = document.createElement('div');
        const abertoAgora = canalTextoAtual && canalTextoAtual.id === canal.id;
        const pendentesLeitura = abertoAgora && chatCanal.ativo() ? 0 : naoLidas(chaveCanalTexto(servidorAtual.id, canal.id));
        item.className = 'item-canal' + (abertoAgora ? ' ativo' : '') + (pendentesLeitura ? ' nao-lido' : '');
        item.title = canal.nome; // no layout Compacto/Cinema só o ícone aparece
        item.innerHTML = `<span class="icone-canal">#</span><span>${escaparHtml(canal.nome)}</span>${pendentesLeitura ? `<span class="badge-nl">${pendentesLeitura > 99 ? '99+' : pendentesLeitura}</span>` : ''}`;
        item.addEventListener('click', () => entrarCanalTexto(canal));
        adicionarControlesDeCanal(item, canal);
        listaTexto.appendChild(item);
    });

    servidorAtual.canais.filter(c => c.tipo === 'voz').forEach(canal => {
        const item = document.createElement('div');
        item.className = 'item-canal' + (canalVozAtual && canalVozAtual.id === canal.id ? ' ativo' : '');
        item.title = canal.nome;
        item.innerHTML = `<span class="icone-canal">🔊</span><span>${escaparHtml(canal.nome)}</span>${canal.aprovacao ? '<span class="cadeado">🔒</span>' : ''}`;
        item.addEventListener('click', () => entrarCanalVoz(canal));
        adicionarControlesDeCanal(item, canal);
        listaVoz.appendChild(item);

        // Mostra quem está dentro desse canal de voz, mesmo sem estar
        // olhando pra ele (igual o Discord mostra membros embaixo do canal).
        // Não depende de "roomVoz" já estar conectado — a lista aparece
        // assim que o canal vira o atual, e se preenche quando conectar.
        const sub = document.createElement('div');
        sub.className = 'sub-membros-voz';
        sub.id = 'sub-membros-' + canal.id;
        listaVoz.appendChild(sub);
    });

    // A cada vez que a lista é redesenhada (ela recria os containers do
    // zero), repreenche quem está na voz na hora — sem depender de quem
    // chamou renderizarListaCanais() lembrar de fazer isso depois.
    atualizarSubMembrosVoz();
}

// ---------- Links nas mensagens ----------
// O texto continua sendo inserido como texto puro (nunca como HTML). Só viram link os endereços
// http(s); ao clicar, o app mostra o endereço COMPLETO e pede confirmação antes de abrir o navegador.
const REGEX_LINK = /https?:\/\/[^\s<>"']+/gi;
function preencherTextoComLinks(el, texto) {
    el.textContent = '';
    let ultimo = 0;
    for (const achado of texto.matchAll(REGEX_LINK)) {
        let url = achado[0].replace(/[.,;:!?)\]]+$/, ''); // pontuação do fim da frase não faz parte do link
        let valido = false;
        try { const u = new URL(url); valido = (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password; } catch (e) { /* não é link */ }
        if (!valido) continue;
        if (achado.index > ultimo) el.appendChild(document.createTextNode(texto.slice(ultimo, achado.index)));
        const a = document.createElement('span');
        a.className = 'link-mensagem';
        a.textContent = url;
        a.title = 'Abrir link';
        a.addEventListener('click', () => confirmarAbrirLink(url));
        el.appendChild(a);
        ultimo = achado.index + url.length;
    }
    if (ultimo < texto.length) el.appendChild(document.createTextNode(texto.slice(ultimo)));
}
async function confirmarAbrirLink(url) {
    let destino = url;
    try { destino = new URL(url).href; } catch (e) { return; }
    const r = await pedirTexto({
        titulo: 'Abrir link no navegador?',
        dica: 'Destino: ' + destino + '\n\nSó abra se você confia em quem mandou. O Estrivisor não confere o conteúdo do link.',
        semCampo: true, rotuloOk: 'Abrir',
    });
    if (!r) return;
    try { await window.electronAPI.abrirLink(destino); } catch (e) { mostrarNotificacao('Não consegui abrir o link.'); }
}

// ---------- Caixa de texto própria ----------
// O Electron não tem prompt() (dá erro), então usamos uma janelinha da própria tela.
let resolverModalTexto = null;
let modalSemCampo = false;
let modalMultilinha = false;

// "semCampo" transforma a caixa numa confirmação (sem digitar nada), com o botão "rotuloOk".
function pedirTexto({ titulo, dica = '', valor = '', max = 40, rotuloCheckbox = '', semCampo = false, rotuloOk = 'OK', multilinha = false }) {
    return new Promise((resolve) => {
        if (resolverModalTexto) resolverModalTexto(null); // se já havia uma aberta, cancela
        resolverModalTexto = resolve;
        modalSemCampo = semCampo;
        modalMultilinha = multilinha && !semCampo;
        document.getElementById('modal-texto-ok').textContent = rotuloOk;
        document.getElementById('modal-texto-titulo').textContent = titulo;
        const dicaEl = document.getElementById('modal-texto-dica');
        dicaEl.textContent = dica;
        dicaEl.style.display = dica ? 'block' : 'none';
        const campoUnico = document.getElementById('modal-texto-input');
        const campoArea = document.getElementById('modal-texto-area');
        const input = modalMultilinha ? campoArea : campoUnico;
        campoUnico.style.display = (semCampo || modalMultilinha) ? 'none' : '';
        campoArea.style.display = modalMultilinha ? '' : 'none';
        input.maxLength = max;
        input.value = valor;
        document.getElementById('modal-texto-check-linha').style.display = rotuloCheckbox ? 'flex' : 'none';
        document.getElementById('modal-texto-check-rotulo').textContent = rotuloCheckbox;
        document.getElementById('modal-texto-check').checked = false;
        document.getElementById('modal-texto').style.display = 'flex';
        setTimeout(() => {
            if (semCampo) { document.getElementById('modal-texto-ok').focus(); return; } // Enter confirma
            input.focus(); if (input.select) input.select();
        }, 50);
    });
}

function fecharModalTexto(resultado) {
    document.getElementById('modal-texto').style.display = 'none';
    const resolver = resolverModalTexto;
    resolverModalTexto = null;
    if (resolver) resolver(resultado);
}

function confirmarModalTexto() {
    if (modalSemCampo) return fecharModalTexto({ texto: '', marcado: false });
    let texto;
    if (modalMultilinha) {
        // Mensagem: mantém as quebras de linha, tira só caracteres de controle.
        texto = document.getElementById('modal-texto-area').value
            .replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
    } else {
        texto = document.getElementById('modal-texto-input').value
            .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const marcadoVazio = document.getElementById('modal-texto-check-linha').style.display !== 'none' && document.getElementById('modal-texto-check').checked;
    if (!texto && !marcadoVazio) return mostrarNotificacao(modalMultilinha ? 'Escreva alguma coisa.' : 'Digite um nome.');
    fecharModalTexto({ texto, marcado: document.getElementById('modal-texto-check').checked });
}

document.getElementById('modal-texto-ok').addEventListener('click', confirmarModalTexto);
document.getElementById('modal-texto-cancelar').addEventListener('click', () => fecharModalTexto(null));
document.getElementById('modal-texto-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmarModalTexto();
    if (e.key === 'Escape') fecharModalTexto(null);
});
document.getElementById('modal-texto-area').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); confirmarModalTexto(); } // Shift+Enter quebra a linha
    if (e.key === 'Escape') fecharModalTexto(null);
});
document.getElementById('modal-texto').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-texto')) fecharModalTexto(null); // clicar fora cancela
});

// ---------- Nome do servidor ----------
function limparNomeServidor(texto) {
    return String(texto || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
}

// Tudo que mostra o nome do servidor é atualizado aqui: cabeçalho, barra "Voz conectada",
// título da janela e o status do Discord ("Online no Estrivisor" / "canal · servidor").
function aplicarNomeServidor() {
    document.title = `${servidorAtual.nome} — Estrivisor`;
    document.getElementById('nome-servidor-cabecalho').textContent = servidorAtual.nome;
    atualizarStatusVozPersistente();
    atualizarPresencaDiscord();
}

// ---------- Criar canais (só o dono) ----------
// O servidor guarda os canais; todo mundo do servidor vê o canal novo na hora (via ping).
async function criarCanal(tipo) {
    if (!servidorAtual.souDono) return;
    const ehVoz = tipo === 'voz';
    const r = await pedirTexto({
        titulo: ehVoz ? 'Novo canal de voz' : 'Novo canal de texto',
        dica: 'O canal aparece pra todo mundo do servidor.',
        max: 30,
        rotuloCheckbox: ehVoz ? 'Exigir minha aprovação pra entrar (você é o anfitrião)' : ''
    });
    if (!r) return;
    try {
        await api('POST', `/servidores/${servidorAtual.id}/canais`, { tipo, nome: r.texto, aprovacao: ehVoz && r.marcado });
        await recarregarServidorAtual();
    } catch (err) {
        mostrarNotificacao(err.message);
    }
}
document.getElementById('btn-add-texto').addEventListener('click', () => criarCanal('texto'));
document.getElementById('btn-add-voz').addEventListener('click', () => criarCanal('voz'));

// ============================================================
// Canal de TEXTO — mensagens salvas no servidor
// ============================================================
// O histórico fica guardado no servidor do Estrivisor (no seu notebook), então aparece ao
// abrir o canal, chega mesmo com outro canal aberto (contador de não lidas) e não usa o LiveKit.
// O app pergunta "o que veio depois da mensagem N?" a cada ~1,5 s enquanto o canal está aberto.
const CHAVE_LIDAS = 'estrivisor_lidas';
let lidasMapa = {};
try { lidasMapa = JSON.parse(localStorage.getItem(CHAVE_LIDAS) || '{}') || {}; } catch (e) { lidasMapa = {}; }
let ultimasConhecidas = {}; // chave da conversa -> número da última mensagem (vem dos pings)
let assinaturaBadges = '';

const chaveCanalTexto = (servidorId, canalId) => `c:${servidorId}:${canalId}`;
const chaveDmLocal = (usuario) => `d:${usuario}`;
function salvarLidas() { try { localStorage.setItem(CHAVE_LIDAS, JSON.stringify(lidasMapa)); } catch (e) {} }
function marcarLida(chave, seq) {
    if (!(seq > (lidasMapa[chave] || 0))) return;
    lidasMapa[chave] = seq;
    salvarLidas();
    atualizarBadges();
}
// Guarda os "últimos números" que o servidor informou. Na primeira vez que vê uma conversa,
// considera tudo como lido (senão o histórico antigo viraria uma enxurrada de não lidas).
function registrarUltimas(mapa) {
    let mudouLidas = false;
    Object.keys(mapa || {}).forEach((chave) => {
        const v = Number(mapa[chave]) || 0;
        // Chegou mensagem nova numa conversa que você não está lendo agora: toca o som.
        if (ultimasConhecidas[chave] !== undefined && v > ultimasConhecidas[chave] && v > (lidasMapa[chave] || 0)) somDeMensagem(chave, v);
        ultimasConhecidas[chave] = v;
        if (lidasMapa[chave] === undefined) { lidasMapa[chave] = v; mudouLidas = true; }
    });
    if (mudouLidas) salvarLidas();
}
const naoLidas = (chave) => Math.max(0, (ultimasConhecidas[chave] || 0) - (lidasMapa[chave] || 0));
function naoLidasDoServidor(servidor) {
    return (servidor.canais || []).filter((c) => c.tipo === 'texto').reduce((t, c) => t + naoLidas(chaveCanalTexto(servidor.id, c.id)), 0);
}
function totalDmNaoLidas() {
    return (amigosEstado.amigos || []).reduce((t, a) => t + naoLidas(chaveDmLocal(a.usuario)), 0);
}
// Redesenha as listas só quando algum contador mudou (os pings chegam a cada 10 s).
function atualizarBadges() {
    const partes = meusServidores.map((s) => s.id + ':' + naoLidasDoServidor(s) + ':' +
        (s.canais || []).filter((c) => c.tipo === 'texto').map((c) => naoLidas(chaveCanalTexto(s.id, c.id))).join(','));
    const assinatura = partes.join('|') + '#' + totalDmNaoLidas() + '#' + (amigosEstado.recebidos || []).length;
    if (assinatura === assinaturaBadges) return;
    assinaturaBadges = assinatura;
    renderizarListaCanais();
    renderizarBarraServidores();
    if (amigosAbertos()) renderizarAmigos();
}

// ---------- Reações e prévia de links no chat ----------
let seletorReacaoAberto = null;
function fecharSeletorReacao() {
    if (seletorReacaoAberto) { seletorReacaoAberto.remove(); seletorReacaoAberto = null; }
}
function abrirSeletorReacao(botao, aoEscolher) {
    fecharSeletorReacao();
    const caixa = document.createElement('div');
    caixa.className = 'seletor-reacao';
    window.Social.EMOJIS_REACAO.forEach((emoji) => {
        const b = document.createElement('button');
        b.textContent = emoji;
        b.addEventListener('click', () => { fecharSeletorReacao(); aoEscolher(emoji); });
        caixa.appendChild(b);
    });
    document.body.appendChild(caixa);
    const r = botao.getBoundingClientRect();
    const larg = caixa.offsetWidth, alt = caixa.offsetHeight;
    caixa.style.left = Math.max(8, Math.min(window.innerWidth - larg - 8, r.right - larg)) + 'px';
    caixa.style.top = (r.bottom + alt + 8 > window.innerHeight ? Math.max(8, r.top - alt - 4) : r.bottom + 4) + 'px';
    seletorReacaoAberto = caixa;
}
document.addEventListener('click', (e) => { if (seletorReacaoAberto && !seletorReacaoAberto.contains(e.target)) fecharSeletorReacao(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharSeletorReacao(); });

const CHAVE_PREVIA_LINKS = 'estrivisor_previa_links';
function previaLinksLigada() {
    try { return localStorage.getItem(CHAVE_PREVIA_LINKS) !== '0'; } catch (e) { return true; }
}
const cachePrevias = new Map(); // url -> Promise da prévia (ou null)
function buscarPrevia(url) {
    if (cachePrevias.has(url)) return cachePrevias.get(url);
    if (cachePrevias.size >= 150) cachePrevias.delete(cachePrevias.keys().next().value);
    const p = api('POST', '/previa', { url })
        .then((d) => window.Social.previaValida(d && d.previa))
        .catch(() => { cachePrevias.delete(url); return null; }); // sem internet/erro: tenta de novo da próxima vez
    cachePrevias.set(url, p);
    return p;
}
function anexarPreviaDoLink(corpoEl, texto) {
    if (!previaLinksLigada()) return;
    const url = window.Social.primeiroLink(texto);
    if (!url) return;
    buscarPrevia(url).then((previa) => {
        if (!previa || !corpoEl.isConnected) return;
        const card = document.createElement('div');
        card.className = 'previa-link';
        card.title = 'Abrir link';
        const site = document.createElement('div'); site.className = 'previa-site'; site.textContent = previa.site || previa.dominio;
        card.appendChild(site);
        if (previa.titulo) { const t = document.createElement('div'); t.className = 'previa-titulo'; t.textContent = previa.titulo; card.appendChild(t); }
        if (previa.descricao) { const d = document.createElement('div'); d.className = 'previa-desc'; d.textContent = previa.descricao; card.appendChild(d); }
        card.addEventListener('click', () => confirmarAbrirLink(url));
        const barra = corpoEl.querySelector('.reacoes-mensagem');
        corpoEl.insertBefore(card, barra || null);
    });
}
{
    const caixa = document.getElementById('check-previa-links');
    caixa.checked = previaLinksLigada();
    caixa.addEventListener('change', () => { try { localStorage.setItem(CHAVE_PREVIA_LINKS, caixa.checked ? '1' : '0'); } catch (e) { /* vale só até fechar */ } });
}

// ---------- Imagens, GIFs e prints no chat ----------
// Guardadas no servidor (como os sons). Aqui: preparar o arquivo antes de enviar, baixar/mostrar na mensagem e ampliar.
const cacheImagens = new Map(); // chave -> { p: Promise<entrada>, e: entrada|null }
let bytesNoCacheImagens = 0;
const LIMITE_CACHE_IMAGENS = 80 * 1024 * 1024;
function carregarImagemDoChat(caminho, seq) {
    const chave = caminho + '#' + seq;
    const guardada = cacheImagens.get(chave);
    if (guardada) return guardada.p;
    const reg = { p: null, e: null };
    reg.p = api('GET', `${caminho}/${seq}/imagem`).then((d) => {
        if (!d || typeof d.dados !== 'string' || !window.Imagens.TIPOS.includes(d.tipo)) throw new Error('Imagem inválida.');
        const bin = atob(d.dados);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        if (window.Imagens.tipoPorBytes(u8) !== d.tipo) throw new Error('Imagem inválida.');
        const blob = new Blob([u8], { type: d.tipo });
        reg.e = { url: URL.createObjectURL(blob), blob, tipo: d.tipo, bytes: u8.length, compactada: d.compactada === true };
        bytesNoCacheImagens += u8.length;
        for (const [k, v] of cacheImagens) { // tira as mais antigas se passar do limite
            if (bytesNoCacheImagens <= LIMITE_CACHE_IMAGENS || k === chave) break;
            if (v.e) { URL.revokeObjectURL(v.e.url); bytesNoCacheImagens -= v.e.bytes; cacheImagens.delete(k); }
        }
        return reg.e;
    }).catch((err) => { cacheImagens.delete(chave); throw err; });
    cacheImagens.set(chave, reg);
    return reg.p;
}
function blobParaBase64(blob) {
    return new Promise((ok, falha) => {
        const l = new FileReader();
        l.onload = () => ok(String(l.result).split(',')[1] || '');
        l.onerror = () => falha(new Error('Não consegui ler a imagem.'));
        l.readAsDataURL(blob);
    });
}
async function blobParaPng(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui converter a imagem.'))), 'image/png'));
}
// Confere o arquivo escolhido/colado/arrastado e deixa pronto pra enviar: formato pelos bytes, e reduz se for enorme.
async function prepararImagemParaEnvio(arquivo) {
    const I = window.Imagens;
    if (!arquivo || !arquivo.size) throw new Error('Não consegui ler essa imagem.');
    if (arquivo.size > 40 * 1024 * 1024) throw new Error('Imagem grande demais (máximo 6 MB depois de reduzir).');
    const tipo = I.tipoPorBytes(new Uint8Array(await arquivo.slice(0, 32).arrayBuffer()));
    if (!tipo) throw new Error('Formato não aceito. Use PNG, JPG, GIF ou WEBP.');
    let bmp;
    try { bmp = await createImageBitmap(arquivo); } catch (e) { throw new Error('Não consegui ler essa imagem.'); }
    let blob = arquivo, tipoFinal = tipo, w = bmp.width, h = bmp.height;
    if (I.deveReencodar({ tipo, bytes: arquivo.size, w, h })) {
        for (const [lado, q] of [[I.LADO_MAXIMO, 0.9], [I.LADO_MAXIMO, 0.78], [1280, 0.7]]) {
            const d = I.dimensoesAlvo(w, h, lado);
            const c = document.createElement('canvas');
            c.width = d.w; c.height = d.h;
            c.getContext('2d').drawImage(bmp, 0, 0, d.w, d.h);
            const novo = await new Promise((ok) => c.toBlob(ok, 'image/webp', q));
            if (novo && novo.type === 'image/webp' && novo.size <= I.MAX_BYTES) {
                if (novo.size < arquivo.size || arquivo.size > I.MAX_BYTES) { blob = novo; tipoFinal = 'image/webp'; w = d.w; h = d.h; }
                break;
            }
        }
    }
    // Versão compacta (alguns KB): o servidor guarda junto e, quando o espaço dele acaba, fica só com ela
    // nas imagens mais antigas. Assim nenhuma imagem some. (De GIF vai o primeiro quadro.)
    let mini = null;
    if (blob.size > 150 * 1024) {
        for (const [lado, q] of [[1024, 0.72], [800, 0.6], [640, 0.5]]) {
            const d = I.dimensoesAlvo(bmp.width, bmp.height, lado);
            const c = document.createElement('canvas');
            c.width = d.w; c.height = d.h;
            c.getContext('2d').drawImage(bmp, 0, 0, d.w, d.h);
            const novo = await new Promise((ok) => c.toBlob(ok, 'image/webp', q));
            if (novo && novo.type === 'image/webp' && novo.size <= 300 * 1024 && novo.size < blob.size * 0.8) { mini = novo; break; }
        }
    }
    if (bmp.close) bmp.close();
    if (blob.size > I.MAX_BYTES) throw new Error('Imagem grande demais (máximo 6 MB).');
    return { blob, mini, tipo: tipoFinal, w, h, nome: arquivo.name || '' };
}

let imagemAmpliada = null;
function abrirImagemAmpliada(entrada) {
    imagemAmpliada = entrada;
    document.getElementById('lightbox-img').src = entrada.url;
    document.getElementById('lightbox-nota').textContent = entrada.compactada ? 'Versão reduzida: a original é antiga e foi compactada para economizar espaço no servidor.' : '';
    document.getElementById('lightbox-imagem').classList.add('aberto');
}
function fecharImagemAmpliada() {
    imagemAmpliada = null;
    document.getElementById('lightbox-imagem').classList.remove('aberto');
    document.getElementById('lightbox-img').removeAttribute('src');
}
document.getElementById('lightbox-fechar').addEventListener('click', fecharImagemAmpliada);
document.getElementById('lightbox-imagem').addEventListener('click', (e) => { if (e.target.id === 'lightbox-imagem') fecharImagemAmpliada(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && imagemAmpliada) { e.stopPropagation(); fecharImagemAmpliada(); } }, true);
document.getElementById('lightbox-copiar').addEventListener('click', async () => {
    if (!imagemAmpliada) return;
    try {
        const png = await blobParaPng(imagemAmpliada.blob);
        const r = await window.electronAPI.copiarImagem({ tipo: 'image/png', base64: await blobParaBase64(png) });
        mostrarNotificacao(r && r.ok ? 'Imagem copiada!' : 'Não consegui copiar a imagem.', r && r.ok ? 'info' : undefined);
    } catch (err) { mostrarNotificacao('Não consegui copiar a imagem.'); }
});
document.getElementById('lightbox-salvar').addEventListener('click', async () => {
    if (!imagemAmpliada) return;
    try {
        const r = await window.electronAPI.salvarImagem({ tipo: imagemAmpliada.tipo, base64: await blobParaBase64(imagemAmpliada.blob) });
        if (r && r.ok) mostrarNotificacao('Imagem salva!', 'info');
        else if (r && !r.cancelado) mostrarNotificacao(r.erro || 'Não consegui salvar a imagem.');
    } catch (err) { mostrarNotificacao('Não consegui salvar a imagem.'); }
});
// Põe a imagem da mensagem dentro de "corpoEl" (antes das prévias/reações). O espaço é reservado pelo tamanho que o servidor guardou.
function anexarImagemDaMensagem(corpoEl, m, caminho) {
    const ancora = corpoEl.querySelector('.reacoes-mensagem') || null;
    if (m.imagemRemovida && !m.imagem) {
        const aviso = document.createElement('div');
        aviso.className = 'imagem-removida';
        aviso.textContent = '🖼️ Imagem antiga removida do servidor.';
        corpoEl.insertBefore(aviso, ancora);
        return;
    }
    const info = window.Imagens.imagemRecebida(m.imagem);
    if (!info) return;
    const caixa = window.Imagens.caixaDeExibicao(info.w, info.h) || { w: 280, h: 180 };
    const box = document.createElement('div');
    box.className = 'imagem-mensagem';
    box.style.width = caixa.w + 'px';
    box.style.height = caixa.h + 'px';
    const estado = document.createElement('div');
    estado.className = 'imagem-estado';
    estado.textContent = '🖼️ Carregando imagem...';
    box.appendChild(estado);
    corpoEl.insertBefore(box, ancora);
    const mostrar = (entrada) => {
        const img = document.createElement('img');
        img.alt = 'Imagem enviada por ' + String(m.nome || '').slice(0, 40);
        img.draggable = false;
        img.src = entrada.url;
        box.replaceChildren(img);
        box.onclick = () => abrirImagemAmpliada(entrada);
    };
    const pronta = cacheImagens.get(caminho + '#' + m.seq);
    if (pronta && pronta.e) { mostrar(pronta.e); return; } // já baixada: sem piscar ao redesenhar
    const carregar = () => {
        box.classList.remove('erro'); estado.textContent = '🖼️ Carregando imagem...';
        carregarImagemDoChat(caminho, m.seq).then(mostrar).catch(() => { box.classList.add('erro'); estado.textContent = '🖼️ Não consegui carregar a imagem. Clique pra tentar de novo.'; box.onclick = carregar; });
    };
    carregar();
}

// ---------- Controlador de chat (serve pros canais e pras mensagens diretas) ----------
function criarChat({ container, input, aoSemAcesso }) {
    let cfg = null;              // { caminho, chaveLida, podeModerar }
    let msgs = [];
    let temMais = false;
    let ativo = false, carregou = false, enviando = false, carregandoAntigas = false;
    let token = 0, timer = null, ciclos = 0;

    const maxSeq = () => (msgs.length ? msgs[msgs.length - 1].seq : 0);
    const noFundo = () => container.scrollHeight - container.scrollTop - container.clientHeight < 90;
    const descerAoFim = () => { container.scrollTop = container.scrollHeight; };
    const aVista = () => ativo && !document.hidden && document.hasFocus() && container.offsetParent !== null;
    const marcarVisto = () => { if (cfg && msgs.length && aVista()) marcarLida(cfg.chaveLida, maxSeq()); };

    const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
    function rotuloDia(ts) {
        const d = new Date(ts), hoje = new Date(), ontem = new Date(Date.now() - 86400000);
        if (d.toDateString() === hoje.toDateString()) return 'Hoje';
        if (d.toDateString() === ontem.toDateString()) return 'Ontem';
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    function elementoMensagem(m, anterior) {
        const agrupada = anterior && anterior.usuario === m.usuario && mesmoDia(anterior.ts, m.ts) && m.ts - anterior.ts < 5 * 60 * 1000;
        const el = document.createElement('div');
        el.className = 'mensagem-chat' + (agrupada ? ' agrupada' : '');
        el.dataset.seq = String(m.seq);
        const hora = new Date(m.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const ehEu = m.usuario === obterIdentidadeUsuario();
        el.innerHTML = `
            <div class="avatar-mensagem"></div>
            <div class="corpo-mensagem">
                <div class="cabecalho-mensagem"><span class="autor-mensagem"></span><span class="hora-mensagem">${hora}</span></div>
                <div class="texto-mensagem"></div>
            </div>`;
        el.querySelector('.autor-mensagem').textContent = String(m.nome || '?').slice(0, 40) + (ehEu ? ' (você)' : '');
        const textoEl = el.querySelector('.texto-mensagem');
        preencherTextoComLinks(textoEl, String(m.texto || '').slice(0, 2000));
        if (m.editadoEm) { const ed = document.createElement('span'); ed.className = 'editada'; ed.textContent = '(editada)'; textoEl.appendChild(ed); }
        aplicarAvatar(el.querySelector('.avatar-mensagem'), m.usuario, m.nome || '?', urlAvatarSegura(m.avatar));
        const corpoEl = el.querySelector('.corpo-mensagem');
        if (!m.texto) textoEl.style.display = 'none';
        if (m.imagem || m.imagemRemovida) anexarImagemDaMensagem(corpoEl, m, cfg && cfg.caminho);
        anexarPreviaDoLink(corpoEl, m.texto);
        const barraReacoes = document.createElement('div');
        barraReacoes.className = 'reacoes-mensagem';
        window.Social.resumoReacoes(m.reacoes, obterIdentidadeUsuario()).forEach((r) => {
            const chip = document.createElement('button');
            chip.className = 'reacao-chip' + (r.minha ? ' minha' : '');
            chip.title = r.minha ? 'Tirar a sua reação' : 'Reagir também';
            chip.innerHTML = '<span class="emo"></span><span class="qtd"></span>';
            chip.querySelector('.emo').textContent = r.emoji;
            chip.querySelector('.qtd').textContent = String(r.qtd);
            chip.addEventListener('click', () => reagir(m, r.emoji));
            barraReacoes.appendChild(chip);
        });
        corpoEl.appendChild(barraReacoes);

        const podeApagar = ehEu || (cfg && cfg.podeModerar());
        {
            const acoes = document.createElement('div');
            acoes.className = 'acoes-mensagem';
            const bReagir = document.createElement('button'); bReagir.textContent = '😀'; bReagir.title = 'Reagir';
            bReagir.addEventListener('click', (e) => { e.stopPropagation(); abrirSeletorReacao(bReagir, (emoji) => reagir(m, emoji)); });
            acoes.appendChild(bReagir);
            if (m.texto) {
                const bCopiar = document.createElement('button'); bCopiar.textContent = '📋'; bCopiar.title = 'Copiar o texto da mensagem';
                bCopiar.addEventListener('click', () => copiarTexto(m.texto, 'Mensagem copiada!'));
                acoes.appendChild(bCopiar);
            }
            if (!ehEu) {
                const b = document.createElement('button'); b.textContent = '🚩'; b.title = 'Denunciar';
                b.addEventListener('click', () => denunciarMensagem(m, cfg && cfg.caminho));
                acoes.appendChild(b);
            }
            if (ehEu && m.texto) {
                const b = document.createElement('button'); b.textContent = '✏️'; b.title = 'Editar';
                b.addEventListener('click', () => editar(m));
                acoes.appendChild(b);
            }
            if (podeApagar) {
                const b = document.createElement('button'); b.textContent = '🗑️'; b.title = 'Apagar';
                b.addEventListener('click', () => apagar(m));
                acoes.appendChild(b);
            }
            el.appendChild(acoes);
        }
        return el;
    }
    function separadorDia(ts) {
        const d = document.createElement('div');
        d.className = 'separador-dia';
        d.textContent = rotuloDia(ts);
        return d;
    }
    function desenharTudo() {
        container.innerHTML = '';
        if (temMais) { const r = document.createElement('div'); r.className = 'rotulo-sistema'; r.textContent = 'Role pra cima pra ver mensagens mais antigas.'; container.appendChild(r); }
        else if (!msgs.length) { const r = document.createElement('div'); r.className = 'rotulo-sistema'; r.textContent = 'Nenhuma mensagem ainda. Diga oi! 👋'; container.appendChild(r); }
        let ant = null;
        msgs.forEach((m) => {
            if (!ant || !mesmoDia(ant.ts, m.ts)) container.appendChild(separadorDia(m.ts));
            container.appendChild(elementoMensagem(m, ant && mesmoDia(ant.ts, m.ts) ? ant : null));
            ant = m;
        });
    }
    function anexar(novas, propria) {
        const fundo = noFundo();
        let mudou = false;
        novas.forEach((m) => {
            if (m.seq <= maxSeq()) return; // já tinha
            const ant = msgs.length ? msgs[msgs.length - 1] : null;
            if (!msgs.length) container.innerHTML = '';
            if (!ant || !mesmoDia(ant.ts, m.ts)) container.appendChild(separadorDia(m.ts));
            container.appendChild(elementoMensagem(m, ant && mesmoDia(ant.ts, m.ts) ? ant : null));
            msgs.push(m);
            if (m.usuario !== obterIdentidadeUsuario()) { registrarMensagemFlutuante(m); if (cfg) somDeMensagem(cfg.chaveLida, m.seq); }
            mudou = true;
        });
        if (!mudou) return;
        if (propria || fundo) descerAoFim();
        if (propria && cfg) marcarLida(cfg.chaveLida, maxSeq()); else marcarVisto();
    }

    async function carregarInicial(meu) {
        const r = await api('GET', `${cfg.caminho}?limite=50`);
        if (meu !== token) return;
        msgs = r.mensagens; temMais = r.temMais; carregou = true;
        desenharTudo(); descerAoFim(); marcarVisto();
    }
    async function sincronizar(meu) {
        // De tempos em tempos confere as últimas 50: pega mensagens editadas ou apagadas por outras pessoas.
        const r = await api('GET', `${cfg.caminho}?limite=50`);
        if (meu !== token) return;
        const minimo = r.mensagens.length ? r.mensagens[0].seq : r.ultimaSeq + 1;
        const lista = msgs.filter((m) => m.seq < minimo).concat(r.mensagens);
        const assin = (l) => l.map((m) => m.seq + ':' + (m.editadoEm || 0) + ':' + (m.imagemRemovida ? 1 : 0) + ':' + window.Social.assinaturaReacoes(m.reacoes)).join(',');
        if (assin(lista) === assin(msgs)) return;
        const fundo = noFundo();
        msgs = lista;
        desenharTudo();
        if (fundo) descerAoFim();
        marcarVisto();
    }
    async function ciclo() {
        const meu = token;
        if (!ativo || !cfg) return;
        try {
            if (!carregou) await carregarInicial(meu);
            else {
                const r = await api('GET', `${cfg.caminho}?depois=${maxSeq()}`);
                if (meu !== token) return;
                if (r.mensagens.length) anexar(r.mensagens, false);
                ciclos++;
                if (ciclos % 6 === 0) await sincronizar(meu);
            }
        } catch (err) {
            if (meu === token && (err.status === 403 || err.status === 404) && aoSemAcesso) { aoSemAcesso(err); return; }
            if (meu === token && !carregou) { container.innerHTML = '<div class="rotulo-sistema">Não consegui carregar as mensagens. Tentando de novo...</div>'; }
        }
        if (meu === token && ativo) timer = setTimeout(ciclo, document.hidden ? 8000 : 1500);
    }

    async function carregarAntigas() {
        if (carregandoAntigas || !temMais || !msgs.length) return;
        carregandoAntigas = true;
        const meu = token;
        try {
            const r = await api('GET', `${cfg.caminho}?antes=${msgs[0].seq}&limite=50`);
            if (meu !== token) return;
            const alturaAntes = container.scrollHeight;
            msgs = r.mensagens.concat(msgs); temMais = r.temMais;
            desenharTudo();
            container.scrollTop = container.scrollHeight - alturaAntes;
        } catch (e) { /* tenta de novo na próxima rolagem */ }
        carregandoAntigas = false;
    }
    container.addEventListener('scroll', () => { if (ativo && container.scrollTop < 60) carregarAntigas(); });

    // ---- Imagem pendente (colada, escolhida ou arrastada), mostrada acima da caixa de texto até enviar ----
    const campoWrap = input.closest('.campo-mensagem-wrap');
    const barraAnexo = campoWrap.querySelector('.anexo-pendente');
    const botaoAnexar = campoWrap.querySelector('.btn-anexar-imagem');
    const areaChat = container.parentElement;
    let anexo = null; // { blob, tipo, w, h, nome, url }
    function limparAnexo() {
        if (anexo) URL.revokeObjectURL(anexo.url);
        anexo = null;
        barraAnexo.hidden = true; barraAnexo.replaceChildren();
    }
    function mostrarAnexo() {
        barraAnexo.replaceChildren();
        const mini = document.createElement('img'); mini.src = anexo.url; mini.alt = 'Imagem pronta pra enviar';
        const info = document.createElement('div'); info.className = 'anexo-info';
        const nome = document.createElement('b'); nome.textContent = anexo.nome ? anexo.nome.slice(0, 60) : 'Imagem colada';
        const det = document.createElement('span'); det.textContent = `${window.Imagens.formatarTamanho(anexo.blob.size)} · ${anexo.w}×${anexo.h} · Enter envia (a legenda é opcional)`;
        info.append(nome, det);
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '✖'; x.title = 'Tirar a imagem';
        x.addEventListener('click', () => { limparAnexo(); input.focus(); });
        barraAnexo.append(mini, info, x);
        barraAnexo.hidden = false;
    }
    async function receberArquivoDeImagem(arquivo) {
        if (!ativo || !cfg) return;
        try {
            const pronto = await prepararImagemParaEnvio(arquivo);
            limparAnexo();
            anexo = { ...pronto, url: URL.createObjectURL(pronto.blob) };
            mostrarAnexo();
            input.focus();
        } catch (err) { mostrarNotificacao(err && err.message ? err.message : 'Não consegui usar essa imagem.'); }
    }
    const entradaArquivo = document.createElement('input');
    entradaArquivo.type = 'file'; entradaArquivo.accept = 'image/png,image/jpeg,image/gif,image/webp'; entradaArquivo.style.display = 'none';
    document.body.appendChild(entradaArquivo);
    botaoAnexar.addEventListener('click', () => entradaArquivo.click());
    entradaArquivo.addEventListener('change', () => { const f = entradaArquivo.files && entradaArquivo.files[0]; entradaArquivo.value = ''; if (f) receberArquivoDeImagem(f); });
    // Ctrl+V: print ou imagem copiada. Se vier texto junto, vale o texto (colagem normal).
    document.addEventListener('paste', (e) => {
        if (!ativo || container.offsetParent === null) return;
        const alvo = e.target;
        if (alvo && alvo !== input && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return; // é pra outro campo
        const item = window.Imagens.escolherImagemColada(e.clipboardData && e.clipboardData.items);
        const arq = item && item.getAsFile();
        if (!arq) return;
        e.preventDefault();
        receberArquivoDeImagem(arq);
    });
    // Arrastar uma imagem pra cima do chat.
    const arrastoTemArquivo = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    areaChat.addEventListener('dragover', (e) => { if (!ativo || !arrastoTemArquivo(e)) return; e.preventDefault(); e.stopPropagation(); areaChat.classList.add('arrastando-imagem'); });
    areaChat.addEventListener('dragleave', (e) => { if (!areaChat.contains(e.relatedTarget)) areaChat.classList.remove('arrastando-imagem'); });
    areaChat.addEventListener('drop', (e) => {
        if (!ativo || !arrastoTemArquivo(e)) return;
        e.preventDefault(); e.stopPropagation();
        areaChat.classList.remove('arrastando-imagem');
        const f = Array.from(e.dataTransfer.files || []).find((x) => /^image\//.test(x.type)) || (e.dataTransfer.files || [])[0];
        if (f) receberArquivoDeImagem(f);
    });

    async function enviar() {
        if (!ativo || !cfg || enviando) return;
        const texto = input.value.trim().slice(0, 2000);
        if (!texto && !anexo) return;
        enviando = true;
        try {
            let r;
            if (anexo) {
                const envio = anexo;
                r = await api('POST', cfg.caminho.replace(/\/mensagens$/, '/imagens'), {
                    texto, nome: obterNomeUsuario(), dados: await blobParaBase64(envio.blob), largura: envio.w, altura: envio.h,
                    compacta: envio.mini ? await blobParaBase64(envio.mini) : undefined,
                });
                limparAnexo();
            } else r = await api('POST', cfg.caminho, { texto, nome: obterNomeUsuario() });
            input.value = ''; input.style.height = 'auto';
            anexar([r.mensagem], true);
        } catch (err) {
            mostrarNotificacao('A mensagem não foi enviada: ' + (err && err.message ? err.message : 'erro desconhecido'));
        } finally { enviando = false; }
    }
    const ajustarAltura = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; };
    input.addEventListener('input', ajustarAltura);
    input.addEventListener('keydown', (e) => {
        // Como no Discord: Enter envia, Shift+Enter quebra a linha.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
    });

    async function reagir(m, emoji) {
        const meu = token;
        try {
            const d = await api('POST', `${cfg.caminho}/${m.seq}/reacao`, { emoji });
            if (meu !== token) return;
            const i = msgs.findIndex((x) => x.seq === m.seq);
            if (i >= 0) { msgs[i] = d.mensagem; const fundo = noFundo(); desenharTudo(); if (fundo) descerAoFim(); }
        } catch (err) { mostrarNotificacao('Não consegui reagir: ' + err.message); }
    }
    async function editar(m) {
        const r = await pedirTexto({ titulo: 'Editar mensagem', dica: 'Enter confirma; Shift+Enter quebra a linha.', valor: m.texto, max: 2000, multilinha: true });
        if (!r || !r.texto.trim() || r.texto === m.texto) return;
        try {
            const d = await api('PATCH', `${cfg.caminho}/${m.seq}`, { texto: r.texto });
            const i = msgs.findIndex((x) => x.seq === m.seq);
            if (i >= 0) { msgs[i] = d.mensagem; const fundo = noFundo(); desenharTudo(); if (fundo) descerAoFim(); }
        } catch (err) { mostrarNotificacao('Não consegui editar: ' + err.message); }
    }
    async function apagar(m) {
        const r = await pedirTexto({ titulo: 'Apagar mensagem?', dica: 'Ela some pra todo mundo.', semCampo: true, rotuloOk: 'Apagar' });
        if (!r) return;
        try {
            await api('DELETE', `${cfg.caminho}/${m.seq}`);
            msgs = msgs.filter((x) => x.seq !== m.seq);
            const fundo = noFundo(); desenharTudo(); if (fundo) descerAoFim();
        } catch (err) { mostrarNotificacao('Não consegui apagar: ' + err.message); }
    }

    function abrir(novaCfg) {
        fechar();
        cfg = novaCfg; ativo = true; carregou = false; msgs = []; temMais = false; ciclos = 0;
        token++;
        input.value = ''; limparAnexo();
        container.innerHTML = '<div class="rotulo-sistema">Carregando mensagens...</div>';
        ciclo();
    }
    function fechar() {
        ativo = false; token++;
        if (timer) { clearTimeout(timer); timer = null; }
        limparAnexo();
        cfg = null; msgs = [];
    }
    return { abrir, fechar, marcarVisto, ativo: () => ativo };
}

let canalTextoAtual = null;
const chatCanal = criarChat({
    container: document.getElementById('mensagens-chat'),
    input: document.getElementById('input-mensagem'),
    aoSemAcesso: () => { if (servidorAtual.id) perdeuAcesso(servidorAtual.id); }
});

function estadoConectado() {
    return (LivekitClient.ConnectionState && LivekitClient.ConnectionState.Connected) || 'connected';
}

function entrarCanalTexto(canal) {
    if (!obterNomeUsuario()) return mostrarNotificacao('Aguarde o perfil carregar ou defina seu nome primeiro.');
    const servidorId = servidorAtual.id;
    sairDoTextoAtual();
    canalTextoAtual = canal;
    document.getElementById('cabecalho-canal').innerHTML = `<span class="icone-canal">#</span> <span>${escaparHtml(canal.nome)}</span>`;
    document.getElementById('area-vazia').style.display = 'none';
    // No Cinema, se você está numa sala de voz, a transmissão continua na tela ao lado do chat.
    document.getElementById('area-voz').style.display = (layoutCinemaAtivo() && canalVozAtual) ? 'flex' : 'none';
    document.getElementById('area-texto').style.display = 'flex';
    atualizarCinemaDuplo();
    document.getElementById('input-mensagem').placeholder = `Enviar mensagem em #${canal.nome}`;
    chatCanal.abrir({
        caminho: `/servidores/${servidorId}/canais/${canal.id}/mensagens`,
        chaveLida: chaveCanalTexto(servidorId, canal.id),
        podeModerar: () => servidorAtual.id === servidorId && servidorAtual.souDono === true
    });
    renderizarListaCanais();
    document.getElementById('input-mensagem').focus();
}

// ============================================================
// Canal de VOZ
// ============================================================
let tentativaVoz = 0;       // muda a cada entrada/saída: respostas atrasadas de uma tentativa antiga são ignoradas
let conectandoVoz = false;  // pedindo token, esperando a aprovação do dono ou conectando
let avisoConexaoVoz = '';   // '' | 'conectando' | 'aguardando' | 'reconectando' (aparece no quadro da voz)

// Só conta como "na chamada" depois de conectar de verdade. Antes disso o app não liga
// microfone, não transmite e não diz pros outros que você está no canal.
function vozConectada() {
    return Boolean(roomVoz) && !conectandoVoz;
}

function mostrarAreaVoz(canal) {
    document.getElementById('cabecalho-canal').innerHTML = `<span class="icone-canal">🔊</span> <span>${escaparHtml(canal.nome)}</span>`;
    document.getElementById('area-vazia').style.display = 'none';
    document.getElementById('area-texto').style.display = (layoutCinemaAtivo() && canalTextoAtual) ? 'flex' : 'none';
    document.getElementById('area-voz').style.display = 'flex';
    atualizarCinemaDuplo();
}

// Explica por que a chamada caiu (quando não foi você que saiu).
function textoDesconexao(motivo) {
    const M = LivekitClient.DisconnectReason || {};
    if (motivo !== undefined && motivo === M.PARTICIPANT_REMOVED) return 'Você foi removido da chamada.';
    if (motivo !== undefined && motivo === M.ROOM_DELETED) return 'Esse canal de voz foi fechado.';
    if (motivo !== undefined && motivo === M.DUPLICATE_IDENTITY) return 'Você entrou nesse canal em outro lugar (outra janela ou outro PC), então esta conexão foi encerrada.';
    if (motivo !== undefined && motivo === M.SERVER_SHUTDOWN) return 'O servidor de voz reiniciou. Entre no canal de novo.';
    return 'Você foi desconectado da chamada (a conexão caiu). Entre no canal de novo.';
}

async function entrarCanalVoz(canal) {
    const usuario = obterNomeUsuario();
    if (!usuario) return mostrarNotificacao('Aguarde o perfil carregar ou defina seu nome primeiro.');

    // Já está nesse canal (conectado ou ainda entrando): só volta a mostrar a área de voz.
    if (canalVozAtual && canalVozAtual.id === canal.id && (roomVoz || conectandoVoz)) {
        mostrarAreaVoz(canal);
        renderizarListaCanais();
        atualizarListaMembros();
        atualizarStatusVozPersistente();
        return;
    }

    await sairCanalVoz(); // sai do canal anterior (ou cancela uma entrada que ainda estava em andamento)

    const minhaTentativa = ++tentativaVoz;
    const precisaAprovacao = canal.aprovacao === true && servidorAtual.souDono !== true;
    conectandoVoz = true;
    avisoConexaoVoz = precisaAprovacao ? 'aguardando' : 'conectando';
    canalVozAtual = canal;
    microfoneAtivo = false; // começa desligado; se a opção "Entrar com o microfone ligado" estiver marcada, liga assim que conectar
    mostrarAreaVoz(canal);
    document.getElementById('fileira-icones-voz').classList.add('visivel');
    renderizarListaCanais();
    renderizarVideo();
    atualizarStatusVozPersistente();
    if (precisaAprovacao) mostrarNotificacao('Pedido enviado. Aguarde o dono do servidor aceitar (pra desistir, clique no 📞).', 'info');

    const nomeSala = nomeSalaCanal(canal);
    try {
        const token = await pedirToken(nomeSala);
        const url = await window.electronAPI.obterUrlServidor();
        if (minhaTentativa !== tentativaVoz) return; // desistiu ou trocou de canal enquanto esperava

        avisoConexaoVoz = 'conectando';
        atualizarStatusVozPersistente();
        const sala = new LivekitClient.Room({
            // pixelDensity 'screen': pede a transmissão na resolução real da tela (conta o zoom do Windows),
            // então uma tela que você aumenta chega com mais detalhe, e a pequena não gasta à toa.
            adaptiveStream: { pixelDensity: 'screen' }, dynacast: true,
            audioCaptureDefaults: opcoesCapturaMicrofone(),
            publishDefaults: opcoesPublicacaoAudio(),
            audioOutput: prefsAudio.saidaId ? { deviceId: prefsAudio.saidaId } : undefined
        });
        roomVoz = sala;
        registrarEventosDaVoz(sala);
        registrarArquivosNaSala(sala);
        registrarEspectadoresNaSala(sala);
        registrarDesenhoNaSala(sala);
        registrarCinemaNaSala(sala);

        await sala.connect(url, token);
        if (minhaTentativa !== tentativaVoz) { try { sala.disconnect(); } catch (e) {} return; }
        avisarPlataformaVoz(true);

        conectandoVoz = false;
        avisoConexaoVoz = '';
        entradaNaVozEm = Date.now(); // pra não avisar "entrou" de quem já estava na sala
        tocarSomApp('voceEntrou');
        document.getElementById('status-usuario-rodape').style.display = 'block';
        document.getElementById('select-fontes').disabled = false;
        // A lista de janelas é só pra transmitir: se falhar, a chamada continua normalmente.
        try { await listarJanelasDoSistema(); } catch (e) { console.warn('Não consegui listar as janelas:', e); }
        if (minhaTentativa !== tentativaVoz) return;

        atualizarListaMembros();
        renderizarListaCanais();
        atualizarStatusVozPersistente();
        atualizarBotaoMicrofone();
        // Entrar com o microfone ligado (padrão). Não liga se você estiver ensurdecido (como no Discord).
        if (prefsAudio.micAoEntrar && !surdoAtivo && !microfoneAtivo) {
            await alternarMicrofone(null);
            if (minhaTentativa !== tentativaVoz) return;
        }

        // O dono do servidor é sempre o anfitrião (modera e, se o canal pedir, aprova quem entra).
        souAnfitriaoVoz = servidorAtual.souDono === true;
        if (canal.aprovacao && souAnfitriaoVoz) {
            document.getElementById('painel-pendentes-voz').style.display = 'flex';
            iniciarChecagemPendentes(nomeSala);
        }

        mostrarNotificacao(`Você entrou no canal de voz "${canal.nome}".`, 'info');
        broadcastarStatusPresenca();
        atualizarPresencaDiscord();
    } catch (err) {
        if (minhaTentativa !== tentativaVoz) return; // erro de uma tentativa que já foi abandonada
        console.error(err);
        mostrarNotificacao('Erro ao entrar no canal de voz: ' + err.message);
        await sairCanalVoz();
    }
}

// Todos os eventos da chamada. Cada um confere se ainda é a chamada atual (uma sala antiga
// que está terminando de desconectar não pode mexer na tela).
function registrarEventosDaVoz(sala) {
    const E = LivekitClient.RoomEvent;
    const atual = () => sala === roomVoz;

    sala.on(E.TrackSubscribed, (track, publication, participante) => {
        if (!atual()) return;
        if (track.kind === 'video' && (track.source === LivekitClient.Track.Source.ScreenShare || track.source === LivekitClient.Track.Source.Camera)) {
            const el = track.attach();
            adicionarTile(track.sid, el, participante.name || participante.identity, false, { identidade: participante.identity, origem: track.source === LivekitClient.Track.Source.ScreenShare ? 'tela' : 'camera' });
            avisarQueEstouVendo('entrou', participante.identity, track.source === LivekitClient.Track.Source.ScreenShare ? 'tela' : 'camera');
        } else if (track.kind === 'audio') {
            const el = track.attach();
            const tipo = track.source === LivekitClient.Track.Source.Microphone ? 'microfone' : 'compartilhamento';
            garantirEntradaAudio(participante.identity);
            elementosAudioPorIdentidade.get(participante.identity)[tipo].add(el);
            aplicarAudioDePessoa(participante.identity);
        }
        atualizarListaMembros();
    });

    sala.on(E.TrackMuted, (publicacao, participante) => {
        if (!atual()) return;
        if (participante === sala.localParticipant && publicacao.source === LivekitClient.Track.Source.Microphone && microfoneAtivo && reaplicandoAudio === 0) {
            // Não foi você que desligou: o dono do servidor mutou o seu microfone.
            microfoneAtivo = false;
            atualizarBotaoMicrofone();
            mostrarNotificacao('O dono do servidor mutou o seu microfone.', 'info');
        }
        atualizarListaMembros();
    });
    sala.on(E.TrackUnmuted, (pub, participante) => {
        if (!atual()) return;
        if (participante && participante !== sala.localParticipant) retomarAudioDe(participante.identity);
        atualizarListaMembros();
    });
    // O Chromium às vezes deixa o áudio "esperando um clique" (ou pausa o elemento): destrava sozinho.
    sala.on(E.AudioPlaybackStatusChanged, () => { if (atual() && !sala.canPlaybackAudio) sala.startAudio().catch(() => {}); });
    sala.on(E.TrackPublished, (pub, participante) => {
        if (!atual()) return;
        const src = LivekitClient.Track && LivekitClient.Track.Source;
        if (pub && src && pub.source === src.ScreenShare && participante && participante !== sala.localParticipant && Date.now() - entradaNaVozEm >= 3000) tocarSomApp('transmissao');
        atualizarListaMembros();
    });
    sala.on(E.TrackUnpublished, () => { if (atual()) atualizarListaMembros(); });

    // Sem conferir "atual()": a limpeza dos elementos de áudio/vídeo tem que acontecer sempre.
    sala.on(E.TrackUnsubscribed, (track, publication, participante) => {
        const removidos = track.detach();
        if (track.kind === 'video') {
            removerTile(track.sid);
            if (track.source === LivekitClient.Track.Source.ScreenShare || track.source === LivekitClient.Track.Source.Camera) {
                avisarQueEstouVendo('saiu', participante.identity, track.source === LivekitClient.Track.Source.ScreenShare ? 'tela' : 'camera');
            }
        }
        if (track.kind === 'audio') {
            const tipo = track.source === LivekitClient.Track.Source.Microphone ? 'microfone' : 'compartilhamento';
            const entrada = elementosAudioPorIdentidade.get(participante.identity);
            if (entrada) removidos.forEach(el => entrada[tipo].delete(el));
        }
        atualizarListaMembros();
    });

    sala.on(E.ParticipantConnected, (p) => { if (atual()) { if (Date.now() - entradaNaVozEm >= 3000) tocarSomApp('entrou'); avisarFlutuante(`${(p && (p.name || p.identity)) || 'Alguém'} entrou`); aoEntrarParticipanteCinema(p); atualizarListaMembros(); atualizarSubMembrosVoz(); } });
    sala.on(E.ParticipantDisconnected, (p) => { if (atual()) { if (Date.now() - entradaNaVozEm >= 3000) tocarSomApp('saiu'); avisarFlutuante(`${(p && (p.name || p.identity)) || 'Alguém'} saiu`); aoSairParticipanteArquivos(p && p.identity); aoSairParticipanteCinema(p && p.identity); tirarEspectador(p && p.identity); if (p && p.identity) desenhos.removerAutor(p.identity); atualizarListaMembros(); atualizarSubMembrosVoz(); } });
    sala.on(E.ActiveSpeakersChanged, (falantes) => {
        if (!atual()) return;
        identidadesFalando = new Set(falantes.map(p => p.identity));
        atualizarDestaqueDeFala();
    });
    sala.on(E.ConnectionQualityChanged, (qualidade, participante) => {
        if (!atual()) return;
        qualidadePorIdentidade.set(participante.identity, mapearQualidade(qualidade));
        // Só troca a cor da bolinha dessa pessoa (sem remontar a lista).
        const ponto = [...document.querySelectorAll('#lista-membros .item-membro[data-identidade]')].find((el) => el.dataset.identidade === participante.identity);
        if (ponto && ponto.querySelector('.ponto-qualidade')) ponto.querySelector('.ponto-qualidade').className = 'ponto-qualidade ' + (qualidadePorIdentidade.get(participante.identity) || 'desconhecida');
        else atualizarListaMembros();
    });

    // A janela transmitida foi fechada (ou o Windows encerrou a captura): o LiveKit para a
    // transmissão sozinho, então a tela do app precisa acompanhar.
    sala.on(E.LocalTrackUnpublished, (publicacao) => {
        if (!atual() || parandoTransmissao || !transmitindoAgora) return;
        if (publicacao.source !== LivekitClient.Track.Source.ScreenShare) return;
        limparEstadoTransmissao();
        marcarTransmissao(false);
        mostrarNotificacao('A transmissão parou (a janela transmitida foi fechada?).', 'info');
    });

    sala.on(E.Reconnecting, () => {
        if (!atual()) return;
        avisoConexaoVoz = 'reconectando';
        atualizarStatusVozPersistente();
        mostrarNotificacao('Conexão instável: reconectando à chamada...');
    });
    sala.on(E.Reconnected, () => {
        if (!atual()) return;
        avisoConexaoVoz = '';
        atualizarStatusVozPersistente();
        mostrarNotificacao('Reconectado à chamada.', 'info');
    });
    // A chamada acabou sem você pedir: a internet caiu de vez, você foi expulso, o canal foi apagado...
    sala.on(E.Disconnected, (motivo) => {
        if (!atual()) return; // foi você que saiu: sairCanalVoz já arrumou a tela
        const olhando = document.getElementById('area-voz').style.display === 'flex';
        mostrarNotificacao(textoDesconexao(motivo));
        sairCanalVoz().then(() => { if (olhando) mostrarAreaVazia(); });
    });
}

// No app de celular, entrar/sair da chamada liga/desliga o aviso "Na chamada" do Android (sem ele o
// sistema corta o microfone quando a tela apaga). No PC essa função não existe e nada acontece.
// ---------- Notificações do celular ----------
// Tocou numa notificação: abre a DM ou o canal. Espera os servidores carregarem (o app pode estar abrindo).
async function abrirConversaDeAviso(d) {
    if (!d || typeof d !== 'object') return;
    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    if (d.tipo === 'dm' && d.amigo) {
        for (let i = 0; i < 30 && !obterIdentidadeUsuario(); i++) await pausa(300);
        abrirAmigos('amigos', d.amigo);
        document.dispatchEvent(new CustomEvent('estrivisor-abriu-conversa'));
        return;
    }
    if (d.tipo !== 'canal' || !d.servidor || !d.canal) return;
    for (let i = 0; i < 30 && !meusServidores.some((x) => x.id === d.servidor); i++) await pausa(300);
    if (!meusServidores.some((x) => x.id === d.servidor)) return;
    if (amigosAbertos()) fecharAmigos();
    if (configAberta()) fecharConfig();
    if (servidorAtual.id !== d.servidor) await selecionarServidor(d.servidor);
    for (let i = 0; i < 20; i++) {
        const canal = (servidorAtual.canais || []).find((c) => c.id === d.canal && c.tipo === 'texto');
        if (canal) {
            if (!canalTextoAtual || canalTextoAtual.id !== canal.id) entrarCanalTexto(canal);
            document.dispatchEvent(new CustomEvent('estrivisor-abriu-conversa'));
            return;
        }
        await pausa(300);
    }
}
window.abrirConversaDeAviso = abrirConversaDeAviso;
// App aberto tocando numa notificação: a ponte do celular guardou qual conversa abrir.
if (window.electronAPI && window.electronAPI.notificacoesCelular) {
    let vezes = 0;
    const olhar = setInterval(() => {
        const p = window.electronAPI.notificacoesCelular.pegarPendente();
        if (p) abrirConversaDeAviso(p);
        if (++vezes > 20) clearInterval(olhar);
    }, 1000);
}

// Configurações > Sons do app > Notificações no celular (só aparece no app de celular).
(function montarOpcoesDeNotificacao() {
    const api = window.electronAPI && window.electronAPI.notificacoesCelular;
    const painel = document.getElementById('cfg-painel-som');
    if (!api || !painel) return;
    const grupo = document.createElement('div');
    grupo.className = 'cfg-grupo'; grupo.id = 'cfg-grupo-notificacoes';
    const titulo = document.createElement('div'); titulo.className = 'cfg-grupo-titulo'; titulo.textContent = 'Notificações no celular';
    const estado = document.createElement('div'); estado.className = 'cfg-dica'; estado.id = 'cfg-notif-estado';
    const permitir = document.createElement('button'); permitir.type = 'button'; permitir.textContent = '🔔 Permitir notificações'; permitir.style.display = 'none';
    grupo.append(titulo, estado, permitir);
    const opcoes = [
        ['dm', 'Mensagens diretas', 'Quando um amigo te mandar mensagem.'],
        ['mencoes', 'Quando me marcarem com @', 'Ex.: "@Mateus bora jogar?" num canal de texto.'],
        ['canais', 'Todas as mensagens dos canais de texto', 'Pode avisar bastante em servidor movimentado.']
    ];
    const caixas = {};
    for (const [chave, rotulo, dica] of opcoes) {
        const label = document.createElement('label'); label.className = 'cfg-check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'cfg-notif-' + chave;
        const textos = document.createElement('span');
        const b = document.createElement('b'); b.textContent = rotulo;
        const d = document.createElement('span'); d.textContent = dica;
        textos.append(b, d);
        label.append(cb, textos);
        cb.addEventListener('change', async () => {
            const r = await api.definir({ [chave]: cb.checked });
            if (r && r.erro) mostrarNotificacao(r.erro);
            atualizar();
        });
        caixas[chave] = cb;
        grupo.appendChild(label);
    }
    painel.appendChild(grupo);
    async function atualizar() {
        const e = await api.ler();
        for (const k of Object.keys(caixas)) caixas[k].checked = Boolean(e[k]);
        permitir.style.display = e.disponivel && e.permissao !== 'granted' ? '' : 'none';
        Object.values(caixas).forEach((c) => { c.disabled = !e.disponivel; });
        estado.textContent = !e.disponivel ? 'Esta versão do app foi montada sem notificações.'
            : e.permissao === 'denied' ? 'O Android está bloqueando as notificações do Estrivisor. Libere em Configurações do celular > Apps > Estrivisor > Notificações.'
            : e.permissao !== 'granted' ? 'Toque em "Permitir notificações" para receber avisos com o app fechado.'
            : e.erro ? e.erro
            : e.registrado ? 'Ligadas: você recebe avisos mesmo com o app fechado.' : 'Ligando...';
    }
    permitir.addEventListener('click', async () => { await api.pedirPermissao(); setTimeout(atualizar, 1500); });
    document.querySelector('.cfg-item[data-cfg="som"]').addEventListener('click', atualizar);
    atualizar();
})();

function avisarPlataformaVoz(conectado) {
    try { const f = window.electronAPI && window.electronAPI.vozMudou; if (typeof f === 'function') f(conectado); } catch (e) {}
}

async function sairCanalVoz() {
    if (!roomVoz && !canalVozAtual) return;
    tentativaVoz++; // cancela uma entrada que ainda esteja em andamento (token, aprovação, conexão)
    if (vozConectada()) tocarSomApp('voceSaiu');
    const sala = roomVoz;
    document.body.classList.remove('modo-cinema');
    if (sala && sala.state === estadoConectado()) {
        try { await pararTransmissao(); } catch (e) { limparEstadoTransmissao(); }
    } else {
        limparEstadoTransmissao();
    }
    pararChecagemPendentes();
    roomVoz = null; // antes do disconnect: assim o aviso de "você foi desconectado" não aparece numa saída normal
    if (sala) { try { sala.disconnect(); } catch (e) {} }
    avisarPlataformaVoz(false);
    conectandoVoz = false;
    avisoConexaoVoz = '';
    canalVozAtual = null;
    souAnfitriaoVoz = false;
    microfoneAtivo = false;
    identidadesFalando = new Set();
    elementosAudioPorIdentidade.forEach((entrada) => { entrada.microfone.clear(); entrada.compartilhamento.clear(); });
    atualizarBotaoMicrofone(); // fora da chamada: o botão volta a ficar apagado
    // Ao sair da voz a transmissão também acabou — volta os botões ao normal.
    marcarTransmissao(false);
    tiles.clear();
    limparArquivosDaChamada();
    espectadores.limpar(); atualizarChipEspectadores();
    desenhos.limparTudo();
    encerrarCinemaLocal();
    document.getElementById('fileira-icones-voz').classList.remove('visivel');
    document.getElementById('status-usuario-rodape').style.display = 'none';
    document.getElementById('painel-soundboard').style.display = 'none';
    cameraAtiva = false;
    idTileCamera = null;
    document.getElementById('btn-camera-rodape').classList.remove('ativo');
    document.getElementById('painel-pendentes-voz').style.display = 'none';
    document.getElementById('select-fontes').disabled = true;
    document.getElementById('btn-transmitir-voz').disabled = true;
    renderizarListaCanais();
    renderizarVideo();
    atualizarListaMembros();
    atualizarStatusVozPersistente();
    broadcastarStatusPresenca();
    atualizarPresencaDiscord();
}

document.getElementById('btn-sair-voz').addEventListener('click', async () => {
    // Só volta pra tela vazia se você estava olhando o canal de voz. Se estava lendo um
    // canal de texto, o chat continua na tela. (Também serve pra desistir de uma entrada
    // que está esperando a aprovação do dono.)
    const olhandoAVoz = document.getElementById('area-voz').style.display === 'flex';
    await sairCanalVoz();
    if (olhandoAVoz) mostrarAreaVazia();
});

// ---------- Discord Rich Presence ----------
// Mostra no perfil do Discord da pessoa: "Compartilhando tela" (se estiver
// transmitindo), "Em canal de voz" (se só estiver na chamada), ou nada.
// Título de janela vindo do sistema: tira quebras de linha e limita o tamanho.
function limparTituloJanela(titulo) {
    const limpo = String(titulo || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return limpo.length > 60 ? limpo.slice(0, 59).trimEnd() + '…' : limpo;
}

// O que aparece no Discord enquanto a pessoa transmite:
//   janela  -> "Transmitindo: <título da janela>" (ex.: o nome do jogo)
//   tela    -> "Transmitindo a tela inteira"
//   opção desligada -> "Transmitindo tela" (sem revelar nada)
function descreverTransmissao() {
    const mostrar = document.getElementById('check-mostrar-janela').checked;
    if (!mostrar || !fonteTransmitida) return 'Transmitindo tela';
    if (/^screen:/.test(fonteTransmitida.id)) return 'Transmitindo a tela inteira';
    const titulo = limparTituloJanela(fonteTransmitida.nome);
    return titulo ? `Transmitindo: ${titulo}` : 'Transmitindo uma janela';
}

// A caixinha lembra a escolha da pessoa (ligada por padrão).
// Liga/desliga a aparição do Estrivisor no perfil do Discord (ligada por padrão).
function presencaDiscordLigada() { return document.getElementById('check-presenca-discord').checked; }
function sincronizarOpcoesDiscord() {
    const ligada = presencaDiscordLigada();
    document.getElementById('check-mostrar-janela').disabled = !ligada;
    document.getElementById('rotulo-mostrar-janela').style.opacity = ligada ? '' : '0.5';
}
try { document.getElementById('check-presenca-discord').checked = localStorage.getItem('estrivisor_presenca_discord') !== '0'; } catch (e) { /* sem armazenamento: fica ligada */ }
document.getElementById('check-presenca-discord').addEventListener('change', () => {
    try { localStorage.setItem('estrivisor_presenca_discord', presencaDiscordLigada() ? '1' : '0'); } catch (e) { /* ignora */ }
    sincronizarOpcoesDiscord();
    atualizarPresencaDiscord();
});
sincronizarOpcoesDiscord();
document.getElementById('check-mostrar-janela').checked = localStorage.getItem('estrivisor_mostrar_janela_discord') !== '0';
document.getElementById('check-mostrar-janela').addEventListener('change', () => {
    localStorage.setItem('estrivisor_mostrar_janela_discord', document.getElementById('check-mostrar-janela').checked ? '1' : '0');
    atualizarPresencaDiscord();
});

let modoPresencaDiscord = null; // 'online' | 'voz' | 'tela' | null
let inicioPresencaDiscord = 0;

function atualizarPresencaDiscord() {
    // Três estados, do mais simples ao mais específico:
    //   online → app aberto e com nome definido
    //   voz    → dentro de um canal de voz
    //   tela   → transmitindo tela
    let modo = null;
    if (!presencaDiscordLigada()) {
        // Desativado pela pessoa: limpa o que estiver aparecendo e não envia mais nada.
        modoPresencaDiscord = null;
        window.electronAPI.definirAtividadeDiscord(null).catch(() => {});
        return;
    }
    if (nomeUsuarioAtual) modo = 'online';
    if (vozConectada() && canalVozAtual) modo = transmitindoAgora ? 'tela' : 'voz';

    // O cronômetro só reinicia quando o tipo de atividade muda.
    if (modo !== modoPresencaDiscord) {
        modoPresencaDiscord = modo;
        inicioPresencaDiscord = Date.now();
    }

    if (!modo) {
        window.electronAPI.definirAtividadeDiscord(null).catch(() => {});
        return;
    }

    const textos = {
        online: { details: 'Online no Estrivisor', state: servidorAtual.nome },
        voz:    { details: 'Em canal de voz',   state: canalVozAtual ? `${canalVozAtual.nome} · ${servidorAtual.nome}` : '' },
        tela:   { details: descreverTransmissao(), state: canalVozAtual ? `${canalVozAtual.nome} · ${servidorAtual.nome}` : '' }
    };

    window.electronAPI.definirAtividadeDiscord({
        details: textos[modo].details,
        state: textos[modo].state,
        inicio: inicioPresencaDiscord
    }).catch(() => {});
}

// ---------- Fontes de tela ----------
// Nome (título) de cada fonte da lista, pra mostrar no Discord qual janela
// está sendo transmitida. Ids de tela começam com "screen:", os de janela com "window:".
const nomesDasFontes = new Map();
let fonteTransmitida = null; // { id, nome } da fonte que está no ar agora

async function listarJanelasDoSistema() {
    const select = document.getElementById('select-fontes');
    const anterior = select.value; // pra manter a escolha ao atualizar a lista
    const fontes = await window.electronAPI.listarFontes();

    select.innerHTML = '';
    nomesDasFontes.clear();
    // Primeira opção vazia: o app nunca escolhe sozinho o que transmitir.
    const vazia = document.createElement('option');
    vazia.value = '';
    vazia.text = 'Escolha o que transmitir...';
    select.appendChild(vazia);
    (Array.isArray(fontes) ? fontes : []).forEach(fonte => {
        nomesDasFontes.set(fonte.id, fonte.name);
        const option = document.createElement('option');
        option.value = fonte.id;
        option.text = fonte.name;
        select.appendChild(option);
    });
    select.value = anterior && nomesDasFontes.has(anterior) ? anterior : '';
    document.getElementById('btn-transmitir-voz').disabled = false;
}

// A lista só era carregada ao entrar na voz: um jogo aberto depois não aparecia.
document.getElementById('btn-atualizar-fontes').addEventListener('click', async () => {
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    try {
        await listarJanelasDoSistema();
        mostrarNotificacao('Lista de janelas atualizada.', 'info');
    } catch (err) {
        mostrarNotificacao('Erro ao atualizar a lista: ' + err.message);
    }
});

document.getElementById('select-fontes').addEventListener('change', async () => {
    if (!transmitindoAgora) return;
    try { await pararTransmissao(); await iniciarTransmissao(); atualizarPresencaDiscord(); }
    catch (err) { marcarTransmissao(false); mostrarNotificacao('Erro ao trocar de fonte: ' + err.message); }
});

function atualizarPainelPersonalizado() {
    const personalizado = document.getElementById('select-qualidade').value === 'personalizado';
    document.getElementById('painel-personalizado-voz').style.display = personalizado ? 'flex' : 'none';
}
document.getElementById('select-qualidade').addEventListener('change', () => {
    const sel = document.getElementById('select-qualidade');
    if (opcaoTrancada(sel.value)) {
        // Qualidade com cadeado: volta pra anterior e pede a chave.
        const pretendida = sel.value;
        sel.value = qualidadeValida;
        atualizarPainelPersonalizado();
        abrirModalChave(pretendida);
        return;
    }
    qualidadeValida = sel.value;
    atualizarPainelPersonalizado();
    salvarPreferenciasVideo();
});
document.getElementById('custom-simulcast').addEventListener('change', salvarPreferenciasVideo);
document.getElementById('check-som-sistema').addEventListener('change', salvarPreferenciasVideo);

// ---------- Níveis de qualidade: cadeados e chaves ----------
// Padrão: 720p30 pra todo mundo (economiza banda e processamento). Qualidades maiores têm cadeado 🔒
// e são liberadas por uma chave gerada pelo administrador (cada chave vale pra uma conta).
const RANK_OPCAO = { automatico: 1, alta: 2, balanceado: 0, economia: 0, personalizado: 0 };
const TEXTO_OPCAO = {
    automatico: 'Automático — 1080p30', alta: 'Alta — 1080p60', balanceado: 'Balanceado — 720p30',
    economia: 'Economia — 480p15', personalizado: 'Personalizado...'
};
const TEXTO_PRESET = { '854x480': '480p', '1280x720': '720p', '1920x1080': '1080p', '2560x1440': '1440p', '3840x2160': '4K' };
let qualidadeValida = 'balanceado'; // última escolha permitida (pra onde volta quando clicam numa trancada)

const opcaoTrancada = (valor) => qualidadeConta !== null && (RANK_OPCAO[valor] || 0) > qualidadeConta.rank;
const textoDoLimite = (l) => `${l.largura}×${l.altura} · ${l.fps} fps · ${String(l.bitrate).replace('.', ',')} Mbps`;

function aplicarNivelQualidade() {
    const sel = document.getElementById('select-qualidade');
    for (const op of sel.options) {
        const base = TEXTO_OPCAO[op.value];
        if (base) op.textContent = (opcaoTrancada(op.value) ? '🔒 ' : '') + base;
    }
    const info = document.getElementById('info-nivel-qualidade');
    const dicaCustom = document.getElementById('dica-personalizado-texto');
    if (qualidadeConta) {
        const l = qualidadeConta.limites;
        let complemento = '';
        if (qualidadeConta.admin) complemento = ' (administrador)';
        else if (qualidadeConta.ate) complemento = ` · vale até ${new Date(qualidadeConta.ate).toLocaleDateString('pt-BR')}`;
        info.textContent = `Sua qualidade: ${qualidadeConta.nome}${complemento}. ` +
            (qualidadeConta.rank < 3 ? 'Para mais, ative uma chave.' : '');
        dicaCustom.textContent = `Seu limite atual: ${textoDoLimite(l)}.` +
            (qualidadeConta.rank < 3 ? ' Com uma chave você libera valores maiores.' : '') + ' Valores acima disso são ajustados sozinhos.';
        // Resoluções prontas acima do limite ficam com cadeado.
        for (const op of document.getElementById('custom-preset').options) {
            if (!op.value) continue;
            const [w, h] = op.value.split('x').map(Number);
            const trancada = w > l.largura || h > l.altura;
            op.disabled = trancada;
            op.textContent = (TEXTO_PRESET[op.value] || op.value) + (trancada ? ' 🔒' : '');
        }
        const lim = limitesEfetivos();
        document.getElementById('custom-largura').max = lim.largura.max;
        document.getElementById('custom-altura').max = lim.altura.max;
        document.getElementById('custom-fps').max = lim.fps.max;
        document.getElementById('custom-bitrate').max = lim.bitrate.max;
        // Se a escolha salva está trancada (ex.: era 1080p antes da chave existir), volta pro 720p30.
        if (opcaoTrancada(sel.value)) {
            sel.value = 'balanceado';
            mostrarNotificacao('A qualidade padrão agora é 720p30. Para qualidades maiores, ative uma chave nas configurações de vídeo.', 'info');
        }
        qualidadeValida = sel.value;
        atualizarPainelPersonalizado();
        normalizarCamposPersonalizados(); // ajusta os campos aos limites e salva
    } else {
        info.textContent = '';
    }
}

async function atualizarQualidade() {
    try {
        const d = await api('GET', '/qualidade');
        if (d && d.qualidade) qualidadeConta = d.qualidade;
    } catch (err) { /* servidor fora do ar: mantém o que já sabia */ }
    aplicarNivelQualidade();
}

let qualidadePretendida = null; // a opção que a pessoa clicou e estava trancada
function abrirModalChave(pretendida) {
    qualidadePretendida = pretendida || null;
    document.getElementById('chave-texto').value = '';
    document.getElementById('chave-erro').textContent = '';
    document.getElementById('modal-chave').style.display = 'flex';
    document.getElementById('chave-texto').focus();
}
function fecharModalChave() { document.getElementById('modal-chave').style.display = 'none'; }
async function ativarChave() {
    const entrada = document.getElementById('chave-texto');
    const erro = document.getElementById('chave-erro');
    const botao = document.getElementById('chave-ativar');
    if (!entrada.value.trim()) { erro.textContent = 'Digite a chave.'; return; }
    botao.disabled = true;
    erro.textContent = '';
    try {
        const d = await api('POST', '/qualidade/resgatar', { chave: entrada.value });
        qualidadeConta = d.qualidade;
        fecharModalChave();
        aplicarNivelQualidade();
        const sel = document.getElementById('select-qualidade');
        if (qualidadePretendida && !opcaoTrancada(qualidadePretendida)) {
            sel.value = qualidadePretendida;
            qualidadeValida = sel.value;
            atualizarPainelPersonalizado();
            salvarPreferenciasVideo();
        }
        mostrarNotificacao(`Chave ativada! Sua qualidade agora é ${qualidadeConta.nome}.`, 'info');
    } catch (err) {
        erro.textContent = err.message;
    }
    botao.disabled = false;
}
document.getElementById('btn-ativar-chave').addEventListener('click', () => abrirModalChave(null));
document.getElementById('chave-cancelar').addEventListener('click', fecharModalChave);
document.getElementById('chave-ativar').addEventListener('click', ativarChave);
document.getElementById('chave-texto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ativarChave();
    else if (e.key === 'Escape') fecharModalChave();
});

// ---------- Transmitir tela ----------
let transmitindoAgora = false;

// ---------- Codec de vídeo ----------
// H264: o Windows pode codificar na PLACA DE VÍDEO, deixando o processador livre pro jogo.
// VP8: codifica no processador. É a opção de volta caso o H264 dê problema.
// (Com "simulcast" ligado o H264 cai pro processador, porque a placa não faz várias
// camadas ao mesmo tempo — por isso os perfis prontos vêm com simulcast desligado.)
function codecEscolhido() {
    return document.getElementById('select-codec').value === 'vp8' ? 'vp8' : 'h264';
}
document.getElementById('select-codec').value = localStorage.getItem('estrivisor_codec') === 'vp8' ? 'vp8' : 'h264';
document.getElementById('select-codec').addEventListener('change', () => {
    localStorage.setItem('estrivisor_codec', codecEscolhido());
});

// ---------- Qualidade personalizada: limites e atalhos ----------
const LIMITES_PERSONALIZADO = {
    largura: { min: 160, max: 3840, padrao: 1920 },
    altura:  { min: 90,  max: 2160, padrao: 1080 },
    fps:     { min: 1,   max: 60,   padrao: 30 },
    bitrate: { min: 0.1, max: 50,   padrao: 3 }   // em Mbps
};
const PRESETS_RESOLUCAO = ['854x480', '1280x720', '1920x1080', '2560x1440', '3840x2160'];

// O que a conta pode enviar (vem do servidor: 720p30 por padrão; chaves liberam mais).
// null = ainda não sei (antes de entrar); aí nada é travado na tela, e a trava de verdade acontece ao transmitir.
let qualidadeConta = null; // { nivel, rank, nome, limites: { largura, altura, fps, bitrate }, ate, admin }
const QUALIDADE_PADRAO = { nivel: 'livre', rank: 0, nome: '720p30 (padrão)', limites: { largura: 1280, altura: 720, fps: 30, bitrate: 4 }, ate: null, admin: false };
function limitesEfetivos() {
    const l = qualidadeConta && qualidadeConta.limites;
    const topo = (base, max) => (max ? { min: base.min, max: Math.min(base.max, max), padrao: Math.min(base.padrao, max) } : base);
    return {
        largura: topo(LIMITES_PERSONALIZADO.largura, l && l.largura),
        altura: topo(LIMITES_PERSONALIZADO.altura, l && l.altura),
        fps: topo(LIMITES_PERSONALIZADO.fps, l && l.fps),
        bitrate: topo(LIMITES_PERSONALIZADO.bitrate, l && l.bitrate)
    };
}

// Campo vazio ou inválido volta ao padrão; fora do intervalo é encaixado nele.
function limitar(valor, { min, max, padrao }) {
    if (valor === '' || valor === null || valor === undefined) return padrao;
    const n = Number(valor);
    if (!Number.isFinite(n)) return padrao;
    return Math.min(max, Math.max(min, n));
}
// Codificadores de vídeo preferem larguras e alturas pares.
function paraPar(n) { return Math.round(n / 2) * 2; }

function lerCamposPersonalizados() {
    const v = (id) => document.getElementById(id).value;
    const lim = limitesEfetivos();
    return {
        largura: paraPar(limitar(v('custom-largura'), lim.largura)),
        altura: paraPar(limitar(v('custom-altura'), lim.altura)),
        fps: Math.round(limitar(v('custom-fps'), lim.fps)),
        bitrate: Math.round(limitar(v('custom-bitrate'), lim.bitrate) * 10) / 10
    };
}

// Deixa o menu de "Prontas" igual ao que está nas caixas (ou em branco se for outra).
function sincronizarPresetResolucao() {
    const c = lerCamposPersonalizados();
    const chave = `${c.largura}x${c.altura}`;
    document.getElementById('custom-preset').value = PRESETS_RESOLUCAO.includes(chave) ? chave : '';
}

// Reescreve os campos já corrigidos, pra pessoa ver o valor que vai valer.
function normalizarCamposPersonalizados() {
    const c = lerCamposPersonalizados();
    document.getElementById('custom-largura').value = c.largura;
    document.getElementById('custom-altura').value = c.altura;
    document.getElementById('custom-fps').value = c.fps;
    document.getElementById('custom-bitrate').value = c.bitrate;
    sincronizarPresetResolucao();
    salvarPreferenciasVideo();
}

['custom-largura', 'custom-altura', 'custom-fps', 'custom-bitrate'].forEach((id) => {
    document.getElementById(id).addEventListener('change', normalizarCamposPersonalizados);
});
['custom-largura', 'custom-altura'].forEach((id) => {
    document.getElementById(id).addEventListener('input', sincronizarPresetResolucao);
});
document.getElementById('custom-preset').addEventListener('change', () => {
    const valor = document.getElementById('custom-preset').value;
    if (!valor) return;
    const [largura, altura] = valor.split('x');
    document.getElementById('custom-largura').value = largura;
    document.getElementById('custom-altura').value = altura;
    normalizarCamposPersonalizados();
});
sincronizarPresetResolucao();

// O perfil que vai de fato pro envio. Passa SEMPRE pelos limites da conta (mesmo que alguém
// tenha mexido nas configurações salvas): sem chave, no máximo 720p30.
function lerPerfilQualidade() {
    const conta = qualidadeConta || QUALIDADE_PADRAO;
    let escolha = document.getElementById('select-qualidade').value;
    if ((RANK_OPCAO[escolha] || 0) > conta.rank) escolha = 'balanceado';
    let base;
    if (escolha === 'personalizado') {
        const c = lerCamposPersonalizados();
        base = { resolution: { width: c.largura, height: c.altura }, maxFramerate: c.fps, maxBitrate: Math.round(c.bitrate * 1_000_000) };
    } else {
        base = PERFIS_QUALIDADE[escolha] || PERFIS_QUALIDADE.balanceado;
    }
    const l = conta.limites;
    return {
        resolution: { width: Math.min(base.resolution.width, l.largura), height: Math.min(base.resolution.height, l.altura) },
        maxFramerate: Math.min(base.maxFramerate, l.fps),
        maxBitrate: Math.min(base.maxBitrate, Math.round(l.bitrate * 1_000_000)),
        simulcast: document.getElementById('custom-simulcast').checked
    };
}

async function iniciarTransmissao() {
    if (!vozConectada()) throw new Error('Entre num canal de voz primeiro.');
    const select = document.getElementById('select-fontes');
    const fonteId = select.value;
    if (!fonteId) throw new Error('Escolha na lista a tela ou a janela que você quer transmitir.');
    // A janela pode ter sido fechada desde que a lista foi montada: confere de novo antes de começar
    // (antes, nesse caso, o app transmitia a tela inteira sem avisar).
    await listarJanelasDoSistema();
    if (select.value !== fonteId) throw new Error('Essa janela não está mais aberta. Escolha de novo na lista.');
    const comSom = document.getElementById('check-som-sistema').checked;
    await window.electronAPI.definirFonte(fonteId, comSom);
    await atualizarQualidade(); // confere no servidor o que esta conta pode enviar
    const perfil = lerPerfilQualidade();

    // O LiveKit separa DUAS etapas, e cada configuração só vale na sua:
    //  1) CAPTURA (2º parâmetro): o que se pede pro Windows capturar — resolução e FPS.
    //  2) PUBLICAÇÃO (3º parâmetro): o que de fato é enviado pela rede — bitrate e FPS máximo.
    // Antes, "screenShareEncoding" estava na captura, onde é IGNORADO: o LiveKit usava o
    // padrão dele (1080p a 15 FPS) e nenhuma opção de qualidade fazia efeito.
    const publicacao = await roomVoz.localParticipant.setScreenShareEnabled(
        true,
        {
            audio: comSom,
            resolution: {
                width: perfil.resolution.width,
                height: perfil.resolution.height,
                frameRate: perfil.maxFramerate
            },
            contentHint: 'motion' // prioriza fluidez (jogo) sobre nitidez de imagem parada
        },
        {
            simulcast: perfil.simulcast,
            screenShareEncoding: { maxBitrate: perfil.maxBitrate, maxFramerate: perfil.maxFramerate },
            videoCodec: codecEscolhido(),
            // Todo mundo aqui usa o Estrivisor (Chromium), que decodifica H264 — não precisa
            // publicar uma segunda versão "de reserva" (isso dobraria o trabalho de quem transmite).
            backupCodec: false
        }
    );
    document.getElementById('select-codec').disabled = true; // o codec não muda no meio da transmissão

    fonteTransmitida = { id: fonteId, nome: nomesDasFontes.get(fonteId) || '' };

    if (publicacao && publicacao.videoTrack) {
        idTileLocal = publicacao.trackSid;
        const trackBruta = publicacao.videoTrack.mediaStreamTrack;
        if (trackBruta) trackBruta.contentHint = 'motion';
        const el = publicacao.videoTrack.attach();
        adicionarTile(idTileLocal, el, roomVoz.localParticipant.name || roomVoz.localParticipant.identity, true, { identidade: roomVoz.localParticipant.identity, origem: 'tela' });
        iniciarDiagnostico(publicacao);
    }
    atualizarListaMembros();
}

let parandoTransmissao = false; // true enquanto o próprio app desliga a transmissão

async function pararTransmissao() {
    if (!roomVoz) return;
    parandoTransmissao = true;
    try {
        await roomVoz.localParticipant.setScreenShareEnabled(false);
    } finally {
        parandoTransmissao = false;
        limparEstadoTransmissao();
    }
}

// Tira o quadro da sua transmissão e o diagnóstico (a parte "técnica" de parar).
function limparEstadoTransmissao() {
    document.getElementById('select-codec').disabled = false;
    fonteTransmitida = null;
    pararDiagnostico();
    if (idTileLocal) { removerTile(idTileLocal); idTileLocal = null; }
    atualizarListaMembros();
}

// Botões e status de "transmitindo" — o único lugar que mexe neles.
function marcarTransmissao(ativa) {
    transmitindoAgora = ativa;
    document.getElementById('btn-transmitir-voz').style.display = ativa ? 'none' : 'inline-block';
    document.getElementById('btn-parar-voz').style.display = ativa ? 'inline-block' : 'none';
    document.getElementById('select-qualidade').disabled = ativa;
    document.getElementById('btn-tela-rodape').classList.toggle('ativo', ativa);
    atualizarPresencaDiscord();
}

async function comecarTransmissao() {
    try {
        await iniciarTransmissao();
        marcarTransmissao(true);
        return true;
    } catch (err) {
        console.error(err);
        mostrarNotificacao('Erro ao transmitir: ' + err.message);
        return false;
    }
}

async function encerrarTransmissao() {
    try { await pararTransmissao(); } catch (err) { mostrarNotificacao('Erro ao parar a transmissão: ' + err.message); }
    marcarTransmissao(false);
}

document.getElementById('btn-transmitir-voz').addEventListener('click', comecarTransmissao);
document.getElementById('btn-parar-voz').addEventListener('click', encerrarTransmissao);

// ---------- Diagnóstico (FPS / limitação) ----------
// Com simulcast há vários relatórios de vídeo (um por camada); fica com o da
// maior resolução, que é o que vale pra quem assiste.
function escolherRelatorioDeVideo(relatorios) {
    let melhor = null;
    relatorios.forEach((r) => {
        if (r.type !== 'outbound-rtp' || r.kind !== 'video') return;
        const pontos = (r.frameWidth || 0) * (r.frameHeight || 0);
        const atual = melhor ? (melhor.frameWidth || 0) * (melhor.frameHeight || 0) : -1;
        if (pontos > atual) melhor = r;
    });
    return melhor;
}

// "H264 (GPU)" = codificando na placa de vídeo; "(CPU)" = no processador.
// Sem a informação do navegador, mostra só o que ele disser (ou nada).
function descreverCodificador(r, mimeType) {
    const codec = mimeType ? String(mimeType).replace(/^video\//i, '').toUpperCase() : '';
    let onde = '';
    if (r.powerEfficientEncoder === true) onde = 'GPU';
    else if (r.powerEfficientEncoder === false) onde = 'CPU';
    else if (r.encoderImplementation) onde = String(r.encoderImplementation).slice(0, 24);
    if (codec && onde) return `${codec} (${onde})`;
    return codec || onde;
}

function textoDiagnostico(r, mimeType) {
    const fps = r.framesPerSecond !== undefined ? Math.round(r.framesPerSecond) : '—';
    const tamanho = r.frameWidth && r.frameHeight ? `${r.frameWidth}×${r.frameHeight}` : '—';
    const mapa = { none: 'nenhuma ✅', cpu: 'CPU ⚠️', bandwidth: 'banda ⚠️', other: 'outra' };
    const limitacao = mapa[r.qualityLimitationReason] || r.qualityLimitationReason || '—';
    const codificador = descreverCodificador(r, mimeType);
    return `· ${tamanho} · FPS: ${fps}${codificador ? ' · ' + codificador : ''} · Limitação: ${limitacao}`;
}

function iniciarDiagnostico(publicacao) {
    pararDiagnostico();
    intervaloDiagnostico = setInterval(async () => {
        try {
            const sender = publicacao.track && publicacao.track.sender;
            if (!sender) return;
            const relatorios = await sender.getStats();
            const relatorio = escolherRelatorioDeVideo(relatorios);
            if (!relatorio) return;
            // O nome do codec (ex.: video/H264) vem num relatório separado, ligado pelo id.
            const codecs = new Map();
            relatorios.forEach((r) => { if (r.type === 'codec') codecs.set(r.id, r.mimeType); });
            const el = document.getElementById('diagnostico-' + idTileLocal);
            if (el) el.textContent = textoDiagnostico(relatorio, codecs.get(relatorio.codecId));
        } catch (err) { /* silencioso */ }
    }, 2000);
}
function pararDiagnostico() {
    if (intervaloDiagnostico) { clearInterval(intervaloDiagnostico); intervaloDiagnostico = null; }
}

// ---------- Microfone ----------
// O botão do microfone no rodapé mostra o estado de verdade:
//   fora de um canal de voz -> apagado   |   ligado -> verde   |   desligado -> vermelho com risco
// (Antes ele não voltava ao "desligado" ao sair do canal, então no canal seguinte parecia
//  ligado sem estar — e nunca dava pra ver direito o estado.)
function atualizarBotaoMicrofone() {
    const btn = document.getElementById('btn-microfone-rodape');
    const naVoz = vozConectada();
    btn.disabled = !naVoz;
    btn.classList.toggle('ativo', naVoz && microfoneAtivo);
    btn.classList.toggle('mudo', naVoz && !microfoneAtivo);
    btn.title = !naVoz
        ? 'Entre num canal de voz pra usar o microfone'
        : (microfoneAtivo ? 'Microfone LIGADO — clique pra desligar' : 'Microfone DESLIGADO — clique pra ligar');
}

async function alternarMicrofone(btn) {
    if (!vozConectada()) return;
    try {
        microfoneAtivo = !microfoneAtivo;
        await roomVoz.localParticipant.setMicrophoneEnabled(microfoneAtivo, microfoneAtivo ? opcoesCapturaMicrofone() : undefined, microfoneAtivo ? opcoesPublicacaoAudio() : undefined);
        if (microfoneAtivo) await aplicarFiltroRuidoNaChamada();
        if (btn) {
            btn.textContent = microfoneAtivo ? '🎤 Desativar microfone' : '🎤 Ativar microfone';
            btn.classList.toggle('ativo', microfoneAtivo);
        }
    } catch (err) {
        microfoneAtivo = !microfoneAtivo;
        mostrarNotificacao('Erro ao ativar microfone: ' + err.message);
        atualizarBotaoMicrofone();
        atualizarListaMembros();
        return;
    }
    tocarSomApp(microfoneAtivo ? 'micLigado' : 'micDesligado');
    atualizarBotaoMicrofone();
    atualizarListaMembros();
}
document.getElementById('btn-microfone-rodape').addEventListener('click', () => alternarMicrofone(null));

// ---------- Áudio de cada pessoa: volume, silenciar ----------
// Quem VOCÊ silenciou (só você deixa de ouvir; vale até fechar o app).
const silenciadosPorIdentidade = new Set();

// Único lugar que decide o volume e o "mudo" dos elementos de áudio de uma pessoa:
// mudo = você ensurdeceu tudo OU silenciou essa pessoa.
function aplicarAudioDePessoa(identity) {
    const entrada = elementosAudioPorIdentidade.get(identity);
    if (!entrada) return;
    garantirEntradaAudio(identity);
    const volumes = volumesPorIdentidade.get(identity);
    const mudo = surdoAtivo || silenciadosPorIdentidade.has(identity);
    ['microfone', 'compartilhamento'].forEach((tipo) => {
        entrada[tipo].forEach((el) => { el.volume = ganhoDoVolume(volumes[tipo]); el.muted = mudo; });
    });
}

// Garante que o áudio de uma pessoa está tocando (elemento não pausado, volume/mudo no lugar).
function retomarAudioDe(identity) {
    const entrada = elementosAudioPorIdentidade.get(identity);
    if (!entrada) return;
    aplicarAudioDePessoa(identity);
    ['microfone', 'compartilhamento'].forEach((tipo) => entrada[tipo].forEach((el) => { if (el.paused) el.play().catch(() => {}); }));
}
// "Não estou ouvindo fulano": cancela e refaz a assinatura do áudio de todo mundo, sem sair da chamada.
async function refazerAudioDosOutros() {
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    const sala = roomVoz;
    try { await sala.startAudio(); } catch (e) { /* sem problema */ }
    const pubs = [];
    sala.remoteParticipants.forEach((p) => p.audioTrackPublications.forEach((pub) => pubs.push(pub)));
    for (const pub of pubs) { try { pub.setSubscribed(false); } catch (e) { /* segue */ } }
    await new Promise((ok) => setTimeout(ok, 400));
    for (const pub of pubs) { try { pub.setSubscribed(true); } catch (e) { /* segue */ } }
    sala.remoteParticipants.forEach((p) => retomarAudioDe(p.identity));
    mostrarNotificacao('Áudio dos outros refeito.', 'info');
}

// Recarrega só o áudio de UMA pessoa (o mesmo que sair e entrar, mas sem sair).
async function refazerAudioDe(identity, nome) {
    if (!vozConectada()) return;
    const p = roomVoz.remoteParticipants.get(identity);
    if (!p) return;
    const pubs = [...p.audioTrackPublications.values()];
    for (const pub of pubs) { try { pub.setSubscribed(false); } catch (e) { /* segue */ } }
    await new Promise((ok) => setTimeout(ok, 400));
    for (const pub of pubs) { try { pub.setSubscribed(true); } catch (e) { /* segue */ } }
    setTimeout(() => retomarAudioDe(identity), 600);
    mostrarNotificacao(`Som de ${nome || 'quem você escolheu'} refeito.`, 'info');
}

function alternarSilencioDe(identity) {
    if (silenciadosPorIdentidade.has(identity)) silenciadosPorIdentidade.delete(identity);
    else silenciadosPorIdentidade.add(identity);
    garantirEntradaAudio(identity);
    aplicarAudioDePessoa(identity);
    atualizarListaMembros(); // mostra/esconde o 🔇 ao lado do nome
    return silenciadosPorIdentidade.has(identity);
}

// O número mostrado (0–100%) é a posição do controle; o volume real segue uma curva (ao quadrado),
// que dá passos mais finos nos volumes baixos, onde o ouvido mais percebe a diferença.
// 100% continua sendo o volume original e 0% é mudo.
function ganhoDoVolume(porcento) {
    const p = Math.min(100, Math.max(0, Number(porcento) || 0)) / 100;
    return p * p;
}

// Muda o volume (inteiro de 0 a 100) de "microfone" (voz) ou "compartilhamento" (som da tela) de
// uma pessoa, aplica na hora, guarda e atualiza todos os controles que mostram esse volume.
function definirVolume(identity, tipo, valor) {
    let n = Math.round(Number(valor));
    if (!Number.isFinite(n)) return null;
    n = Math.min(100, Math.max(0, n));
    garantirEntradaAudio(identity);
    volumesPorIdentidade.get(identity)[tipo] = n;
    aplicarAudioDePessoa(identity);
    salvarVolumes();
    sincronizarControlesVolume(identity, tipo, n);
    return n;
}

function sincronizarControlesVolume(identity, tipo, n) {
    document.querySelectorAll('.controle-volume').forEach((c) => {
        if (c.dataset.identidade !== identity || c.dataset.tipo !== tipo) return;
        c.querySelector('input[type=range]').value = String(n);
        const campo = c.querySelector('input[type=number]');
        if (document.activeElement !== campo) campo.value = String(n);
        const mudo = c.querySelector('.btn-mudo-vol');
        if (mudo) mudo.textContent = n === 0 ? '🔇' : '🔊';
    });
}

// Mexe no volume da VOZ da pessoa de 5 em 5.
function ajustarVolumeDaVoz(identity, delta) {
    garantirEntradaAudio(identity);
    return definirVolume(identity, 'microfone', volumesPorIdentidade.get(identity).microfone + delta);
}

// ---------- Ensurdecer (mutar todo áudio recebido, de uma vez) ----------
let surdoAtivo = false;
document.getElementById('btn-surdo-rodape').addEventListener('click', () => {
    surdoAtivo = !surdoAtivo;
    const btn = document.getElementById('btn-surdo-rodape');
    btn.textContent = surdoAtivo ? '🔇' : '🔊';
    btn.classList.toggle('mudo', surdoAtivo);
    btn.title = surdoAtivo ? 'Reativar áudio recebido' : 'Silenciar áudio recebido';
    elementosAudioPorIdentidade.forEach((_, identity) => aplicarAudioDePessoa(identity));
    tocarSomApp(surdoAtivo ? 'surdoLigado' : 'surdoDesligado');
    enviarEstadoFlutuante();
});

// ---------- Câmera ----------
let cameraAtiva = false;
let idTileCamera = null;
document.getElementById('btn-camera-rodape').addEventListener('click', async () => {
    if (!vozConectada()) return;
    const btn = document.getElementById('btn-camera-rodape');
    try {
        cameraAtiva = !cameraAtiva;
        const publicacao = await roomVoz.localParticipant.setCameraEnabled(cameraAtiva, undefined, { videoCodec: codecEscolhido(), backupCodec: false });
        btn.classList.toggle('ativo', cameraAtiva);
        if (cameraAtiva && publicacao && publicacao.videoTrack) {
            idTileCamera = publicacao.trackSid;
            const el = publicacao.videoTrack.attach();
            adicionarTile(idTileCamera, el, roomVoz.localParticipant.name || roomVoz.localParticipant.identity, true, { identidade: roomVoz.localParticipant.identity, origem: 'camera' });
        } else if (!cameraAtiva && idTileCamera) {
            // O evento TrackUnsubscribed só dispara pra faixas dos OUTROS —
            // o tile da própria câmera a gente remove na mão.
            removerTile(idTileCamera);
            idTileCamera = null;
        }
    } catch (err) {
        cameraAtiva = !cameraAtiva;
        mostrarNotificacao('Erro ao ativar câmera: ' + err.message);
    }
});

// ---------- Atalho rápido de tela ----------
document.getElementById('btn-tela-rodape').addEventListener('click', async () => {
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    if (transmitindoAgora) return encerrarTransmissao();
    // Nunca transmite "no escuro": sem uma tela/janela escolhida, leva a pessoa até a lista.
    if (!document.getElementById('select-fontes').value) {
        entrarCanalVoz(canalVozAtual); // mostra a área de voz, onde fica a lista
        document.getElementById('select-fontes').focus();
        return mostrarNotificacao('Escolha na lista a tela ou a janela que você quer transmitir.', 'info');
    }
    await comecarTransmissao();
});

// ---------- Mostrar/esconder coluna de membros ----------
document.getElementById('btn-membros-rodape').addEventListener('click', () => {
    const coluna = document.querySelector('.coluna-membros');
    const escondida = coluna.style.display === 'none';
    coluna.style.display = escondida ? '' : 'none';
    document.getElementById('btn-membros-rodape').classList.toggle('ativo', escondida);
});

// ---------- Soundboard (sons gerados na hora, sem arquivos externos) ----------
document.getElementById('btn-soundboard-rodape').addEventListener('click', () => {
    const painel = document.getElementById('painel-soundboard');
    painel.style.display = painel.style.display === 'flex' ? 'none' : 'flex';
});

// Gera o som sinteticamente (Web Audio) e publica como uma faixa de áudio
// temporária na sala — assim todo mundo no canal escuta, sem precisar de
// nenhum arquivo .mp3 embutido no app.
async function tocarSomNaChamada(tipo) {
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    const sala = roomVoz;

    const ctx = new AudioContext();
    const destino = ctx.createMediaStreamDestination();
    const agora = ctx.currentTime;

    function tom(freq, inicio, duracao, tipoOnda = 'sine', volume = 0.4) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tipoOnda;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, agora + inicio);
        gain.gain.exponentialRampToValueAtTime(0.001, agora + inicio + duracao);
        osc.connect(gain).connect(destino);
        osc.start(agora + inicio);
        osc.stop(agora + inicio + duracao);
    }

    let duracaoTotal = 1;
    if (tipo === 'buzina') {
        tom(220, 0, 0.6, 'sawtooth', 0.5);
        tom(220, 0.6, 0.6, 'sawtooth', 0.5);
        duracaoTotal = 1.3;
    } else if (tipo === 'alarme') {
        for (let i = 0; i < 4; i++) tom(880, i * 0.25, 0.2, 'square', 0.35);
        duracaoTotal = 1.2;
    } else { // aplausos: ruído branco curto em rajadas
        for (let i = 0; i < 12; i++) tom(200 + Math.random() * 2000, i * 0.07, 0.08, 'triangle', 0.15);
        duracaoTotal = 1.0;
    }

    const trackBruta = destino.stream.getAudioTracks()[0];
    try {
        await sala.localParticipant.publishTrack(trackBruta, { name: 'soundboard' });
    } catch (err) {
        ctx.close();
        return mostrarNotificacao('Não consegui tocar o som: ' + err.message);
    }

    setTimeout(async () => {
        try { await sala.localParticipant.unpublishTrack(trackBruta); } catch (e) {}
        ctx.close();
    }, (duracaoTotal + 0.3) * 1000);
}

document.querySelectorAll('#painel-soundboard button[data-som]').forEach(btn => {
    btn.addEventListener('click', () => tocarSomNaChamada(btn.dataset.som));
});

// ---------- Sons do servidor (soundboard compartilhado) ----------
// Cada servidor tem uma lista de sons curtos que qualquer membro toca na chamada (o servidor guarda os arquivos).
let sonsDoServidor = [];            // lista do servidor aberto
let sonsServidorId = null;
const cacheSons = new Map();        // "servidor/id" -> Promise<Uint8Array dos bytes do arquivo>
let tocandoSomServidor = false;

function desenharSonsDoServidor() {
    const caixa = document.getElementById('sons-servidor');
    caixa.innerHTML = '';
    if (sonsServidorId !== servidorAtual.id) return; // lista de outro servidor: espera carregar a certa
    const eu = obterIdentidadeUsuario();
    const souDono = servidorAtual.souDono === true;
    sonsDoServidor.forEach((som) => {
        const linha = document.createElement('div');
        linha.className = 'som-linha';
        const tocar = document.createElement('button');
        tocar.className = 'tocar'; tocar.type = 'button';
        tocar.textContent = '🔊 ' + som.nome;
        tocar.title = `${som.nome} · enviado por ${som.porNome || '?'} · ${som.segundos.toFixed(1).replace('.', ',')} s`;
        tocar.addEventListener('click', () => tocarSomDoServidor(som));
        linha.appendChild(tocar);
        if (som.por === eu || souDono) {
            const ap = document.createElement('button');
            ap.className = 'apagar'; ap.type = 'button'; ap.textContent = '✕'; ap.title = 'Apagar este som do servidor';
            ap.addEventListener('click', () => apagarSomDoServidor(som));
            linha.appendChild(ap);
        }
        caixa.appendChild(linha);
    });
}
async function carregarSonsDoServidor() {
    const id = servidorAtual.id;
    if (!id) { sonsDoServidor = []; desenharSonsDoServidor(); return; }
    try {
        const d = await api('GET', `/servidores/${id}/sons`);
        if (id !== servidorAtual.id) return;
        sonsDoServidor = window.SomBoard.validarLista(d); sonsServidorId = id;
        desenharSonsDoServidor();
    } catch (e) { /* servidor antigo ou sem internet: fica a lista que já tinha */ }
}
document.getElementById('btn-soundboard-rodape').addEventListener('click', () => {
    if (document.getElementById('painel-soundboard').style.display === 'flex') carregarSonsDoServidor();
});

function bytesDoSom(som) {
    const chave = servidorAtual.id + '/' + som.id;
    if (!cacheSons.has(chave)) {
        if (cacheSons.size >= 40) cacheSons.delete(cacheSons.keys().next().value);
        cacheSons.set(chave, api('GET', `/servidores/${servidorAtual.id}/sons/${som.id}`)
            .then((d) => window.SomBoard.deBase64(String(d.dados || '')))
            .catch((e) => { cacheSons.delete(chave); throw e; }));
    }
    return cacheSons.get(chave);
}

// Decodifica o arquivo e toca de duas formas ao mesmo tempo: numa faixa publicada na sala (todo mundo ouve)
// e no seu próprio alto-falante (a faixa publicada não volta pra você).
async function tocarSomDoServidor(som) {
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    if (tocandoSomServidor) return;
    tocandoSomServidor = true;
    const sala = roomVoz;
    let ctx = null, faixa = null;
    try {
        const bytes = await bytesDoSom(som);
        ctx = new AudioContext();
        const buffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const destino = ctx.createMediaStreamDestination();
        const fonte = ctx.createBufferSource();
        fonte.buffer = buffer;
        const ganho = ctx.createGain(); ganho.gain.value = 0.9;
        fonte.connect(ganho); ganho.connect(destino);
        const local = ctx.createGain(); local.gain.value = 0.5;
        fonte.connect(local); local.connect(ctx.destination);
        faixa = destino.stream.getAudioTracks()[0];
        await sala.localParticipant.publishTrack(faixa, { name: 'soundboard' });
        fonte.start();
        await new Promise((r) => setTimeout(r, (Math.min(buffer.duration, window.SomBoard.MAX_SEGUNDOS + 0.5) + 0.3) * 1000));
    } catch (err) {
        mostrarNotificacao('Não consegui tocar o som: ' + (err && err.message ? err.message : 'erro desconhecido'));
    } finally {
        try { if (faixa) await sala.localParticipant.unpublishTrack(faixa); } catch (e) { /* já saiu da sala */ }
        try { if (ctx) await ctx.close(); } catch (e) { /* ok */ }
        tocandoSomServidor = false;
    }
}

async function apagarSomDoServidor(som) {
    const r = await pedirTexto({ titulo: `Apagar "${som.nome}"?`, dica: 'O som some para todo mundo do servidor.', semCampo: true, rotuloOk: 'Apagar' });
    if (!r) return;
    try {
        await api('DELETE', `/servidores/${servidorAtual.id}/sons/${som.id}`);
        cacheSons.delete(servidorAtual.id + '/' + som.id);
        sonsDoServidor = sonsDoServidor.filter((x) => x.id !== som.id);
        desenharSonsDoServidor();
    } catch (err) { mostrarNotificacao('Não consegui apagar: ' + err.message); }
}

document.getElementById('btn-enviar-som').addEventListener('click', () => {
    if (!servidorAtual.id) return mostrarNotificacao('Abra um servidor primeiro.');
    document.getElementById('entrada-som').click();
});
document.getElementById('entrada-som').addEventListener('change', async (e) => {
    const arquivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    const SB = window.SomBoard;
    let problema = SB.problemaNoArquivo({ nome: arquivo.name, tamanho: arquivo.size });
    if (problema) return mostrarNotificacao(problema);
    let bytes, duracao;
    try {
        bytes = new Uint8Array(await arquivo.arrayBuffer());
        const ctx = new AudioContext();
        try { duracao = (await ctx.decodeAudioData(bytes.buffer.slice(0))).duration; } finally { ctx.close().catch(() => {}); }
    } catch (err) { return mostrarNotificacao('Não consegui ler o áudio deste arquivo.'); }
    problema = SB.problemaNoArquivo({ nome: arquivo.name, tamanho: arquivo.size }, duracao);
    if (problema) return mostrarNotificacao(problema);
    const r = await pedirTexto({ titulo: 'Nome do som', dica: `Todos do servidor poderão tocar na chamada (${duracao.toFixed(1).replace('.', ',')} s).`, valor: SB.nomeSugerido(arquivo.name), max: SB.MAX_NOME, rotuloOk: 'Enviar' });
    if (!r) return;
    try {
        const d = await api('POST', `/servidores/${servidorAtual.id}/sons`, { nome: r.texto, dados: SB.paraBase64(bytes), segundos: Math.round(duracao * 10) / 10 });
        mostrarNotificacao(`Som "${d.som.nome}" enviado!`, 'info');
        carregarSonsDoServidor();
    } catch (err) { mostrarNotificacao('Não consegui enviar o som: ' + err.message); }
});

document.getElementById('status-voz-persistente').addEventListener('click', () => {
    if (canalVozAtual) entrarCanalVoz(canalVozAtual); // já conectado — só troca a visualização
});

function atualizarStatusVozPersistente() {
    const status = document.getElementById('status-voz-persistente');
    if (!canalVozAtual) {
        status.style.display = 'none';
        return;
    }
    const textos = { conectando: 'Conectando...', aguardando: 'Aguardando o dono aceitar...', reconectando: 'Reconectando...' };
    document.getElementById('rotulo-voz-conectada').textContent = textos[avisoConexaoVoz] || 'Voz conectada';
    status.classList.toggle('instavel', Boolean(avisoConexaoVoz));
    document.getElementById('texto-canal-voz').textContent = canalVozAtual.nome;
    document.getElementById('texto-servidor-voz').textContent = servidorAtual.nome;
    status.style.display = 'flex';
}

// Confere o que o microfone está REALMENTE usando agora (o que o Chromium aceitou), pra não ficar no escuro.
function resumoCaptura(mediaTrack) {
    try {
        const st = mediaTrack.getSettings();
        const q = opcoesCapturaMicrofone();
        const txt = (v) => (v === undefined ? '?' : v ? 'ligado' : 'desligado');
        let r = `Em uso agora: eco ${txt(st.echoCancellation)} · ruído comum ${txt(st.noiseSuppression)} · volume automático ${txt(st.autoGainControl)}`;
        if (ruidoAvancadoAtivo()) r += ' · filtro avançado ligado (o ruído comum fica desligado de propósito)';
        const diferente = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].some((k) => st[k] !== undefined && st[k] !== q[k]);
        if (diferente) r += ' · atenção: o Windows não aceitou uma das opções';
        return r;
    } catch (e) { return ''; }
}
async function alternarTesteMicrofone() {
    if (microfoneTesteAtivo) return pararTesteMicrofone();
    try {
        streamTesteMic = await navigator.mediaDevices.getUserMedia({ audio: opcoesCapturaMicrofone() });
        let streamOuvida = streamTesteMic;
        if (filtroRuidoNecessario(true)) {
            try {
                cadeiaTesteMic = await window.Ruido.criarCadeia(streamTesteMic, opcoesFiltroRuido(true));
                streamOuvida = cadeiaTesteMic.stream;
            } catch (err) {
                console.error('Filtro de ruído avançado:', err);
                falhaFiltroRuido = true; cadeiaTesteMic = null;
                mostrarNotificacao('Não consegui ligar a supressão de ruído avançada (' + err.message + '). Usando a comum.');
                preencherControlesAudio();
                streamTesteMic.getTracks().forEach(t => t.stop());
                streamTesteMic = await navigator.mediaDevices.getUserMedia({ audio: opcoesCapturaMicrofone() });
                streamOuvida = streamTesteMic;
            }
        }
        audioTesteMic = document.createElement('audio');
        audioTesteMic.srcObject = streamOuvida;
        audioTesteMic.autoplay = true;
        if (prefsAudio.saidaId && audioTesteMic.setSinkId) { try { await audioTesteMic.setSinkId(prefsAudio.saidaId); } catch (e) {} }
        document.body.appendChild(audioTesteMic);
        microfoneTesteAtivo = true;
        { const t0 = streamTesteMic.getAudioTracks()[0]; const r = t0 && resumoCaptura(t0); if (r) mostrarNotificacao(r, 'info'); }
        iniciarMedidorMicrofone(streamOuvida); // a barra mostra o que sai do filtro, ou seja, o que os outros vão ouvir
    } catch (err) { mostrarNotificacao('Erro ao testar microfone: ' + err.message); }
    atualizarBotaoTesteConfig();
}
let cadeiaTesteMic = null;
function pararTesteMicrofone() {
    if (cadeiaTesteMic) { cadeiaTesteMic.parar(); cadeiaTesteMic = null; }
    if (streamTesteMic) streamTesteMic.getTracks().forEach(t => t.stop());
    if (audioTesteMic) audioTesteMic.remove();
    streamTesteMic = null; audioTesteMic = null; microfoneTesteAtivo = false;
    pararMedidorMicrofone();
    atualizarBotaoTesteConfig();
}

// ---------- Grade de vídeo (tiles) ----------
// Controle de volume completo: [−] [barra] [+] [número%]. A barra anda de 1 em 1, o número pode ser
// digitado, a rodinha do mouse muda de 5 em 5 (Shift: 1 em 1), clique duplo volta pra 100%.
// "compacto" é a versão pequena que fica em cima da transmissão (com botão de mudo).
const volumeAntesDoMudo = new Map(); // "identidade|tipo" -> volume de antes de mutar
function criarControleVolume(identity, tipo, { rotulo = '', compacto = false } = {}) {
    garantirEntradaAudio(identity);
    const atual = volumesPorIdentidade.get(identity)[tipo];
    const raiz = document.createElement('div');
    raiz.className = 'controle-volume' + (compacto ? ' compacto' : '');
    raiz.dataset.identidade = identity;
    raiz.dataset.tipo = tipo;

    if (rotulo) {
        const r = document.createElement('div');
        r.className = 'rotulo-volume';
        r.textContent = rotulo;
        raiz.appendChild(r);
    }
    const linha = document.createElement('div');
    linha.className = 'linha-volume';

    const botao = (texto, titulo, classe) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = texto; b.title = titulo;
        if (classe) b.className = classe;
        return b;
    };
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = String(atual);
    slider.className = 'slider-volume';
    slider.title = 'Arraste, use a rodinha do mouse ou as setas. Clique duplo: 100%';
    const campo = document.createElement('input');
    campo.type = 'number'; campo.min = '0'; campo.max = '100'; campo.step = '1';
    campo.value = String(atual);
    campo.className = 'campo-volume';
    campo.title = 'Digite um volume de 0 a 100';
    const pct = document.createElement('span');
    pct.className = 'pct-volume';
    pct.textContent = '%';

    const passo = (e) => (e.shiftKey ? 1 : 5);
    const atualVolume = () => volumesPorIdentidade.get(identity)[tipo];
    const chave = `${identity}|${tipo}`;

    if (compacto) {
        const mudo = botao(atual === 0 ? '🔇' : '🔊', 'Silenciar / reativar o som desta transmissão', 'btn-mudo-vol');
        mudo.addEventListener('click', (e) => {
            e.stopPropagation();
            const v = atualVolume();
            if (v > 0) { volumeAntesDoMudo.set(chave, v); definirVolume(identity, tipo, 0); }
            else definirVolume(identity, tipo, volumeAntesDoMudo.get(chave) || 100);
        });
        linha.appendChild(mudo);
    } else {
        const menos = botao('−', 'Diminuir 5% (Shift: 1%)');
        menos.addEventListener('click', (e) => definirVolume(identity, tipo, atualVolume() - passo(e)));
        linha.appendChild(menos);
    }
    linha.appendChild(slider);
    if (!compacto) {
        const mais = botao('+', 'Aumentar 5% (Shift: 1%)');
        mais.addEventListener('click', (e) => definirVolume(identity, tipo, atualVolume() + passo(e)));
        linha.appendChild(mais);
    }
    linha.appendChild(campo);
    linha.appendChild(pct);
    raiz.appendChild(linha);

    slider.addEventListener('input', () => definirVolume(identity, tipo, slider.value));
    slider.addEventListener('dblclick', () => definirVolume(identity, tipo, 100));
    slider.addEventListener('wheel', (e) => {
        e.preventDefault(); e.stopPropagation();
        definirVolume(identity, tipo, atualVolume() + (e.deltaY < 0 ? 1 : -1) * passo(e));
    }, { passive: false });
    campo.addEventListener('input', () => { if (campo.value !== '') definirVolume(identity, tipo, campo.value); });
    campo.addEventListener('blur', () => { campo.value = String(atualVolume()); });
    campo.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') campo.blur(); });
    // Cliques aqui dentro não podem acionar o clique do vídeo (que troca o destaque) nem fechar painéis.
    raiz.addEventListener('click', (e) => e.stopPropagation());
    raiz.addEventListener('dblclick', (e) => e.stopPropagation());
    return raiz;
}

function criarSliderVolume(identity, nome, tipo, rotulo) {
    return criarControleVolume(identity, tipo, { rotulo });
}

// Moderação (só o dono do servidor; o servidor confere pela conta de quem pediu).
async function pararTransmissaoDe(identity, nome) {
    try {
        const r = await window.electronAPI.forcarPararTransmissao({
            sala: nomeSalaCanal(canalVozAtual),
            identidadeAlvo: identity
        });
        mostrarNotificacao(r && r.faixasPausadas === 0 ? `${nome} não está transmitindo.` : `Transmissão de ${nome} foi encerrada.`, 'info');
    } catch (err) {
        mostrarNotificacao('Erro ao parar transmissão: ' + err.message);
    }
}

async function mutarMicrofoneDe(identity, nome) {
    try {
        const r = await window.electronAPI.forcarMutarMicrofone({
            sala: nomeSalaCanal(canalVozAtual),
            identidadeAlvo: identity
        });
        mostrarNotificacao(r && r.faixasPausadas === 0 ? `${nome} já estava com o microfone desligado.` : `O microfone de ${nome} foi mutado.`, 'info');
    } catch (err) {
        mostrarNotificacao('Erro ao mutar o microfone: ' + err.message);
    }
}

// ---------- Menu do botão direito ----------
// "construir" devolve { cabecalho, itens }; itens com "mantemAberto" deixam o menu aberto e o
// redesenham depois da ação (assim dá pra clicar em "Aumentar volume" várias vezes seguidas).
let menuContextoAberto = null;

function fecharMenuContexto() {
    if (!menuContextoAberto) return;
    menuContextoAberto.remove();
    menuContextoAberto = null;
    document.removeEventListener('mousedown', fecharMenuAoClicarFora, true);
    document.removeEventListener('keydown', fecharMenuComEsc, true);
}
function fecharMenuAoClicarFora(e) {
    if (menuContextoAberto && !menuContextoAberto.contains(e.target)) fecharMenuContexto();
}
function fecharMenuComEsc(e) {
    if (e.key === 'Escape') fecharMenuContexto();
}

function abrirMenu(x, y, construir) {
    fecharMenuContexto();
    fecharPainelAudio();

    const menu = document.createElement('div');
    menu.className = 'menu-contexto';

    // Submenu: itens com "submenu" (função que devolve itens) abrem uma lista ao lado ao passar o mouse.
    let subAberto = null, subDe = null, timerSub = 0;
    function fecharSub() { clearTimeout(timerSub); if (subAberto) subAberto.remove(); subAberto = null; if (subDe) subDe.classList.remove('sub-aberto'); subDe = null; }
    function abrirSub(botao, item) {
        clearTimeout(timerSub);
        if (subDe === botao) return;
        fecharSub();
        const sub = document.createElement('div');
        sub.className = 'menu-contexto submenu';
        sub.setAttribute('role', 'menu');
        item.submenu().forEach((s) => {
            if (s.separador) { const l = document.createElement('div'); l.className = 'separador-menu'; sub.appendChild(l); return; }
            if (s.titulo) { const t = document.createElement('div'); t.className = 'titulo-submenu'; t.textContent = s.titulo; sub.appendChild(t); return; }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'item-menu' + (s.marcado ? ' marcado' : '');
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('aria-checked', s.marcado ? 'true' : 'false');
            b.textContent = (s.marcado ? '✓ ' : '') + s.rotulo;
            b.addEventListener('click', async () => {
                if (!s.mantemAberto) fecharMenuContexto();
                await s.acao();
                if (s.mantemAberto && menuContextoAberto === menu) { desenhar(); }
            });
            sub.appendChild(b);
        });
        sub.addEventListener('mouseenter', () => clearTimeout(timerSub));
        sub.addEventListener('mouseleave', () => { timerSub = setTimeout(fecharSub, 250); });
        menu.appendChild(sub);
        subAberto = sub; subDe = botao; botao.classList.add('sub-aberto');
        // ao lado direito do item; se não couber, do lado esquerdo do menu
        const r = botao.getBoundingClientRect(), m = menu.getBoundingClientRect(), c = sub.getBoundingClientRect();
        const larguraTela = window.innerWidth || 1200, alturaTela = window.innerHeight || 800;
        let left = m.right + 4;
        if (left + c.width > larguraTela - 8) left = Math.max(8, m.left - c.width - 4);
        const top = Math.max(8, Math.min(r.top - 6, alturaTela - c.height - 8));
        sub.style.left = left + 'px'; sub.style.top = top + 'px';
    }

    function desenhar() {
        fecharSub();
        menu.innerHTML = '';
        const { cabecalho, itens } = construir();
        if (cabecalho) {
            const topo = document.createElement('div');
            topo.className = 'cabecalho-menu';
            topo.textContent = cabecalho;
            menu.appendChild(topo);
        }
        itens.forEach((item) => {
            if (item.separador) {
                const linha = document.createElement('div');
                linha.className = 'separador-menu';
                menu.appendChild(linha);
                return;
            }
            if (item.titulo) { const t = document.createElement('div'); t.className = 'titulo-submenu'; t.textContent = item.titulo; menu.appendChild(t); return; }
            const botao = document.createElement('button');
            botao.className = 'item-menu' + (item.perigo ? ' perigo' : '') + (item.submenu ? ' tem-submenu' : '') + (item.marcado ? ' marcado' : '') + (item.chave !== undefined ? ' com-chave' : '');
            botao.textContent = item.rotulo;
            if (item.marcado !== undefined) botao.setAttribute('aria-checked', item.marcado ? 'true' : 'false');
            if (item.chave !== undefined) {
                // Liga/desliga: uma chavinha no canto direito do item.
                botao.setAttribute('role', 'menuitemcheckbox');
                botao.setAttribute('aria-checked', item.chave ? 'true' : 'false');
                const ch = document.createElement('span');
                ch.className = 'chave-menu' + (item.chave ? ' ligada' : '');
                ch.setAttribute('aria-hidden', 'true');
                botao.appendChild(ch);
            }
            botao.dataset.acao = item.id || '';
            if (item.dica) botao.title = item.dica;
            botao.disabled = Boolean(item.desabilitado);
            if (item.submenu) {
                botao.setAttribute('aria-haspopup', 'menu');
                botao.addEventListener('mouseenter', () => { clearTimeout(timerSub); timerSub = setTimeout(() => abrirSub(botao, item), 80); });
                botao.addEventListener('mouseleave', () => { clearTimeout(timerSub); timerSub = setTimeout(fecharSub, 250); });
                // clique (ou Enter/seta para a direita no teclado) também abre a lista
                botao.addEventListener('click', () => { abrirSub(botao, item); const p = subAberto && subAberto.querySelector('button'); if (p) p.focus(); });
                botao.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); botao.click(); } });
                menu.appendChild(botao);
                return;
            }
            // passar o mouse num item comum fecha a lista ao lado
            botao.addEventListener('mouseenter', () => { if (subAberto) { clearTimeout(timerSub); timerSub = setTimeout(fecharSub, 150); } });
            botao.addEventListener('click', async () => {
                if (!item.mantemAberto) fecharMenuContexto();
                await item.acao();
                if (item.mantemAberto && menuContextoAberto === menu) desenhar();
            });
            menu.appendChild(botao);
        });
    }
    desenhar();

    document.body.appendChild(menu);
    menu.style.left = '0px'; menu.style.top = '0px';
    const caixa = menu.getBoundingClientRect();
    const larguraTela = window.innerWidth || 1200, alturaTela = window.innerHeight || 800;
    menu.style.left = Math.max(Math.min(x, larguraTela - caixa.width - 10), 10) + 'px';
    menu.style.top = Math.max(Math.min(y, alturaTela - caixa.height - 10), 10) + 'px';
    menuContextoAberto = menu;
    setTimeout(() => {
        document.addEventListener('mousedown', fecharMenuAoClicarFora, true);
        document.addEventListener('keydown', fecharMenuComEsc, true);
    }, 0);
}

// Menu de uma pessoa na sala de voz.
// Menu da CHAMADA (botão direito no nome de quem está na chamada): só voz e transmissão.
// (Perfil, amizade, denúncia e administração ficam no menu da lista de membros.)
function tileDaTransmissaoDe(identity) {
    for (const [sid, t] of tiles) if (t.identidade === identity && !t.ehVoce && t.origem !== 'camera') return { sid, ...t };
    return null;
}
// Lista de efeitos para o submenu "Efeito de voz" (os mesmos do seletor em Configurações, inclusive as vozes criadas).
// Escolher aqui é igual a escolher lá: muda o seletor e dispara o mesmo evento, então salva e aplica na hora.
function itensEfeitoDeVoz() {
    const sel = document.getElementById('cfg-efeito-voz');
    popularEfeitosCriados();
    const escolher = (valor) => async () => {
        sel.value = valor;
        if (sel.value !== valor) return;
        sel.dispatchEvent(new Event('change'));
        mostrarNotificacao(valor === 'nenhum' ? 'Efeito de voz desligado.' : 'Efeito de voz: ' + nomeDoEfeito(valor), 'info');
    };
    const itens = [];
    let grupo = null;
    for (const o of sel.querySelectorAll('option')) {
        const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null;
        if (g && g !== grupo) { itens.push({ separador: true }, { titulo: g }); }
        grupo = g;
        itens.push({ rotulo: o.textContent, marcado: prefsAudio.efeito === o.value, acao: escolher(o.value) });
        if (o.value === 'nenhum') itens.push({ separador: true });
    }
    itens.push({ separador: true }, { rotulo: '🎛️ Criar um efeito novo...', acao: () => abrirEditorEfeito(null) });
    if (prefsAudio.efeito.startsWith('voz:')) itens.push({ rotulo: '✏️ Editar este efeito...', acao: () => abrirEditorEfeito(prefsAudio.efeito) });
    return itens;
}
function abrirMenuContexto(identity, nome, ehVoce, x, y, estaTransmitindo) {
    abrirMenu(x, y, () => {
        if (ehVoce) {
            const itens = [
                { id: 'mic', rotulo: microfoneAtivo ? '🎙️ Desligar meu microfone' : '🎙️ Ligar meu microfone', mantemAberto: true, acao: () => alternarMicrofone(null) },
                { id: 'surdo', rotulo: surdoAtivo ? '🔊 Voltar a ouvir todo mundo' : '🔇 Ensurdecer (parar de ouvir todo mundo)', mantemAberto: true, acao: () => document.getElementById('btn-surdo-rodape').click() },
                { id: 'testar-mic', rotulo: microfoneTesteAtivo ? '🎧 Parar o teste do microfone' : '🎧 Testar meu microfone', mantemAberto: true, acao: () => alternarTesteMicrofone() },
                { separador: true },
                transmitindoAgora
                    ? { id: 'parar-minha', rotulo: '⏹ Parar a minha transmissão', perigo: true, acao: () => encerrarTransmissao() }
                    : { id: 'transmitir', rotulo: '🖥️ Transmitir a minha tela', acao: () => document.getElementById('btn-tela-rodape').click() },
                { id: 'efeito', rotulo: `🎭 Efeito de voz: ${prefsAudio.efeito === 'nenhum' ? 'Sem efeito' : nomeDoEfeito(prefsAudio.efeito).replace(/^🎭 /, '')}`, submenu: () => itensEfeitoDeVoz() },
                { separador: true },
                { id: 'sair', rotulo: '🚪 Sair da chamada', perigo: true, acao: () => document.getElementById('btn-sair-voz').click() },
            ];
            return { cabecalho: `${nome} (você)`, itens };
        }

        garantirEntradaAudio(identity);
        const vol = volumesPorIdentidade.get(identity);
        const silenciado = silenciadosPorIdentidade.has(identity);
        const itens = [
            { id: 'silenciar', rotulo: silenciado ? '🔈 Voltar a ouvir esta pessoa' : '🔇 Silenciar (só pra você)', dica: 'Só você deixa de ouvir esta pessoa.', mantemAberto: true, acao: () => alternarSilencioDe(identity) },
            { id: 'aumentar', rotulo: vol.microfone >= 100 ? '🔊 Voz: já está no máximo' : '🔊 Aumentar a voz (+5%)', desabilitado: vol.microfone >= 100, mantemAberto: true, acao: () => ajustarVolumeDaVoz(identity, 5) },
            { id: 'reduzir', rotulo: vol.microfone <= 0 ? '🔉 Voz: já está no mínimo' : '🔉 Diminuir a voz (−5%)', desabilitado: vol.microfone <= 0, mantemAberto: true, acao: () => ajustarVolumeDaVoz(identity, -5) },
        ];
        if (vol.microfone !== 100 || vol.compartilhamento !== 100) {
            itens.push({ id: 'normal', rotulo: '↩️ Voltar os volumes ao normal (100%)', mantemAberto: true, acao: () => { definirVolume(identity, 'microfone', 100); definirVolume(identity, 'compartilhamento', 100); } });
        }
        itens.push({ id: 'refazer', rotulo: '🔄 Som dessa pessoa estranho? Refazer', dica: 'Recarrega só o som dessa pessoa (baixo, alto demais, cortando), sem ninguém sair da chamada.', acao: () => refazerAudioDe(identity, nome) });
        // Transmissão dessa pessoa (tela).
        const tela = estaTransmitindo ? tileDaTransmissaoDe(identity) : null;
        if (estaTransmitindo) {
            itens.push({ separador: true });
            itens.push({ id: 'som-tela-mais', rotulo: vol.compartilhamento >= 100 ? '🖥️ Som da transmissão: no máximo' : '🖥️ Aumentar o som da transmissão (+10%)', desabilitado: vol.compartilhamento >= 100, mantemAberto: true, acao: () => definirVolume(identity, 'compartilhamento', vol.compartilhamento + 10) });
            itens.push({ id: 'som-tela-menos', rotulo: vol.compartilhamento <= 0 ? '🖥️ Som da transmissão: no mínimo' : '🖥️ Diminuir o som da transmissão (−10%)', desabilitado: vol.compartilhamento <= 0, mantemAberto: true, acao: () => definirVolume(identity, 'compartilhamento', vol.compartilhamento - 10) });
            itens.push({ id: 'som-tela-mudo', rotulo: vol.compartilhamento === 0 ? '🔈 Voltar o som da transmissão' : '🔇 Tirar o som da transmissão', mantemAberto: true, acao: () => definirVolume(identity, 'compartilhamento', vol.compartilhamento === 0 ? 100 : 0) });
            if (tela) {
                itens.push({ id: 'tela-cheia', rotulo: '⛶ Ver a transmissão em tela cheia', acao: () => {
                    const el = document.getElementById('tile-' + tela.sid);
                    if (el && el.requestFullscreen) el.requestFullscreen().catch(() => mostrarNotificacao('Não consegui abrir em tela cheia.'));
                    else mostrarNotificacao('Abra a área da chamada para ver a transmissão.');
                } });
                itens.push({ id: 'pip', rotulo: '⧉ Ver numa janelinha (por cima de tudo)', acao: () => { if (tela.videoEl && tela.videoEl.requestPictureInPicture) tela.videoEl.requestPictureInPicture().catch(() => mostrarNotificacao('Não consegui abrir a janelinha.')); } });
            }
        }
        // Dono do servidor: o que vale pra todo mundo na chamada.
        if (souAnfitriaoVoz) {
            itens.push({ separador: true });
            itens.push({ id: 'mutar', rotulo: '🎙️ Mutar o microfone (pra todos)', dica: 'Desliga o microfone dessa pessoa pra todo mundo na chamada.', acao: () => mutarMicrofoneDe(identity, nome) });
            if (estaTransmitindo) itens.push({ id: 'parar', rotulo: '⏹ Parar a transmissão dela', perigo: true, acao: () => pararTransmissaoDe(identity, nome) });
            itens.push({ id: 'tirar', rotulo: '🚪 Tirar da chamada', perigo: true, acao: () => tirarDaChamada(identity, nome) });
        }
        return { cabecalho: `${nome} · voz ${vol.microfone}%${silenciado ? ' (silenciada)' : ''}`, itens };
    });
}

// Dono do servidor tira alguém da chamada (a pessoa pode entrar de novo; pra impedir, expulse do servidor).
async function tirarDaChamada(identity, nome) {
    const r = await pedirTexto({ titulo: `Tirar ${nome} da chamada?`, dica: 'A pessoa é desconectada desta chamada agora. Ela pode entrar de novo; para impedir, expulse do servidor.', semCampo: true, rotuloOk: 'Tirar da chamada' });
    if (!r) return;
    try {
        await window.electronAPI.forcarTirarDaChamada({ sala: nomeSalaCanal(canalVozAtual), identidadeAlvo: identity });
        mostrarNotificacao(`${nome} saiu da chamada.`, 'info');
    } catch (err) { mostrarNotificacao('Não consegui tirar da chamada: ' + err.message); }
}

let painelAudioAberto = null;
function fecharPainelAudio() {
    if (painelAudioAberto) { painelAudioAberto.remove(); painelAudioAberto = null; document.removeEventListener('click', fecharPainelAoClicarFora, true); }
}
function fecharPainelAoClicarFora(e) { if (painelAudioAberto && !painelAudioAberto.contains(e.target)) fecharPainelAudio(); }

function abrirPainelAudio(identity, nome, ehVoce, x, y, estaTransmitindo, ancora) {
    fecharPainelAudio();
    const painel = document.createElement('div');
    painel.className = 'painel-audio-pessoa';
    const titulo = document.createElement('div');
    titulo.className = 'titulo-painel';
    titulo.innerHTML = `<span>${escaparHtml(nome)}${ehVoce ? ' (você)' : ''}</span>`;
    const btnFechar = document.createElement('button');
    btnFechar.textContent = '✕';
    btnFechar.addEventListener('click', fecharPainelAudio);
    titulo.appendChild(btnFechar);
    painel.appendChild(titulo);

    if (ehVoce) {
        const btnMic = document.createElement('button');
        btnMic.className = 'btn-mic-toggle' + (microfoneAtivo ? ' ativo' : '');
        btnMic.textContent = microfoneAtivo ? '🎤 Desativar microfone' : '🎤 Ativar microfone';
        btnMic.addEventListener('click', () => alternarMicrofone(btnMic));
        painel.appendChild(btnMic);

        const btnTestar = document.createElement('button');
        btnTestar.className = 'btn-mic-teste' + (microfoneTesteAtivo ? ' ativo' : '');
        btnTestar.textContent = microfoneTesteAtivo ? '🎧 Parar teste' : '🎧 Testar microfone';
        btnTestar.addEventListener('click', async () => {
            await alternarTesteMicrofone();
            btnTestar.textContent = microfoneTesteAtivo ? '🎧 Parar teste' : '🎧 Testar microfone';
            btnTestar.classList.toggle('ativo', microfoneTesteAtivo);
        });
        painel.appendChild(btnTestar);
    } else {
        garantirEntradaAudio(identity);
        painel.appendChild(criarSliderVolume(identity, nome, 'microfone', '🎤 Voz'));
        painel.appendChild(criarSliderVolume(identity, nome, 'compartilhamento', '🖥️ Som da transmissão'));

        const btnSilenciar = document.createElement('button');
        const rotuloSilencio = () => silenciadosPorIdentidade.has(identity) ? '🔈 Reativar o som dessa pessoa' : '🔇 Silenciar essa pessoa (só pra você)';
        btnSilenciar.textContent = rotuloSilencio();
        btnSilenciar.addEventListener('click', () => { alternarSilencioDe(identity); btnSilenciar.textContent = rotuloSilencio(); });
        painel.appendChild(btnSilenciar);

        // Ações de dono do servidor (o servidor confere de novo).
        const btnMutar = document.createElement('button');
        btnMutar.textContent = '🎙️ Mutar o microfone (pra todos)';
        btnMutar.disabled = !souAnfitriaoVoz;
        btnMutar.title = souAnfitriaoVoz ? 'Desliga o microfone dessa pessoa pra todo mundo na sala.' : 'Só o dono do servidor pode fazer isso.';
        btnMutar.addEventListener('click', async () => { await mutarMicrofoneDe(identity, nome); fecharPainelAudio(); });
        painel.appendChild(btnMutar);

        if (souAnfitriaoVoz && estaTransmitindo) {
            const btn = document.createElement('button');
            btn.className = 'btn-parar-transmissao-alheia';
            btn.textContent = '⏹ Parar transmissão dela';
            btn.addEventListener('click', async () => {
                await pararTransmissaoDe(identity, nome);
                fecharPainelAudio();
            });
            painel.appendChild(btn);
        }
    }

    document.body.appendChild(painel);
    painel.style.left = '0px'; painel.style.top = '0px';
    const rect = painel.getBoundingClientRect();
    let left, top;
    if (ancora && ancora.getBoundingClientRect) {
        // Fica logo acima do nome da pessoa (se não couber em cima, vai pra baixo).
        const a = ancora.getBoundingClientRect();
        left = a.left;
        top = a.top - rect.height - 8;
        if (top < 10) top = a.bottom + 8;
    } else {
        left = x;
        top = y;
    }
    left = Math.min(left, window.innerWidth - rect.width - 10);
    top = Math.min(top, window.innerHeight - rect.height - 10);
    painel.style.left = Math.max(left, 10) + 'px';
    painel.style.top = Math.max(top, 10) + 'px';
    painelAudioAberto = painel;
    setTimeout(() => document.addEventListener('click', fecharPainelAoClicarFora, true), 0);
}

function criarElementoTile(trackSid, info, grande) {
    const tile = document.createElement('div');
    tile.className = 'tile-video' + (grande ? ' tile-video--foco' : '');
    tile.id = 'tile-' + trackSid;
    info.videoEl.autoplay = true;
    tile.appendChild(info.videoEl);

    const btnTelaCheia = document.createElement('button');
    btnTelaCheia.className = 'btn-tela-cheia';
    btnTelaCheia.title = 'Tela cheia';
    btnTelaCheia.innerHTML = '⤢';
    // Tela cheia no quadro inteiro (não só no vídeo), pra o controle de volume continuar disponível.
    btnTelaCheia.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
        if (!tile.requestFullscreen) return mostrarNotificacao('Tela cheia não disponível aqui.');
        tile.requestFullscreen().catch(() => mostrarNotificacao('Não consegui abrir em tela cheia. Tente o botão de ampliar (⛶).'));
    });
    tile.appendChild(btnTelaCheia);

    // Ampliar: esconde as colunas laterais e deixa a transmissão ocupar a janela toda (Esc volta).
    const btnCinema = document.createElement('button');
    btnCinema.className = 'btn-tela-cheia cinema';
    btnCinema.title = document.body.classList.contains('modo-cinema') ? 'Voltar ao normal (Esc)' : 'Ampliar: esconde as colunas e usa a janela toda';
    btnCinema.innerHTML = document.body.classList.contains('modo-cinema') ? '⤡' : '⛶';
    btnCinema.addEventListener('click', (e) => { e.stopPropagation(); alternarModoCinema(); });
    tile.appendChild(btnCinema);

    if (document.pictureInPictureEnabled) {
        const btnPip = document.createElement('button');
        btnPip.className = 'btn-tela-cheia pip';
        btnPip.title = 'Janela flutuante';
        btnPip.innerHTML = '⧉';
        btnPip.addEventListener('click', (e) => { e.stopPropagation(); info.videoEl.requestPictureInPicture().catch(() => {}); });
        tile.appendChild(btnPip);
    }

    const rotulo = document.createElement('div');
    rotulo.className = 'tile-rotulo';
    rotulo.innerHTML = `<span class="ponto-ao-vivo"></span> <span class="tile-nome">${escaparHtml(info.nome)}${info.ehVoce ? ' (você)' : ''}</span>`;
    // Clicar no nome de quem está transmitindo abre as opções de áudio dessa pessoa, logo acima do nome.
    if (!info.ehVoce && info.identidade && grande) {
        const nomeEl = rotulo.querySelector('.tile-nome');
        nomeEl.classList.add('com-audio');
        nomeEl.title = 'Opções de áudio dessa pessoa';
        nomeEl.textContent += ' ⚙';
        nomeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirPainelAudio(info.identidade, info.nome, false, e.clientX, e.clientY, true, nomeEl);
        });
    }
    if (info.ehVoce) {
        const diag = document.createElement('span');
        diag.className = 'diagnostico-info';
        diag.id = 'diagnostico-' + trackSid;
        rotulo.appendChild(diag);
    }
    tile.appendChild(rotulo);

    // Volume da transmissão de outra pessoa (o som que vem junto com a tela dela).
    if (!info.ehVoce && info.identidade && info.origem === 'tela' && grande) {
        const caixa = document.createElement('div');
        caixa.className = 'tile-volume';
        caixa.title = 'Volume da transmissão';
        caixa.appendChild(criarControleVolume(info.identidade, 'compartilhamento', { compacto: true }));
        tile.appendChild(caixa);
    }

    if (info.identidade && info.origem && grande) ligarDesenhoNoTile(tile, info);

    if (tiles.size > 1) {
        tile.classList.add('clicavel');
        if (!trackEmFoco) {
            // Lado a lado: clique escolhe a tela; dois cliques aumenta (ou volta ao tamanho igual).
            tile.dataset.sid = trackSid;
            if (tileEscolhido === trackSid) tile.classList.add('escolhido');
            tile.addEventListener('click', (e) => { if (e.target.closest('button, input, .tile-volume, .controles-escolhido')) return; escolherTile(trackSid); });
            tile.addEventListener('dblclick', (e) => { if (e.target.closest('button, input, .tile-volume, .controles-escolhido')) return; aumentarTile(trackSid, 'alternar'); });
            tile.appendChild(controlesDoEscolhido(trackSid));
        } else if (!grande) {
            tile.addEventListener('click', () => { trackEmFoco = trackSid; renderizarVideo(); });
        }
    }
    return tile;
}

// ---------- Várias transmissões ao mesmo tempo ----------
// "Lado a lado": todas aparecem juntas. Clique numa pra escolher; aí ela ganha botões pra aumentar/diminuir,
// e dá pra arrastar a divisória entre elas. Cada tela pede ao servidor a resolução do tamanho que está
// ocupando, então aumentar uma tela também aumenta a qualidade dela.
// "Uma por vez": uma grande e as outras em miniatura embaixo (clique numa miniatura pra trocar).
let tileEscolhido = null;
const pesosTiles = new Map(); // trackSid -> tamanho relativo (1 = normal)
const PESO_MIN = 0.35, PESO_MAX = 4;
const pesoDe = (sid) => pesosTiles.get(sid) || 1;

function controlesDoEscolhido(sid) {
    const caixa = document.createElement('div');
    caixa.className = 'controles-escolhido';
    const b = (txt, dica, acao) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = txt; x.title = dica; x.setAttribute('aria-label', dica); x.addEventListener('click', (e) => { e.stopPropagation(); acao(); }); caixa.appendChild(x); };
    b('＋ Maior', 'Aumentar esta tela', () => aumentarTile(sid, 1.35));
    b('－ Menor', 'Diminuir esta tela', () => aumentarTile(sid, 1 / 1.35));
    b('▣ Só esta', 'Assistir só esta (as outras ficam em miniatura)', () => { trackEmFoco = sid; renderizarVideo(); });
    return caixa;
}
function escolherTile(sid, manter) {
    tileEscolhido = (!manter && tileEscolhido === sid) ? null : sid;
    document.querySelectorAll('#grade-video .fileira-juntas > .tile-video').forEach((t) => t.classList.toggle('escolhido', t.dataset.sid === tileEscolhido));
}
function aplicarPesosTiles() {
    document.querySelectorAll('#grade-video .fileira-juntas > .tile-video').forEach((t) => { t.style.flexGrow = String(pesoDe(t.dataset.sid)); });
}
function aumentarTile(sid, fator) {
    if (fator === 'alternar') {
        const grande = pesoDe(sid) > 1.2;
        tiles.forEach((_, s) => pesosTiles.set(s, 1));
        if (!grande) pesosTiles.set(sid, 2.4);
    } else {
        pesosTiles.set(sid, Math.min(PESO_MAX, Math.max(PESO_MIN, pesoDe(sid) * fator)));
    }
    escolherTile(sid, true);
    aplicarPesosTiles();
}
function igualarTiles() { pesosTiles.clear(); aplicarPesosTiles(); }

// Divisória entre duas telas: arrastar muda o tamanho das duas (a soma fica igual).
function criarDivisoria(sidA, sidB) {
    const d = document.createElement('div');
    d.className = 'divisoria-juntas';
    d.title = 'Arraste para mudar o tamanho das telas';
    d.setAttribute('role', 'separator');
    d.addEventListener('pointerdown', (e) => {
        const a = document.getElementById('tile-' + sidA), b = document.getElementById('tile-' + sidB);
        if (!a || !b) return;
        e.preventDefault();
        d.setPointerCapture(e.pointerId);
        d.classList.add('arrastando');
        const x0 = e.clientX, wa = a.getBoundingClientRect().width, wb = b.getBoundingClientRect().width;
        const soma = pesoDe(sidA) + pesoDe(sidB);
        const mover = (ev) => {
            const total = wa + wb;
            const novaA = Math.min(total * 0.85, Math.max(total * 0.15, wa + (ev.clientX - x0)));
            const pa = soma * novaA / total;
            pesosTiles.set(sidA, pa); pesosTiles.set(sidB, soma - pa);
            a.style.flexGrow = String(pa); b.style.flexGrow = String(soma - pa);
        };
        const soltar = () => { d.classList.remove('arrastando'); d.removeEventListener('pointermove', mover); d.removeEventListener('pointerup', soltar); d.removeEventListener('pointercancel', soltar); };
        d.addEventListener('pointermove', mover);
        d.addEventListener('pointerup', soltar);
        d.addEventListener('pointercancel', soltar);
    });
    d.addEventListener('dblclick', () => { pesosTiles.set(sidA, 1); pesosTiles.set(sidB, 1); aplicarPesosTiles(); });
    return d;
}

function barraTransmissoes() {
    const barra = document.createElement('div');
    barra.className = 'barra-transmissoes';
    const juntas = !trackEmFoco;
    const titulo = document.createElement('span');
    titulo.className = 'bt-titulo';
    titulo.textContent = `📺 ${tiles.size} transmissões`;
    barra.appendChild(titulo);
    const seg = document.createElement('div');
    seg.className = 'segmentado bt-modos';
    [['juntas', '▦ Lado a lado', 'Assistir todas ao mesmo tempo'], ['uma', '▣ Uma por vez', 'Uma grande e as outras em miniatura']].forEach(([modo, txt, dica]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = txt; b.title = dica;
        if ((modo === 'juntas') === juntas) b.classList.add('ativo');
        b.addEventListener('click', () => {
            if (modo === 'juntas') trackEmFoco = null;
            else if (!trackEmFoco) trackEmFoco = (tileEscolhido && tiles.has(tileEscolhido)) ? tileEscolhido : [...tiles.keys()][0];
            renderizarVideo();
        });
        seg.appendChild(b);
    });
    barra.appendChild(seg);
    if (juntas) {
        const igual = document.createElement('button');
        igual.type = 'button'; igual.className = 'bt-igualar'; igual.textContent = '↔ Mesmo tamanho';
        igual.title = 'Deixar todas as telas do mesmo tamanho';
        igual.addEventListener('click', igualarTiles);
        barra.appendChild(igual);
        const dica = document.createElement('span');
        dica.className = 'bt-dica';
        dica.textContent = 'Clique numa tela pra escolher · arraste a divisória pra mudar o tamanho · dois cliques aumenta';
        barra.appendChild(dica);
    }
    return barra;
}

function renderizarVideo() {
    const grade = document.getElementById('grade-video');
    grade.innerHTML = '';
    if (tiles.size === 0) {
        grade.className = 'grade-video';
        grade.innerHTML = '<div class="placeholder-vazio"><div class="icone">▢</div>Nenhuma transmissão ativa neste canal</div>';
        return;
    }
    if (tiles.size === 1) {
        grade.className = 'grade-video';
        const [trackSid, info] = [...tiles.entries()][0];
        grade.appendChild(criarElementoTile(trackSid, info, true));
        return;
    }
    if (trackEmFoco && !tiles.has(trackEmFoco)) trackEmFoco = null;
    if (tileEscolhido && !tiles.has(tileEscolhido)) tileEscolhido = null;
    if (trackEmFoco) {
        grade.className = 'grade-video modo-foco';
        grade.appendChild(barraTransmissoes());
        grade.appendChild(criarElementoTile(trackEmFoco, tiles.get(trackEmFoco), true));
        const linha = document.createElement('div');
        linha.className = 'linha-miniaturas';
        tiles.forEach((info, trackSid) => { if (trackSid !== trackEmFoco) linha.appendChild(criarElementoTile(trackSid, info, false)); });
        grade.appendChild(linha);
    } else {
        grade.className = 'grade-video modo-juntas';
        grade.appendChild(barraTransmissoes());
        const fileira = document.createElement('div');
        fileira.className = 'fileira-juntas' + (tiles.size >= 4 ? ' em-grade' : '');
        const sids = [...tiles.keys()];
        sids.forEach((trackSid, i) => {
            if (i > 0 && tiles.size < 4) fileira.appendChild(criarDivisoria(sids[i - 1], trackSid));
            const t = criarElementoTile(trackSid, tiles.get(trackSid), true);
            t.style.flexGrow = String(pesoDe(trackSid));
            fileira.appendChild(t);
        });
        grade.appendChild(fileira);
    }
}

function adicionarTile(trackSid, elementoMidia, nome, ehVoce, extra = {}) {
    tiles.set(trackSid, { videoEl: elementoMidia, nome, ehVoce, identidade: extra.identidade || null, origem: extra.origem || null });
    renderizarVideo();
}
function removerTile(trackSid) {
    tiles.delete(trackSid);
    pesosTiles.delete(trackSid);
    if (tileEscolhido === trackSid) tileEscolhido = null;
    if (trackEmFoco === trackSid) trackEmFoco = null;
    if (tiles.size === 0 && document.body.classList.contains('modo-cinema')) { alternarModoCinema(false); return; } // acabou a transmissão: volta ao normal
    renderizarVideo();
}

// ---------- Lista de membros (coluna direita) ----------
// Alguém começou ou parou de falar: só liga/desliga o destaque de cada pessoa. Remontar a lista inteira várias
// vezes por segundo fazia ela piscar e fechava o menu de quem estava com o mouse em cima.
function atualizarDestaqueDeFala() {
    if (!vozConectada()) { atualizarListaMembros(); return; }
    const itens = document.querySelectorAll('#lista-membros .item-membro[data-identidade]');
    if (itens.length !== roomVoz.remoteParticipants.size + 1) { atualizarListaMembros(); atualizarSubMembrosVoz(); return; } // lista desatualizada: remonta
    itens.forEach((el) => el.classList.toggle('falando', identidadesFalando.has(el.dataset.identidade)));
    document.querySelectorAll('.sub-membro-voz[data-identidade]').forEach((el) => el.classList.toggle('falando', identidadesFalando.has(el.dataset.identidade)));
    renderizarFesta();
    enviarEstadoFlutuante();
}

function atualizarListaMembros() {
    const lista = document.getElementById('lista-membros');
    const titulo = document.getElementById('titulo-membros');
    lista.innerHTML = '';

    if (!vozConectada()) {
        titulo.style.display = 'none';
        renderizarFesta();
        enviarEstadoFlutuante();
        return;
    }

    titulo.style.display = 'block';
    const participantes = [roomVoz.localParticipant, ...roomVoz.remoteParticipants.values()];
    titulo.textContent = `EM "${canalVozAtual.nome}" — ${participantes.length}`;

    participantes.forEach(p => {
        const ehVoce = p === roomVoz.localParticipant;
        const nome = p.name || p.identity || '?';
        const transmitindo = [...p.videoTrackPublications.values()].some(pub => pub.source === LivekitClient.Track.Source.ScreenShare);
        const falando = identidadesFalando.has(p.identity);

        const item = document.createElement('div');
        item.className = 'item-membro' + (transmitindo ? ' transmitindo' : '') + (falando ? ' falando' : '');
        item.dataset.identidade = p.identity;
        const micLigado = ehVoce ? microfoneAtivo : p.isMicrophoneEnabled === true;
        const silenciado = !ehVoce && silenciadosPorIdentidade.has(p.identity);
        item.innerHTML = `
            <span class="avatar-participante"></span>
            <span>${ehVoce ? escaparHtml(nome) + ' (você)' : htmlNomeComConta(nome, contaDoParticipante(p))}</span>
            <span class="icone-mic ${micLigado ? 'ligado' : 'mudo'}" title="${micLigado ? 'Microfone ligado' : 'Microfone desligado'}">🎙️</span>
            ${silenciado ? '<span class="icone-silenciado" title="Você silenciou esta pessoa">🔇</span>' : ''}
            <span class="ponto-qualidade ${qualidadePorIdentidade.get(p.identity) || 'desconhecida'}"></span>`;
        aplicarAvatar(item.querySelector('.avatar-participante'), p.identity, nome, avatarDoParticipante(p, ehVoce ? avatarUsuarioAtual : null));
        { // cargos (Fundador, Moderador, Dono) também na lista da chamada
            const cargos = cargosDe(p.identity);
            if (cargos.length) { const sv = document.createElement('span'); sv.className = 'selos-voz'; cargos.forEach((c) => sv.appendChild(seloCargo(c))); item.children[1].appendChild(sv); }
        }
        // Clique normal: painel com os controles de volume. Botão direito: menu (silenciar, volume, mutar...).
        item.addEventListener('click', (e) => abrirPainelAudio(p.identity, nome, ehVoce, e.clientX, e.clientY, transmitindo, item));
        item.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenuContexto(p.identity, nome, ehVoce, e.clientX, e.clientY, transmitindo); });
        lista.appendChild(item);
    });
    renderizarFesta();
    enviarEstadoFlutuante();
}





// ---------- Sons do app ----------
// Sons gerados na hora (sem arquivos) ou um arquivo escolhido pela pessoa (fica no IndexedDB).
// Só os ajustes ficam no localStorage. Nada disso vai para a chamada: só você ouve.
const CHAVE_SONS = 'estrivisor_sons';
let configSons = window.Sons ? window.Sons.validar(null) : null;
let contextoSons = null;
const buffersSons = new Map();     // id -> AudioBuffer do arquivo escolhido
const ultimoSomEm = new Map();     // id -> quando tocou (evita barulho repetido)
const somMensagemSeq = {};         // conversa -> última mensagem que já tocou som

function salvarConfigSons() {
    try { localStorage.setItem(CHAVE_SONS, JSON.stringify(configSons)); } catch (e) { /* vale só nesta sessão */ }
}
function contextoDeSons() {
    if (!contextoSons) {
        contextoSons = new AudioContext();
        // Sai pelo mesmo alto-falante escolhido em Voz e áudio (se o navegador permitir).
        try { if (typeof prefsAudio !== 'undefined' && prefsAudio.saidaId && contextoSons.setSinkId) contextoSons.setSinkId(prefsAudio.saidaId).catch(() => {}); } catch (e) { /* usa o padrão */ }
    }
    if (contextoSons.state === 'suspended') contextoSons.resume().catch(() => {});
    return contextoSons;
}

async function tocarSomApp(id, { forcar = false } = {}) {
    const S = window.Sons;
    if (!S || !configSons) return;
    const ev = S.evento(id);
    if (!ev) return;
    if (!forcar && (!configSons.ativo || !configSons.eventos[id])) return;
    const agora = Date.now();
    if (!forcar && agora - (ultimoSomEm.get(id) || 0) < 350) return; // não toca o mesmo som várias vezes seguidas
    ultimoSomEm.set(id, agora);
    try {
        const ctx = contextoDeSons();
        const saida = ctx.createGain();
        saida.gain.value = (configSons.volume / 100) * 0.8;
        saida.connect(ctx.destination);
        const buffer = buffersSons.get(id);
        if (buffer) {
            const fonte = ctx.createBufferSource();
            fonte.buffer = buffer;
            fonte.connect(saida);
            fonte.start();
            return;
        }
        const t0 = ctx.currentTime + 0.01;
        ev.notas.forEach((nota) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = nota.o;
            osc.frequency.value = nota.f;
            g.gain.setValueAtTime(0.0001, t0 + nota.t);
            g.gain.exponentialRampToValueAtTime(nota.v, t0 + nota.t + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + nota.t + nota.d);
            osc.connect(g).connect(saida);
            osc.start(t0 + nota.t);
            osc.stop(t0 + nota.t + nota.d + 0.02);
        });
    } catch (e) { console.warn('[sons] não consegui tocar:', e.message); }
}

// Mensagem nova numa conversa: toca uma vez por mensagem (a conversa aberta e o aviso de fundo
// podem avisar a mesma mensagem; o mapa evita o som duplicado).
function somDeMensagem(chaveConversa, seq) {
    if (!(seq > (somMensagemSeq[chaveConversa] || 0))) return;
    somMensagemSeq[chaveConversa] = seq;
    tocarSomApp(String(chaveConversa).startsWith('d:') ? 'dm' : 'mensagem');
}

(function ligarSons() {
    const S = window.Sons;
    const lista = document.getElementById('lista-sons');
    if (!S || !lista) return;
    try { configSons = S.validar(JSON.parse(localStorage.getItem(CHAVE_SONS) || 'null')); } catch (e) { configSons = S.validar(null); }

    const atualizarLinha = (id) => {
        const linha = lista.querySelector(`[data-som="${id}"]`);
        if (!linha) return;
        const c = configSons.custom[id];
        linha.querySelector('.info-som').textContent = c ? `Seu arquivo: ${c.nome || 'áudio'}` : 'Som padrão do app';
        linha.querySelector('.btn-restaurar-som').style.display = c ? '' : 'none';
        linha.querySelector('input[type=checkbox]').checked = configSons.eventos[id];
    };

    S.EVENTOS.forEach((ev) => {
        const linha = document.createElement('div');
        linha.className = 'linha-som';
        linha.dataset.som = ev.id;
        const marca = document.createElement('input'); marca.type = 'checkbox'; marca.title = 'Tocar este som';
        marca.style.width = 'auto';
        const texto = document.createElement('div'); texto.className = 'texto-som';
        const nome = document.createElement('div'); nome.className = 'nome-som'; nome.textContent = ev.nome;
        const info = document.createElement('div'); info.className = 'dica-config info-som';
        texto.append(nome, info);
        const botoes = document.createElement('div'); botoes.className = 'botoes-som';
        const testar = document.createElement('button'); testar.type = 'button'; testar.textContent = '▶ Testar';
        const escolher = document.createElement('button'); escolher.type = 'button'; escolher.textContent = 'Trocar';
        const restaurar = document.createElement('button'); restaurar.type = 'button'; restaurar.className = 'btn-restaurar-som'; restaurar.textContent = 'Voltar ao padrão';
        const arquivo = document.createElement('input'); arquivo.type = 'file'; arquivo.accept = 'audio/*'; arquivo.style.display = 'none';
        botoes.append(testar, escolher, restaurar, arquivo);
        linha.append(marca, texto, botoes);
        lista.appendChild(linha);

        marca.addEventListener('change', () => { configSons.eventos[ev.id] = marca.checked; salvarConfigSons(); });
        testar.addEventListener('click', () => tocarSomApp(ev.id, { forcar: true }));
        escolher.addEventListener('click', () => arquivo.click());
        arquivo.addEventListener('change', async () => {
            const f = arquivo.files && arquivo.files[0];
            arquivo.value = '';
            if (!f) return;
            const v = S.validarArquivo(f);
            if (!v.ok) return mostrarNotificacao(v.erro);
            try {
                const buffer = await contextoDeSons().decodeAudioData(await f.arrayBuffer());
                if (buffer.duration > S.MAX_SEGUNDOS) return mostrarNotificacao(`Som longo demais (máximo de ${S.MAX_SEGUNDOS} segundos).`);
                await bancoAreas('readwrite', (loja) => loja.put(f, 'som-' + ev.id));
                buffersSons.set(ev.id, buffer);
                configSons.custom[ev.id] = { tipo: f.type, nome: String(f.name || '').slice(0, 60) };
                salvarConfigSons();
                atualizarLinha(ev.id);
                tocarSomApp(ev.id, { forcar: true });
            } catch (e) {
                mostrarNotificacao('Não consegui abrir esse áudio. Tente um MP3 ou WAV.');
            }
        });
        restaurar.addEventListener('click', async () => {
            try { await bancoAreas('readwrite', (loja) => loja.delete('som-' + ev.id)); } catch (e) { /* já não existia */ }
            buffersSons.delete(ev.id);
            delete configSons.custom[ev.id];
            salvarConfigSons();
            atualizarLinha(ev.id);
        });
        atualizarLinha(ev.id);
    });

    const ativo = document.getElementById('check-sons-ativo');
    const volume = document.getElementById('slider-sons');
    const valor = document.getElementById('valor-sons');
    ativo.checked = configSons.ativo;
    volume.value = configSons.volume; valor.textContent = configSons.volume + '%';
    ativo.addEventListener('change', () => { configSons.ativo = ativo.checked; salvarConfigSons(); });
    volume.addEventListener('input', () => { configSons.volume = Number(volume.value); valor.textContent = volume.value + '%'; });
    volume.addEventListener('change', () => { salvarConfigSons(); tocarSomApp('mensagem', { forcar: true }); });

    // Carrega os arquivos que a pessoa já tinha escolhido.
    (async () => {
        for (const id of Object.keys(configSons.custom)) {
            try {
                const f = await bancoAreas('readonly', (loja) => loja.get('som-' + id));
                if (!f || !S.validarArquivo(f).ok) throw new Error('sumiu');
                buffersSons.set(id, await contextoDeSons().decodeAudioData(await f.arrayBuffer()));
            } catch (e) {
                delete configSons.custom[id]; // o arquivo sumiu: volta ao som padrão
                atualizarLinha(id);
            }
        }
        salvarConfigSons();
    })();
})();

// ---------- Imagens e animações por área ----------
// O arquivo fica guardado (como veio, pra não perder a animação) no IndexedDB deste computador;
// só os ajustes ficam no localStorage. Cada área ganha uma "camada" atrás do conteúdo dela.
const CHAVE_AREAS = 'estrivisor_areas';
let metaAreas = {};               // id -> { escuro, ajuste, tipo, nome }
const urlsAreas = new Map();      // id -> URL do arquivo (blob:)

function abrirBancoAreas() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('estrivisor-imagens', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('areas');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function bancoAreas(modo, fn) {
    const db = await abrirBancoAreas();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('areas', modo);
            const req = fn(tx.objectStore('areas'));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}
function salvarMetaAreas() {
    try { localStorage.setItem(CHAVE_AREAS, JSON.stringify(metaAreas)); } catch (e) { /* vale só nesta sessão */ }
}

function camadaDaArea(area) {
    return area.fixa ? document.getElementById('camada-area-' + area.id) : document.querySelector(area.seletor + ' > .camada-area');
}

function desenharAreaNaTela(area) {
    const A = window.Areas;
    const meta = metaAreas[area.id];
    const url = urlsAreas.get(area.id);
    const alvo = area.fixa ? document.body : document.querySelector(area.seletor);
    if (!alvo) return;
    const antiga = camadaDaArea(area);
    if (antiga) antiga.remove();
    if (!meta || !url) { if (!area.fixa) alvo.classList.remove('alvo-imagem'); atualizarClasseFundoAnim(); return; }

    const camada = document.createElement('div');
    camada.className = 'camada-area' + (area.fixa ? ' fixa' : '');
    if (area.fixa) camada.id = 'camada-area-' + area.id;
    camada.style.setProperty('--escuro', String(meta.escuro / 100));
    camada.style.setProperty('--ajuste-img', meta.ajuste);
    let midia;
    if (A.ehVideo(meta.tipo)) {
        midia = document.createElement('video');
        midia.muted = true; midia.loop = true; midia.autoplay = true; midia.playsInline = true; midia.controls = false;
        midia.disablePictureInPicture = true;
        midia.addEventListener('error', () => { mostrarNotificacao('Não consegui reproduzir esse vídeo. Tente MP4 (H.264) ou WebM.'); removerImagemDaArea(area.id); });
    } else {
        midia = document.createElement('img');
        midia.alt = ''; midia.draggable = false;
        midia.addEventListener('error', () => { mostrarNotificacao('Não consegui abrir essa imagem.'); removerImagemDaArea(area.id); });
    }
    midia.src = url;
    const escura = document.createElement('div');
    escura.className = 'escura';
    camada.appendChild(midia);
    camada.appendChild(escura);
    if (area.fixa) document.body.insertBefore(camada, document.body.firstChild);
    else { alvo.classList.add('alvo-imagem'); alvo.insertBefore(camada, alvo.firstChild); }
    atualizarClasseFundoAnim();
}

function atualizarClasseFundoAnim() {
    document.body.classList.toggle('com-fundo-anim', Boolean(metaAreas.app && urlsAreas.get('app')));
}

function atualizarLinhaArea(area) {
    const linha = document.querySelector(`.linha-area[data-area="${area.id}"]`);
    if (!linha) return;
    const meta = metaAreas[area.id];
    linha.querySelector('.info-area').textContent = meta ? (meta.nome || 'Arquivo escolhido') : 'Nenhuma imagem.';
    linha.querySelector('.btn-remover-area').disabled = !meta;
    linha.querySelector('.opcoes-area').style.display = meta ? 'grid' : 'none';
    if (meta) {
        linha.querySelector('.slider-area').value = meta.escuro;
        linha.querySelector('.valor-escuro').textContent = meta.escuro + '%';
        linha.querySelector('.select-ajuste').value = meta.ajuste;
    }
}

async function escolherImagemDaArea(id, arquivo) {
    const A = window.Areas;
    const area = A.AREAS.find((a) => a.id === id);
    if (!area) return;
    const v = A.validarArquivo(arquivo);
    if (!v.ok) return mostrarNotificacao(v.erro);
    try {
        await bancoAreas('readwrite', (loja) => loja.put(arquivo, id));
    } catch (e) {
        return mostrarNotificacao('Não consegui guardar esse arquivo no app.');
    }
    const antiga = urlsAreas.get(id);
    if (antiga) URL.revokeObjectURL(antiga);
    urlsAreas.set(id, URL.createObjectURL(arquivo));
    const atual = metaAreas[id] ? A.validarAjustes(metaAreas[id]) : A.PADRAO;
    metaAreas[id] = { ...atual, tipo: arquivo.type, nome: String(arquivo.name || '').slice(0, 80) };
    salvarMetaAreas();
    desenharAreaNaTela(area);
    atualizarLinhaArea(area);
}

async function removerImagemDaArea(id) {
    const area = window.Areas.AREAS.find((a) => a.id === id);
    if (!area) return;
    try { await bancoAreas('readwrite', (loja) => loja.delete(id)); } catch (e) { /* já não existia */ }
    const antiga = urlsAreas.get(id);
    if (antiga) URL.revokeObjectURL(antiga);
    urlsAreas.delete(id);
    delete metaAreas[id];
    salvarMetaAreas();
    desenharAreaNaTela(area);
    atualizarLinhaArea(area);
}

// Janela escondida na bandeja: pausa vídeos e esconde as camadas (pra não gastar processador à toa).
document.addEventListener('visibilitychange', () => {
    document.querySelectorAll('.camada-area').forEach((c) => { c.style.display = document.hidden ? 'none' : ''; });
    document.querySelectorAll('.camada-area > video').forEach((v) => { if (document.hidden) v.pause(); else v.play().catch(() => {}); });
});

(async function ligarImagensPorArea() {
    const A = window.Areas;
    const lista = document.getElementById('lista-areas-imagem');
    if (!A || !lista) return;
    A.AREAS.forEach((area) => {
        const linha = document.createElement('div');
        linha.className = 'linha-area';
        linha.dataset.area = area.id;
        const nome = document.createElement('div'); nome.className = 'nome-area'; nome.textContent = area.nome;
        const desc = document.createElement('div'); desc.className = 'dica-config'; desc.textContent = area.desc;
        const botoes = document.createElement('div'); botoes.className = 'botoes-area';
        const escolher = document.createElement('button'); escolher.type = 'button'; escolher.textContent = 'Escolher arquivo';
        const remover = document.createElement('button'); remover.type = 'button'; remover.className = 'btn-remover-area'; remover.textContent = 'Remover'; remover.disabled = true;
        const info = document.createElement('span'); info.className = 'dica-config info-area'; info.textContent = 'Nenhuma imagem.';
        const entrada = document.createElement('input'); entrada.type = 'file'; entrada.style.display = 'none';
        entrada.accept = A.TIPOS.join(',');
        botoes.append(escolher, remover, info, entrada);
        const opcoes = document.createElement('div'); opcoes.className = 'opcoes-area'; opcoes.style.display = 'none';
        const rotEscuro = document.createElement('div'); rotEscuro.className = 'rotulo-config';
        const valor = document.createElement('span'); valor.className = 'valor-escuro'; valor.textContent = '40%';
        rotEscuro.append('Escurecer ', valor);
        const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'slider-area'; slider.min = '0'; slider.max = '90'; slider.step = '5';
        const rotAjuste = document.createElement('div'); rotAjuste.className = 'rotulo-config'; rotAjuste.textContent = 'Encaixe';
        const sel = document.createElement('select'); sel.className = 'select-ajuste';
        [['cover', 'Cobrir a área'], ['contain', 'Mostrar inteira'], ['fill', 'Esticar']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
        opcoes.append(rotEscuro, slider, rotAjuste, sel);
        linha.append(nome, desc, botoes, opcoes);
        lista.appendChild(linha);

        escolher.addEventListener('click', () => entrada.click());
        entrada.addEventListener('change', () => { const f = entrada.files && entrada.files[0]; entrada.value = ''; if (f) escolherImagemDaArea(area.id, f); });
        remover.addEventListener('click', () => removerImagemDaArea(area.id));
        const mudou = () => {
            if (!metaAreas[area.id]) return;
            metaAreas[area.id] = { ...metaAreas[area.id], ...A.validarAjustes({ escuro: Number(slider.value), ajuste: sel.value }) };
            valor.textContent = metaAreas[area.id].escuro + '%';
            const camada = camadaDaArea(area);
            if (camada) { camada.style.setProperty('--escuro', String(metaAreas[area.id].escuro / 100)); camada.style.setProperty('--ajuste-img', metaAreas[area.id].ajuste); }
        };
        slider.addEventListener('input', mudou);
        slider.addEventListener('change', () => { mudou(); salvarMetaAreas(); });
        sel.addEventListener('change', () => { mudou(); salvarMetaAreas(); });
    });

    // Carrega o que já estava guardado.
    let salvo = {};
    try { salvo = A.validarMeta(JSON.parse(localStorage.getItem(CHAVE_AREAS) || '{}')); } catch (e) { salvo = {}; }
    for (const area of A.AREAS) {
        if (!salvo[area.id]) continue;
        try {
            const arquivo = await bancoAreas('readonly', (loja) => loja.get(area.id));
            if (arquivo && arquivo.size > 0 && arquivo.size <= A.MAX_BYTES && A.TIPOS.includes(arquivo.type)) {
                urlsAreas.set(area.id, URL.createObjectURL(arquivo));
                metaAreas[area.id] = { ...salvo[area.id], tipo: arquivo.type };
            }
        } catch (e) { /* arquivo sumiu: a área fica sem imagem */ }
    }
    salvarMetaAreas();
    A.AREAS.forEach((area) => { desenharAreaNaTela(area); atualizarLinhaArea(area); });
})();

// ---------- Cores e estilo ----------
// Tudo vira variável CSS (valores validados em estilo.js). Fica salvo só neste computador.
const CHAVE_ESTILO = 'estrivisor_estilo';
let estilo = window.Estilo ? window.Estilo.estadoPadrao() : null;

function aplicarEstilo() {
    if (!estilo || !window.Estilo) return;
    const raiz = document.documentElement;
    const vars = window.Estilo.variaveis(estilo);
    Object.keys(vars).forEach((k) => raiz.style.setProperty(k, vars[k]));
    document.body.style.fontFamily = window.Estilo.FONTES[estilo.fonte].css;
    document.body.classList.toggle('raio-custom', estilo.raio !== window.Estilo.LIMITES.raio[2]);
    document.body.classList.toggle('avatar-custom', estilo.avatar !== 'circulo');
    if (window.electronAPI && window.electronAPI.definirZoom) window.electronAPI.definirZoom(estilo.zoom / 100);
    // Controles da tela
    const def = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    ['sinal', 'bg', 'painel', 'texto'].forEach((k) => def('cor-' + k, estilo.cores[k]));
    def('select-fonte', estilo.fonte); def('select-avatar', estilo.avatar);
    def('slider-zoom', estilo.zoom); txt('valor-zoom', estilo.zoom + '%');
    def('slider-raio', estilo.raio); txt('valor-raio', estilo.raio + ' px');
    document.querySelectorAll('#lista-temas .chip-tema').forEach((c) => c.classList.toggle('ativo', c.dataset.tema === estilo.tema));
}
function salvarEstilo() {
    try { localStorage.setItem(CHAVE_ESTILO, JSON.stringify(estilo)); } catch (e) { /* vale só nesta sessão */ }
}

(function ligarEstilo() {
    const E = window.Estilo;
    if (!E) return;
    try { estilo = E.validar(JSON.parse(localStorage.getItem(CHAVE_ESTILO) || 'null')); } catch (e) { estilo = E.estadoPadrao(); }

    const lista = document.getElementById('lista-temas');
    if (lista) {
        Object.keys(E.TEMAS).forEach((id) => {
            const t = E.TEMAS[id];
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'chip-tema'; b.dataset.tema = id;
            const amostra = document.createElement('span');
            amostra.className = 'amostra';
            [t.cores.bg, t.cores.painel, t.cores.sinal].forEach((c) => { const i = document.createElement('i'); i.style.backgroundColor = c; amostra.appendChild(i); });
            b.appendChild(amostra);
            b.appendChild(document.createTextNode(t.nome));
            b.addEventListener('click', () => { estilo.tema = id; estilo.cores = { ...t.cores }; aplicarEstilo(); salvarEstilo(); });
            lista.appendChild(b);
        });
        const p = document.createElement('button');
        p.type = 'button'; p.className = 'chip-tema'; p.dataset.tema = 'personalizado'; p.textContent = 'Personalizado'; p.disabled = true;
        lista.appendChild(p);
    }
    const selFonte = document.getElementById('select-fonte');
    if (selFonte) Object.keys(E.FONTES).forEach((id) => {
        const o = document.createElement('option'); o.value = id; o.textContent = E.FONTES[id].nome; selFonte.appendChild(o);
    });

    ['sinal', 'bg', 'painel', 'texto'].forEach((k) => {
        const el = document.getElementById('cor-' + k);
        if (!el) return;
        el.addEventListener('input', () => {
            const base = {};
            E.CHAVES_BASE.forEach((c) => { base[c] = estilo.cores[c]; });
            base[k] = el.value;
            estilo.cores = E.derivar(base);
            estilo.tema = 'personalizado';
            aplicarEstilo();
        });
        el.addEventListener('change', salvarEstilo);
    });
    const ligar = (id, evento, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evento, fn); };
    ligar('select-fonte', 'change', (e) => { estilo.fonte = e.target.value; aplicarEstilo(); salvarEstilo(); });
    ligar('select-avatar', 'change', (e) => { estilo.avatar = e.target.value; aplicarEstilo(); salvarEstilo(); });
    ligar('slider-raio', 'input', (e) => { estilo.raio = Number(e.target.value); aplicarEstilo(); });
    ligar('slider-raio', 'change', salvarEstilo);
    // O zoom só é aplicado ao soltar o controle (mexer na tela enquanto se arrasta o controle faria ele fugir).
    ligar('slider-zoom', 'input', (e) => { const v = document.getElementById('valor-zoom'); if (v) v.textContent = e.target.value + '%'; });
    ligar('slider-zoom', 'change', (e) => { estilo.zoom = Number(e.target.value); aplicarEstilo(); salvarEstilo(); });
    ligar('btn-restaurar-estilo', 'click', () => { estilo = E.estadoPadrao(); aplicarEstilo(); salvarEstilo(); mostrarNotificacao('Aparência restaurada ao padrão.', 'info'); });
    // Valores vindos do armazenamento passam por validar(), então o raio/zoom já são válidos.
    estilo = E.validar(estilo);
    aplicarEstilo();
})();

// ---------- Layouts ----------
// O layout é só uma classe no <body> (layout-xxx) mais um pouco de CSS: nada muda no que o app
// faz. Fica salvo neste computador; qualquer valor desconhecido volta pro "Clássico".
const LAYOUTS = [
    { id: 'classico', nome: 'Clássico', desc: 'Como sempre foi: servidores, canais, conteúdo e membros.' },
    { id: 'espelhado', nome: 'Espelhado', desc: 'Todas as barras ficam à direita e o conteúdo à esquerda.' },
    { id: 'compacto', nome: 'Compacto', desc: 'Barras só com ícones (nome ao passar o mouse) e chat largo.' },
    { id: 'cinema', nome: 'Cinema', desc: 'Barras mínimas, transmissão grande e o chat ao lado dela.' },
    { id: 'duas', nome: 'Duas telas', desc: 'Assiste duas transmissões lado a lado, metade da tela cada.' },
    { id: 'festa', nome: 'Festa de voz', desc: 'Rostos grandes de quem está na sala; quem fala acende.' },
];
const CHAVE_LAYOUT = 'estrivisor_layout';

// Desenho pequeno de cada layout (só decoração do cartão).
function miniaturaLayout(id) {
    const f = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${c}"/>`;
    const B = '#23272c', C = '#3a4048', V = '#05070a';
    let g = '';
    if (id === 'classico') g = f(2, 2, 6, 56, B) + f(10, 2, 16, 56, B) + f(28, 2, 42, 56, C) + f(72, 2, 22, 56, B);
    else if (id === 'espelhado') g = f(2, 2, 42, 56, C) + f(46, 2, 22, 56, B) + f(70, 2, 16, 56, B) + f(88, 2, 6, 56, B);
    else if (id === 'compacto') g = f(2, 2, 5, 56, B) + f(9, 2, 6, 56, B) + f(17, 2, 53, 56, C) + f(72, 2, 22, 56, B);
    else if (id === 'cinema') g = f(2, 2, 5, 56, B) + f(9, 2, 6, 56, B) + f(17, 2, 56, 40, V) + f(17, 44, 56, 14, B) + f(75, 2, 19, 56, B);
    else if (id === 'duas') g = f(2, 2, 4, 56, B) + f(8, 2, 6, 56, B) + f(16, 2, 36, 40, V) + f(54, 2, 16, 40, V) + f(72, 2, 22, 56, B) + f(16, 44, 54, 14, C);
    else if (id === 'festa') g = f(2, 2, 6, 56, B) + f(10, 2, 16, 56, B) + '<circle cx="38" cy="22" r="7" fill="#2f6fed"/><circle cx="52" cy="22" r="7" fill="#ffb020"/><circle cx="45" cy="38" r="7" fill="#7a4fd0"/>' + f(72, 2, 22, 56, B);
    return `<svg viewBox="0 0 96 60" aria-hidden="true">${g}</svg>`;
}

function aplicarLayout(id) {
    if (!LAYOUTS.some((l) => l.id === id)) id = 'classico';
    LAYOUTS.forEach((l) => document.body.classList.remove('layout-' + l.id));
    document.body.classList.add('layout-' + id);
    // Entrando no Cinema com voz e um chat abertos: mostra os dois. Saindo: volta a mostrar só a voz.
    const areaTexto = document.getElementById('area-texto');
    const areaVoz = document.getElementById('area-voz');
    if (id === 'cinema' && areaVoz.style.display === 'flex' && canalTextoAtual) areaTexto.style.display = 'flex';
    if (id !== 'cinema' && areaVoz.style.display === 'flex' && areaTexto.style.display === 'flex') areaTexto.style.display = 'none';
    atualizarCinemaDuplo();
    document.querySelectorAll('#lista-layouts .cartao-layout[data-layout]').forEach((c) => c.classList.toggle('ativo', c.dataset.layout === id));
    try { localStorage.setItem(CHAVE_LAYOUT, id); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
    renderizarFesta();
}

// "Festa de voz": rostos grandes de quem está na sala (só desenha quando esse layout está ativo).
function renderizarFesta() {
    const alvo = document.getElementById('festa-voz');
    if (!alvo) return;
    alvo.textContent = '';
    if (!document.body.classList.contains('layout-festa') || !vozConectada()) return;
    const todos = [roomVoz.localParticipant, ...roomVoz.remoteParticipants.values()];
    todos.forEach((p) => {
        const ehVoce = p === roomVoz.localParticipant;
        const nome = (p.name || p.identity || '?') + (ehVoce ? ' (você)' : '');
        const mic = ehVoce ? microfoneAtivo : p.isMicrophoneEnabled === true;
        const caixa = document.createElement('div');
        caixa.className = 'festa-pessoa' + (identidadesFalando.has(p.identity) ? ' falando' : '') + (mic ? '' : ' mudo');
        const av = document.createElement('span');
        av.className = 'avatar-participante';
        aplicarAvatar(av, p.identity, p.name || p.identity, avatarDoParticipante(p, ehVoce ? avatarUsuarioAtual : null));
        const n = document.createElement('span');
        n.className = 'nome-festa';
        n.textContent = nome;
        caixa.appendChild(av);
        caixa.appendChild(n);
        alvo.appendChild(caixa);
    });
}

(function ligarLayouts() {
    const lista = document.getElementById('lista-layouts');
    if (lista) {
        LAYOUTS.forEach((l) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cartao-layout';
            b.dataset.layout = l.id;
            b.innerHTML = miniaturaLayout(l.id); // desenho fixo do próprio app (sem dados de fora)
            const n = document.createElement('span');
            n.className = 'nome-layout';
            n.textContent = l.nome;
            const d = document.createElement('span');
            d.className = 'desc-layout';
            d.textContent = l.desc;
            b.appendChild(n);
            b.appendChild(d);
            b.addEventListener('click', () => aplicarLayout(l.id));
            lista.appendChild(b);
        });
        // Atalho pra janela flutuante: ela combina com qualquer layout.
        const fl = document.createElement('button');
        fl.type = 'button';
        fl.id = 'cartao-layout-flutuante';
        fl.className = 'cartao-layout largo';
        const n = document.createElement('span');
        n.className = 'nome-layout';
        n.textContent = 'Janela flutuante (sobre o jogo)';
        const d = document.createElement('span');
        d.className = 'desc-layout';
        d.textContent = 'Liga/desliga o cartão da sala de voz por cima do jogo. Combina com qualquer layout; os ajustes estão no menu abaixo.';
        fl.appendChild(n);
        fl.appendChild(d);
        fl.addEventListener('click', () => {
            const caixa = document.getElementById('check-janela-flutuante');
            if (caixa) caixa.click();
        });
        lista.appendChild(fl);
    }
    let salvo = 'classico';
    try { salvo = localStorage.getItem(CHAVE_LAYOUT) || 'classico'; } catch (e) { /* usa o clássico */ }
    aplicarLayout(salvo);
})();

// ---------- Janela flutuante (sala de voz por cima do jogo) ----------
// Manda o estado da sala pro processo principal só quando muda de verdade. Ele limpa
// e confere tudo antes de mostrar na janela flutuante.
let ultimoEstadoFlutuante = '';
let mensagemFlutuante = null; // última mensagem nova do chat (só aparece se a pessoa ligar)
let avisoFlutuante = null;    // { id, texto } de quem entrou/saiu; some sozinho em 5 s
let contadorAviso = 0, timerAvisoFlutuante = null;
function registrarMensagemFlutuante(m) {
    mensagemFlutuante = { autor: String(m.nome || '?').slice(0, 30), texto: String(m.texto || (m.imagem ? '🖼️ imagem' : '')).slice(0, 90) };
    enviarEstadoFlutuante();
}
let entradaNaVozEm = 0;
function avisarFlutuante(texto) {
    if (Date.now() - entradaNaVozEm < 3000) return; // quem já estava na sala não conta como "entrou"
    avisoFlutuante = { id: ++contadorAviso, texto: String(texto).slice(0, 60) };
    clearTimeout(timerAvisoFlutuante);
    timerAvisoFlutuante = setTimeout(() => { avisoFlutuante = null; enviarEstadoFlutuante(); }, 5000);
    enviarEstadoFlutuante();
}
function enviarEstadoFlutuante() {
    if (!window.electronAPI || !window.electronAPI.flutuanteEstado) return;
    let estado = { naVoz: false };
    if (vozConectada() && canalVozAtual) {
        const todos = [roomVoz.localParticipant, ...roomVoz.remoteParticipants.values()];
        estado = {
            naVoz: true,
            canal: canalVozAtual.nome,
            total: todos.length,
            microfone: microfoneAtivo,
            surdo: surdoAtivo,
            mensagem: mensagemFlutuante,
            aviso: avisoFlutuante,
            participantes: todos.slice(0, 12).map((p) => {
                const ehVoce = p === roomVoz.localParticipant;
                return {
                    id: p.identity,
                    nome: (p.name || p.identity || '?') + (ehVoce ? ' (você)' : ''),
                    avatar: avatarDoParticipante(p, ehVoce ? avatarUsuarioAtual : null) || '',
                    falando: identidadesFalando.has(p.identity),
                    mic: ehVoce ? microfoneAtivo : p.isMicrophoneEnabled === true,
                    voce: ehVoce,
                    transmitindo: [...p.videoTrackPublications.values()].some((pub) => pub.source === LivekitClient.Track.Source.ScreenShare),
                };
            }),
        };
    }
    const chave = JSON.stringify(estado);
    if (chave === ultimoEstadoFlutuante) return;
    ultimoEstadoFlutuante = chave;
    window.electronAPI.flutuanteEstado(estado).catch(() => { ultimoEstadoFlutuante = ''; });
}

(function ligarJanelaFlutuante() {
    const api = window.electronAPI;
    if (!api || !api.flutuanteLer) return;
    const caixa = document.getElementById('check-janela-flutuante');
    const caixaAtalho = document.getElementById('check-flutuante-atalho');
    const aviso = document.getElementById('aviso-flutuante-atalho');
    const caixaClique = document.getElementById('check-flutuante-clique');
    const caixaChat = document.getElementById('check-flutuante-chat');
    const caixaAvisos = document.getElementById('check-flutuante-avisos');
    const slider = document.getElementById('slider-flutuante-opacidade');
    const valor = document.getElementById('valor-flutuante-opacidade');

    function mostrar(o) {
        if (!o) return;
        if (caixa) caixa.checked = Boolean(o.ativa);
        if (caixaAtalho) caixaAtalho.checked = Boolean(o.atalho);
        if (caixaClique) caixaClique.checked = Boolean(o.clique);
        if (caixaChat) caixaChat.checked = Boolean(o.chat);
        if (caixaAvisos) caixaAvisos.checked = Boolean(o.avisos);
        if (slider) slider.value = String(o.opacidade);
        if (valor) valor.textContent = o.opacidade + '%';
        // Só avisa se o atalho está ligado, a janela também, e mesmo assim não foi reservado.
        const cartao = document.getElementById('cartao-layout-flutuante');
        if (cartao) cartao.classList.toggle('ativo', Boolean(o.ativa));
        if (aviso) aviso.style.display = (o.ativa && o.atalho && !o.atalhoFunciona) ? 'block' : 'none';
    }
    function mudar(opcoes) {
        return api.flutuanteDefinir(opcoes).then((o) => {
            mostrar(o);
            ultimoEstadoFlutuante = ''; // garante que a janela receba o estado atual
            enviarEstadoFlutuante();
        }).catch(() => api.flutuanteLer().then(mostrar).catch(() => {}));
    }

    api.flutuanteLer().then(mostrar).catch(() => {});
    if (caixa) caixa.addEventListener('change', () => mudar({ ativa: caixa.checked }));
    if (caixaAtalho) caixaAtalho.addEventListener('change', () => mudar({ atalho: caixaAtalho.checked }));
    if (caixaClique) caixaClique.addEventListener('change', () => mudar({ clique: caixaClique.checked }));
    if (caixaChat) caixaChat.addEventListener('change', () => mudar({ chat: caixaChat.checked }));
    if (caixaAvisos) caixaAvisos.addEventListener('change', () => mudar({ avisos: caixaAvisos.checked }));
    if (slider) {
        slider.addEventListener('input', () => { if (valor) valor.textContent = slider.value + '%'; });
        slider.addEventListener('change', () => mudar({ opacidade: Number(slider.value) }));
    }
    // A pessoa clicou no × da própria janela flutuante.
    api.aoFlutuanteMudou(() => { api.flutuanteLer().then(mostrar).catch(() => {}); });
    // Botões da janela flutuante: fazem o mesmo que os botões do rodapé.
    api.aoComandoFlutuante((comando) => {
        if (comando === 'mic') document.getElementById('btn-microfone-rodape').click();
        else if (comando === 'surdo') document.getElementById('btn-surdo-rodape').click();
        else if (comando === 'sair') document.getElementById('btn-sair-voz').click();
    });
})();

function atualizarSubMembrosVoz() {
    servidorAtual.canais.filter((c) => c.tipo === 'voz').forEach((canal) => {
        const sub = document.getElementById('sub-membros-' + canal.id);
        if (!sub) return;
        sub.innerHTML = '';

        // Canal em que você está: lista ao vivo (quem fala, menu de áudio...).
        if (vozConectada() && canalVozAtual && canalVozAtual.id === canal.id) {
            const participantes = [roomVoz.localParticipant, ...roomVoz.remoteParticipants.values()];
            participantes.forEach(p => {
                const nome = p.name || p.identity || '?';
                const falando = identidadesFalando.has(p.identity);
                const div = document.createElement('div');
                div.className = 'sub-membro-voz' + (falando ? ' falando' : '');
                div.dataset.identidade = p.identity;
                div.innerHTML = `<span class="mini-avatar"></span><span>${escaparHtml(nome)}</span>`;
                aplicarAvatar(div.querySelector('.mini-avatar'), p.identity, nome, avatarDoParticipante(p, p === roomVoz.localParticipant ? avatarUsuarioAtual : null));
                // Botão direito no nome (embaixo do canal, na lateral) abre o mesmo menu.
                const ehVoce = p === roomVoz.localParticipant;
                div.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    abrirMenuContexto(p.identity, nome, ehVoce, e.clientX, e.clientY, [...p.videoTrackPublications.values()].some(pub => pub.source === LivekitClient.Track.Source.ScreenShare));
                });
                sub.appendChild(div);
            });
            return;
        }

        // Outros canais de voz: quem está lá (vem da presença, atualizada a cada poucos segundos).
        presencaParticipantes.forEach((info, identity) => {
            if (info.canalVoz !== canal.id) return;
            const div = document.createElement('div');
            div.className = 'sub-membro-voz';
            div.innerHTML = `<span class="mini-avatar"></span><span>${escaparHtml(info.nome)}</span>`;
            aplicarAvatar(div.querySelector('.mini-avatar'), identity, info.nome, info.avatar);
            sub.appendChild(div);
        });
    });
}

// ============================================================
// Perfil, conquistas e resumo. Os números são medidos pelo SERVIDOR (tempo em chamada, mensagens...);
// o app só pede e desenha. Opções (Configurações > Privacidade > Perfil e estatísticas): perfil privado e registrar jogos.
// ============================================================
const CHAVE_PERFIL_PRIVADO = 'estrivisor_perfil_privado';
const CHAVE_REGISTRAR_JOGOS = 'estrivisor_registrar_jogos';
const lerFlag = (chave) => { try { return localStorage.getItem(chave) === '1'; } catch (e) { return false; } };
const gravarFlag = (chave, v) => { try { localStorage.setItem(chave, v ? '1' : '0'); } catch (e) { /* vale só até fechar o app */ } };
let perfilPrivado = lerFlag(CHAVE_PERFIL_PRIVADO);
let registrarJogos = lerFlag(CHAVE_REGISTRAR_JOGOS);
document.getElementById('check-perfil-privado').checked = perfilPrivado;
document.getElementById('check-registrar-jogos').checked = registrarJogos;
document.getElementById('check-perfil-privado').addEventListener('change', (e) => { perfilPrivado = e.target.checked; gravarFlag(CHAVE_PERFIL_PRIVADO, perfilPrivado); fazerPing(); });
document.getElementById('check-registrar-jogos').addEventListener('change', (e) => { registrarJogos = e.target.checked; gravarFlag(CHAVE_REGISTRAR_JOGOS, registrarJogos); });

// O que vai junto com o aviso de presença (o servidor só confere se faz sentido).
function dadosDePerfilParaPing() {
    const tela = transmitindoAgora && vozConectada();
    let jogo;
    if (tela && registrarJogos && fonteTransmitida && !/^screen:/.test(fonteTransmitida.id)) jogo = limparTituloJanela(fonteTransmitida.nome) || undefined;
    return { transmitindo: tela, jogo, perfilPrivado };
}

function elemento(tag, classe, conteudo) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (conteudo !== undefined) el.textContent = conteudo;
    return el;
}
function desenharPerfil(d) {
    const P = window.Perfil;
    document.getElementById('perfil-nome').textContent = d.perfil.nome;
    document.getElementById('perfil-desde').textContent = 'No Estrivisor desde ' + new Date(d.perfil.desde).toLocaleDateString('pt-BR') + (d.perfil.meu && d.perfil.privado ? ' · perfil privado' : '');
    aplicarAvatar(document.getElementById('perfil-avatar'), d.perfil.usuario, d.perfil.nome, urlAvatarSegura(d.perfil.avatar));
    document.getElementById('perfil-resumo').style.display = d.perfil.meu ? '' : 'none';
    document.getElementById('perfil-status').style.display = d.perfil.meu ? '' : 'none';
    const corpo = document.getElementById('perfil-corpo');
    corpo.innerHTML = '';
    const n = d.numeros;
    const grade = elemento('div', 'perfil-grade');
    [['🎙️ Em chamada', P.formatarDuracao(n.voz)], ['📺 Transmitindo', P.formatarDuracao(n.tela)], ['💬 Mensagens', String(n.msgs)],
        ['😂 Reações dadas', String(n.reacoes)], ['🏃 Maior chamada', P.formatarDuracao(n.maiorSessao)], ['🔥 Dias seguidos', `${n.sequenciaAtual} (recorde ${n.maiorSequencia})`]].forEach(([rotulo, valor]) => {
        const c = elemento('div', 'perfil-num'); c.appendChild(elemento('b', '', valor)); c.appendChild(elemento('span', '', rotulo)); grade.appendChild(c);
    });
    corpo.appendChild(grade);
    const lista = (titulo, itens, vazio) => {
        corpo.appendChild(elemento('div', 'perfil-sec', titulo));
        if (!itens.length) { corpo.appendChild(elemento('div', 'perfil-vazio', vazio)); return; }
        itens.forEach((i) => { const l = elemento('div', 'perfil-linha'); l.appendChild(elemento('span', '', i.nome)); l.appendChild(elemento('span', 'perfil-vazio', P.formatarDuracao(i.s))); corpo.appendChild(l); });
    };
    lista('MAIS TEMPO EM CHAMADA COM', d.topParceiros, 'Ainda sem dados.');
    lista('JOGOS MAIS TRANSMITIDOS', d.topJogos, d.perfil.meu ? 'Nada ainda. Para registrar, ligue em Configurações > Privacidade > Perfil e estatísticas.' : 'Nada registrado.');
    const ganhas = d.conquistas.filter((c) => c.ganha).length;
    corpo.appendChild(elemento('div', 'perfil-sec', `CONQUISTAS — ${ganhas} de ${d.conquistas.length}`));
    const gc = elemento('div', 'conquistas-grade');
    d.conquistas.slice().sort((a, b) => Number(b.ganha) - Number(a.ganha)).forEach((c) => {
        const el = elemento('div', 'conquista' + (c.ganha ? ' ganha' : ''));
        el.appendChild(elemento('span', 'ic', c.icone));
        const txt = elemento('div');
        txt.appendChild(elemento('b', '', c.titulo));
        txt.appendChild(elemento('div', 'ds', c.desc));
        if (!c.ganha) {
            const fmt = (v) => (c.unidade === 'tempo' ? P.formatarDuracao(v) : String(v));
            txt.appendChild(elemento('div', 'ds', `${fmt(c.valor)} de ${fmt(c.meta)}`));
            const barra = elemento('div', 'barra'); const i = document.createElement('i'); i.style.width = Math.min(100, Math.round(c.valor / c.meta * 100)) + '%'; barra.appendChild(i); txt.appendChild(barra);
        }
        el.appendChild(txt); gc.appendChild(el);
    });
    corpo.appendChild(gc);
}
let perfilEmAbertura = 0;
async function abrirPerfil(usuario) {
    const meu = ++perfilEmAbertura;
    try {
        const d = window.Perfil.validarPerfil(await api('GET', `/perfil/${encodeURIComponent(usuario)}`));
        if (meu !== perfilEmAbertura) return;
        if (!d) throw new Error('Resposta inesperada do servidor.');
        desenharPerfil(d);
        document.getElementById('tela-perfil').style.display = 'flex';
        document.getElementById('perfil-fechar').focus();
    } catch (err) { mostrarNotificacao(err.status === 403 ? 'Esta pessoa deixou o perfil privado.' : 'Não consegui abrir o perfil: ' + err.message); }
}
function fecharPerfil() { perfilEmAbertura++; document.getElementById('tela-perfil').style.display = 'none'; }
document.getElementById('perfil-fechar').addEventListener('click', fecharPerfil);
document.getElementById('tela-perfil').addEventListener('click', (e) => { if (e.target.id === 'tela-perfil') fecharPerfil(); });
document.getElementById('tela-perfil').addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharPerfil(); });
// Clicar em você (foto ou nome, no rodapé): menu com o seu status e o seu perfil.
function abrirMenuMeuPerfil(ancora) {
    const r = ancora.getBoundingClientRect();
    abrirMenu(r.left, r.top, () => {
        const itens = [];
        itens.push({ id: 'status', rotulo: statusPersonalizado ? '✏️ Mudar o status' : '🙂 Definir um status', dica: 'Uma frase curta embaixo do seu nome. Ex.: "🎮 jogando Wardogs"', acao: () => editarStatusPersonalizado() });
        if (statusPersonalizado) itens.push({ id: 'tirar-status', rotulo: '🗑️ Tirar o status', acao: () => definirStatusPersonalizado('') });
        itens.push({ separador: true });
        itens.push({ id: 'perfil', rotulo: '👤 Ver o meu perfil', acao: () => abrirPerfil(obterIdentidadeUsuario()) });
        itens.push({ id: 'config', rotulo: '⚙️ Configurações', acao: () => abrirConfig() });
        return { cabecalho: (nomeUsuarioAtual || 'Você') + (statusPersonalizado ? ' · ' + statusPersonalizado : ' · sem status'), itens };
    });
}
document.getElementById('avatar-usuario-exibido').style.cursor = 'pointer';
document.getElementById('avatar-usuario-exibido').title = 'Seu perfil e seu status';
document.getElementById('avatar-usuario-exibido').addEventListener('click', (e) => { e.stopPropagation(); abrirMenuMeuPerfil(e.currentTarget); });
document.getElementById('info-usuario-rodape').addEventListener('click', (e) => { e.stopPropagation(); abrirMenuMeuPerfil(document.getElementById('avatar-usuario-exibido')); });
document.getElementById('info-usuario-rodape').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirMenuMeuPerfil(document.getElementById('avatar-usuario-exibido')); } });
document.getElementById('perfil-status').addEventListener('click', () => { fecharPerfil(); editarStatusPersonalizado(); });

let resumoEmAbertura = 0;
async function mostrarResumo(periodo, nome) {
    const meu = ++resumoEmAbertura;
    const corpo = document.getElementById('resumo-corpo');
    corpo.innerHTML = '';
    corpo.appendChild(elemento('div', 'perfil-vazio', 'Carregando...'));
    try {
        const r = window.Perfil.validarResumo(await api('GET', `/perfil/${encodeURIComponent(obterIdentidadeUsuario())}/resumo?periodo=${periodo}`));
        if (meu !== resumoEmAbertura) return;
        if (!r) throw new Error('Resposta inesperada do servidor.');
        corpo.innerHTML = '';
        corpo.appendChild(elemento('div', 'resumo-quando', `Seu resumo de ${nome}`));
        const m = window.Perfil.manchetes(r);
        if (!m.length) corpo.appendChild(elemento('div', 'perfil-vazio', 'Nada por aqui ainda. Entre numa chamada ou mande uma mensagem!'));
        m.forEach((x) => {
            const c = elemento('div', 'manchete');
            c.appendChild(elemento('span', 'ic', x.icone));
            const t = elemento('div'); t.appendChild(elemento('b', '', x.titulo)); t.appendChild(elemento('span', '', x.texto)); c.appendChild(t);
            corpo.appendChild(c);
        });
        if (!r.dadosCompletos && m.length) corpo.appendChild(elemento('div', 'perfil-vazio', 'As estatísticas começaram a ser contadas depois do início deste período, então o resumo pode estar incompleto.'));
    } catch (err) {
        if (meu !== resumoEmAbertura) return;
        corpo.innerHTML = '';
        corpo.appendChild(elemento('div', 'perfil-vazio', 'Não consegui carregar o resumo: ' + err.message));
    }
}
function abrirResumo() {
    const abas = document.getElementById('resumo-abas');
    abas.innerHTML = '';
    const lista = window.Perfil.periodos();
    const escolher = (p, botao) => { abas.querySelectorAll('button').forEach((b) => b.classList.remove('ativa')); botao.classList.add('ativa'); mostrarResumo(p.id, p.nome); };
    lista.forEach((p, i) => {
        const b = elemento('button', '', p.rotulo); b.type = 'button';
        b.addEventListener('click', () => escolher(p, b));
        abas.appendChild(b);
        if (i === 0) escolher(p, b);
    });
    document.getElementById('tela-resumo').style.display = 'flex';
    document.getElementById('resumo-fechar').focus();
}
function fecharResumo() { resumoEmAbertura++; document.getElementById('tela-resumo').style.display = 'none'; }
document.getElementById('perfil-resumo').addEventListener('click', abrirResumo);
document.getElementById('resumo-fechar').addEventListener('click', fecharResumo);
document.getElementById('tela-resumo').addEventListener('click', (e) => { if (e.target.id === 'tela-resumo') fecharResumo(); });
document.getElementById('tela-resumo').addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharResumo(); });

// ============================================================
// Status personalizado: uma frase curta que aparece embaixo do seu nome pra todo mundo do servidor.
// Fica salvo neste computador e vai junto com o aviso de presença (a cada ~10 s).
// ============================================================
const CHAVE_STATUS = 'estrivisor_status_personalizado';
let statusPersonalizado = '';
try { statusPersonalizado = window.Social.limparStatus(localStorage.getItem(CHAVE_STATUS) || ''); } catch (e) { statusPersonalizado = ''; }
function mostrarStatusPersonalizado() {
    const el = document.getElementById('status-personalizado-rodape');
    el.textContent = statusPersonalizado;
    el.title = statusPersonalizado ? statusPersonalizado + ' (clique no seu nome para mudar)' : '';
}
async function editarStatusPersonalizado() {
    const r = await pedirTexto({
        titulo: 'Seu status', dica: 'Aparece embaixo do seu nome pra quem está no servidor. Ex.: "🎮 jogando Wardogs"',
        valor: statusPersonalizado, max: window.Social.MAX_STATUS, rotuloCheckbox: 'Remover o meu status', rotuloOk: 'Salvar'
    });
    if (!r) return;
    definirStatusPersonalizado(r.marcado ? '' : r.texto);
}
function definirStatusPersonalizado(texto) {
    statusPersonalizado = texto ? window.Social.limparStatus(texto) : '';
    try { localStorage.setItem(CHAVE_STATUS, statusPersonalizado); } catch (e) { /* sem armazenamento: vale só até fechar o app */ }
    mostrarStatusPersonalizado();
    fazerPing(); // aparece pros outros na hora, sem esperar o próximo aviso
}
mostrarStatusPersonalizado();

// ============================================================
// Presença online: a cada ~10s o app avisa o servidor que está aberto (e em qual canal de voz).
// Quem fica 1 minuto sem avisar some da lista. Não usa uma sala do LiveKit (que gastaria
// minutos o dia todo). A resposta também diz se o servidor mudou (canal novo, nome, expulsão...).
// ============================================================
const presencaParticipantes = new Map(); // identity -> { nome, canalVoz, avatar }
let temporizadorPing = null;
let pingEmAndamento = false;
let pingPendente = false;

function aplicarOnline(lista) {
    presencaParticipantes.clear();
    (Array.isArray(lista) ? lista : []).forEach((p) => {
        presencaParticipantes.set(String(p.usuario), {
            nome: String(p.nome || p.usuario).slice(0, 40),
            canalVoz: typeof p.canalVoz === 'string' ? p.canalVoz : null,
            status: window.Social.limparStatus(p.status),
            conta: typeof p.conta === 'string' ? p.conta.slice(0, 40) : '',
            avatar: urlAvatarSegura(p.avatar)
        });
    });
    atualizarListaOnline();
}

async function fazerPing() {
    if (!servidorAtual.id || !nomeUsuarioAtual) return;
    if (pingEmAndamento) { pingPendente = true; return; }
    pingEmAndamento = true;
    const id = servidorAtual.id;
    try {
        const d = await api('POST', `/servidores/${id}/presenca`, {
            nome: nomeUsuarioAtual,
            avatar: avatarUsuarioAtual || undefined,
            status: statusPersonalizado || undefined,
            ...dadosDePerfilParaPing(),
            // Só diz que está no canal depois de conectar de verdade (não durante a espera ou após uma falha).
            canalVoz: vozConectada() && canalVozAtual ? canalVozAtual.id : null
        });
        registrarUltimasServidor(id, d.ultimas);
        if (id !== servidorAtual.id) return; // trocou de servidor no meio
        aplicarOnline(d.online);
        if (d.versao !== servidorAtual.versao) await recarregarServidorAtual();
    } catch (err) {
        if (err.status === 403 || err.status === 404) await perdeuAcesso(id);
        // Outros erros (sem internet, servidor fora do ar): tenta de novo no próximo ping.
    } finally {
        pingEmAndamento = false;
        if (pingPendente) { pingPendente = false; fazerPing(); }
    }
    pingarOutrosServidores();
}

// Mantém você online em TODOS os servidores dos quais participa (não só no que está aberto).
function pingarOutrosServidores() {
    (meusServidores || []).forEach((s) => {
        if (!s || !s.id || s.id === servidorAtual.id) return;
        api('POST', `/servidores/${s.id}/presenca`, {
            nome: nomeUsuarioAtual,
            avatar: avatarUsuarioAtual || undefined,
            status: statusPersonalizado || undefined,
            ...dadosDePerfilParaPing(),
            canalVoz: vozConectada() && canalVozAtual ? canalVozAtual.id : null
        }).then((d) => registrarUltimasServidor(s.id, d && d.ultimas)).catch(() => {});
    });
}

// Medalhas de cada membro, mostradas embaixo do nome nas listas da direita (o servidor guarda 1 min em cache).
let conquistasMembros = new Map(); // usuario -> [{ icone, titulo }]
let cargosMembros = new Map();     // usuario -> ['fundador' | 'moderador']
// Selos de cargo, do mais alto pro mais baixo. O dono do servidor vem da lista de membros do próprio servidor.
const CARGOS = {
    fundador: { texto: '🔱 Fundador', dica: 'Fundador do Estrivisor: quem criou e administra o app.', classe: 'fundador' },
    moderador: { texto: '🛡️ Moderador', dica: 'Moderador do Estrivisor: cuida dos pedidos de acesso e das denúncias.', classe: 'moderador' },
    dono: { texto: '👑 Dono', dica: 'Dono deste servidor.', classe: 'dono' },
};
function cargosDe(usuario) {
    const lista = (cargosMembros.get(String(usuario)) || []).filter((c) => CARGOS[c] && c !== 'dono');
    if (servidorAtual && servidorAtual.dono && String(servidorAtual.dono) === String(usuario)) lista.push('dono');
    return lista;
}
let temporizadorConquistas = null;
async function carregarConquistasMembros() {
    const id = servidorAtual.id;
    if (!id) return;
    try {
        const d = await api('GET', `/servidores/${id}/conquistas`);
        if (id !== servidorAtual.id) return;
        const mapa = new Map();
        Object.entries((d && d.pessoas) || {}).slice(0, 60).forEach(([usuario, lista]) => {
            const limpas = (Array.isArray(lista) ? lista : []).slice(0, 12)
                .map((c) => ({ icone: String((c && c.icone) || '').slice(0, 8), titulo: String((c && c.titulo) || '').slice(0, 40) })).filter((c) => c.icone);
            if (limpas.length) mapa.set(String(usuario), limpas);
        });
        conquistasMembros = mapa;
        const cargos = new Map();
        Object.entries((d && d.cargos) || {}).slice(0, 60).forEach(([usuario, lista]) => {
            const ok = (Array.isArray(lista) ? lista : []).filter((c) => c === 'fundador' || c === 'moderador');
            if (ok.length) cargos.set(String(usuario), ok.slice(0, 1));
        });
        cargosMembros = cargos;
        atualizarListaOnline();
        if (vozConectada()) atualizarListaMembros();
    } catch (e) { /* servidor antigo ou sem internet: fica sem as medalhas */ }
}
// Selos de cargo (Fundador, Moderador, Dono) e, depois, as medalhas ganhas.
function seloCargo(c) {
    const s = document.createElement('span');
    s.className = 'selo-cargo ' + CARGOS[c].classe;
    s.textContent = CARGOS[c].texto;
    s.title = CARGOS[c].dica;
    return s;
}
function linhaConquistas(usuario) {
    const lista = conquistasMembros.get(String(usuario));
    const cargos = cargosDe(usuario);
    if (!lista && !cargos.length) return null;
    const linha = document.createElement('span');
    linha.className = 'linha-cargos';
    cargos.forEach((c) => linha.appendChild(seloCargo(c)));
    if (lista) {
        const el = document.createElement('span');
        el.className = 'legenda-conquistas';
        el.textContent = lista.slice(0, 6).map((c) => c.icone).join('') + (lista.length > 6 ? ` +${lista.length - 6}` : '');
        el.title = lista.map((c) => `${c.icone} ${c.titulo}`).join('\n');
        linha.appendChild(el);
    }
    return linha;
}
function iniciarPing() {
    pararPing();
    if (!servidorAtual.id) return;
    fazerPing();
    temporizadorPing = setInterval(fazerPing, 10000);
    carregarConquistasMembros();
    temporizadorConquistas = setInterval(carregarConquistasMembros, 60000);
}
function pararPing() {
    if (temporizadorPing) { clearInterval(temporizadorPing); temporizadorPing = null; }
    if (temporizadorConquistas) { clearInterval(temporizadorConquistas); temporizadorConquistas = null; }
    conquistasMembros = new Map();
    cargosMembros = new Map();
}

// Usado quando entra/sai de um canal de voz: avisa na hora em vez de esperar o próximo ping.
function broadcastarStatusPresenca() { fazerPing(); }

// Chamado quando o perfil fica pronto: carrega os servidores da pessoa.
let sessaoIniciadaPara = null;
async function conectarPresenca() {
    const identidade = obterIdentidadeUsuario();
    if (!identidade || sessaoIniciadaPara === identidade) return;
    sessaoIniciadaPara = identidade;
    const aceito = await garantirTermos();
    if (!aceito || sessaoIniciadaPara !== identidade) return; // saiu da conta na tela de termos
    qualidadeConta = null;
    atualizarQualidade();
    carregarMeusServidores();
    iniciarAmigos();
}

// ---------- Escolher / carregar servidores ----------
function sairDoTextoAtual() {
    chatCanal.fechar();
    canalTextoAtual = null;
}

function definirServidorAtual(servidor) {
    const antigo = servidorAtual.id;
    // Trocar de servidor NÃO tira você do online do anterior: o app segue avisando presença em todos.
    servidorAtual = { ...servidor, chave: servidor.id };
    try { localStorage.setItem(CHAVE_SERVIDOR_ATUAL, servidor.id); } catch (e) {}
    presencaParticipantes.clear();
    aplicarNomeServidor();
    renderizarListaCanais();
    renderizarBarraServidores();
    atualizarControlesDoServidor();
    atualizarListaOnline();
    mostrarAreaVazia();
    iniciarPing();
}

async function carregarMeusServidores(preferirId) {
    let dados;
    try {
        dados = await api('GET', '/servidores');
    } catch (err) {
        // Em manutenção o recado já aparece na faixa do topo: não fica repetindo "não consegui falar".
        if (err.codigo === 'manutencao') { carregarAvisosDaConta(); setTimeout(() => carregarMeusServidores(preferirId), 30000); return; }
        mostrarNotificacao('Não consegui falar com o servidor do Estrivisor. Tentando de novo...');
        setTimeout(() => carregarMeusServidores(preferirId), 10000);
        return;
    }
    meusServidores = dados.servidores;

    if (meusServidores.length === 0) {
        pararPing();
        servidorAtual = SERVIDOR_VAZIO;
        presencaParticipantes.clear();
        aplicarNomeServidor();
        renderizarListaCanais();
        renderizarBarraServidores();
        atualizarControlesDoServidor();
        atualizarListaOnline();
        abrirTelaInicio({ cancelavel: false });
        return;
    }

    let guardado = preferirId;
    if (!guardado) { try { guardado = localStorage.getItem(CHAVE_SERVIDOR_ATUAL); } catch (e) {} }
    const alvo = meusServidores.find((s) => s.id === guardado) || meusServidores[0];
    definirServidorAtual(alvo);
}

// Troca para outro servidor (sai da voz e do texto atuais, porque as salas são de cada servidor).
async function selecionarServidor(id) {
    if (amigosAbertos()) fecharAmigos();
    if (id === servidorAtual.id) return;
    const alvo = meusServidores.find((s) => s.id === id);
    if (!alvo) return;
    if (roomVoz || canalVozAtual) {
        const r = await pedirTexto({ titulo: `Ir para "${alvo.nome}"?`, dica: 'Você vai sair do canal de voz em que está.', semCampo: true, rotuloOk: 'Trocar' });
        if (!r) return;
        await sairCanalVoz();
    }
    sairDoTextoAtual();
    definirServidorAtual(alvo);
}

// Busca de novo o servidor atual (o ping avisou que algo mudou).
async function recarregarServidorAtual() {
    const id = servidorAtual.id;
    if (!id) return;
    let novo;
    try {
        novo = (await api('GET', `/servidores/${id}`)).servidor;
    } catch (err) {
        if (err.status === 403 || err.status === 404) await perdeuAcesso(id);
        return;
    }
    if (id !== servidorAtual.id) return;

    const idx = meusServidores.findIndex((s) => s.id === id);
    if (idx >= 0) meusServidores[idx] = novo;
    servidorAtual = { ...novo, chave: novo.id };

    // Se o canal em que você estava foi apagado, sai dele.
    if (canalVozAtual && !servidorAtual.canais.some((c) => c.id === canalVozAtual.id)) {
        const olhando = document.getElementById('area-voz').style.display === 'flex';
        await sairCanalVoz();
        if (olhando) mostrarAreaVazia();
        mostrarNotificacao('O canal de voz em que você estava foi apagado.', 'info');
    }
    if (canalTextoAtual && !servidorAtual.canais.some((c) => c.id === canalTextoAtual.id)) {
        sairDoTextoAtual();
        if (document.getElementById('area-texto').style.display === 'flex') mostrarAreaVazia();
    }

    aplicarNomeServidor();
    renderizarListaCanais();
    renderizarBarraServidores();
    atualizarControlesDoServidor();
    atualizarListaOnline();
    if (ajustesAbertos()) renderizarAjustes();
}

// Foi expulso, o servidor foi apagado ou saiu por outro lugar.
async function perdeuAcesso(id) {
    if (id !== servidorAtual.id) return;
    const nome = servidorAtual.nome;
    await sairCanalVoz();
    sairDoTextoAtual();
    fecharAjustes();
    mostrarNotificacao(`Você não está mais no servidor "${nome}" (foi removido ou o servidor foi apagado).`);
    servidorAtual = SERVIDOR_VAZIO;
    await carregarMeusServidores();
}

// ---------- Barra de servidores ----------
function preencherIconeServidor(el, servidor) {
    el.textContent = '';
    el.style.background = '';
    if (servidor.icone && REGEX_ICONE_SERVIDOR.test(servidor.icone)) {
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.src = servidor.icone;
        el.appendChild(img);
        return;
    }
    el.textContent = (Array.from(String(servidor.nome || '?').trim())[0] || '?').toUpperCase();
    el.style.background = /^#[0-9a-fA-F]{6}$/.test(servidor.cor || '') ? servidor.cor : corDoAvatar(String(servidor.nome || '?'));
}

function renderizarBarraServidores() {
    const barra = document.getElementById('barra-servidores');
    // Limpa só os botões (a camada de imagem da barra, se houver, fica).
    barra.querySelectorAll(':scope > :not(.camada-area)').forEach((el) => el.remove());
    const btnAmigos = document.createElement('button');
    btnAmigos.className = 'btn-servidor' + (amigosAbertos() ? ' ativo' : '');
    btnAmigos.title = 'Amigos e mensagens diretas';
    btnAmigos.innerHTML = '<span class="icone-servidor" style="background:#262b31;font-size:20px;">👥</span>';
    const nAmigos = totalDmNaoLidas() + (amigosEstado.recebidos || []).length;
    if (nAmigos) { const b = document.createElement('span'); b.className = 'badge-servidor'; b.textContent = nAmigos > 99 ? '99+' : String(nAmigos); btnAmigos.appendChild(b); }
    btnAmigos.addEventListener('click', () => (amigosAbertos() ? fecharAmigos() : abrirAmigos()));
    barra.appendChild(btnAmigos);
    const sepAmigos = document.createElement('div');
    sepAmigos.className = 'separador-servidores';
    barra.appendChild(sepAmigos);
    meusServidores.forEach((s) => {
        const botao = document.createElement('button');
        botao.className = 'btn-servidor' + (s.id === servidorAtual.id && !amigosAbertos() ? ' ativo' : '');
        botao.title = s.nome;
        const icone = document.createElement('span');
        icone.className = 'icone-servidor';
        preencherIconeServidor(icone, s);
        botao.appendChild(icone);
        const nl = naoLidasDoServidor(s);
        if (nl) { const b = document.createElement('span'); b.className = 'badge-servidor'; b.textContent = nl > 99 ? '99+' : String(nl); botao.appendChild(b); }
        botao.addEventListener('click', () => selecionarServidor(s.id));
        barra.appendChild(botao);
    });
    if (meusServidores.length) {
        const sep = document.createElement('div');
        sep.className = 'separador-servidores';
        barra.appendChild(sep);
    }
    const mais = document.createElement('button');
    mais.className = 'btn-servidor btn-servidor-add';
    mais.title = 'Criar um servidor ou entrar com convite';
    mais.innerHTML = '<span class="icone-servidor">+</span>';
    mais.addEventListener('click', () => abrirTelaInicio({ cancelavel: true }));
    barra.appendChild(mais);
}

// Só o dono cria/apaga canais.
function atualizarControlesDoServidor() {
    const dono = servidorAtual.souDono === true;
    document.getElementById('btn-add-texto').style.display = dono ? '' : 'none';
    document.getElementById('btn-add-voz').style.display = dono ? '' : 'none';
    document.getElementById('btn-renomear-servidor').style.display = servidorAtual.id ? '' : 'none';
}

// ---------- Ícone: reduz qualquer imagem pra 128x128 antes de enviar ----------
async function reduzirIconeServidor(arquivo) {
    if (!arquivo || !/^image\//.test(arquivo.type)) throw new Error('Escolha um arquivo de imagem.');
    if (arquivo.size > 20 * 1024 * 1024) throw new Error('Essa imagem é grande demais (máx. 20 MB).');
    let bitmap;
    try { bitmap = await createImageBitmap(arquivo); } catch (e) { throw new Error('Não consegui ler essa imagem.'); }
    const lado = 128;
    const canvas = document.createElement('canvas');
    canvas.width = lado; canvas.height = lado;
    const ctx = canvas.getContext('2d');
    const corte = Math.min(bitmap.width, bitmap.height); // recorta o quadrado do centro
    ctx.drawImage(bitmap, (bitmap.width - corte) / 2, (bitmap.height - corte) / 2, corte, corte, 0, 0, lado, lado);
    if (bitmap.close) bitmap.close();
    for (const qualidade of [0.85, 0.7, 0.5]) {
        const url = canvas.toDataURL('image/webp', qualidade);
        if (url.startsWith('data:image/webp') && url.length <= 38000) return url;
    }
    const png = canvas.toDataURL('image/png');
    if (png.length <= 38000) return png;
    throw new Error('Não consegui deixar essa imagem pequena o bastante. Tente outra.');
}

// ---------- Tela de criar / entrar ----------
let iconeNovoServidor = null;
let inicioCancelavel = false;

function mostrarAbaInicio(aba) {
    document.getElementById('inicio-criar').style.display = aba === 'criar' ? 'flex' : 'none';
    document.getElementById('inicio-entrar').style.display = aba === 'entrar' ? 'flex' : 'none';
    document.getElementById('inicio-aba-criar').classList.toggle('ativo', aba === 'criar');
    document.getElementById('inicio-aba-entrar').classList.toggle('ativo', aba === 'entrar');
    document.getElementById('inicio-erro').textContent = '';
    setTimeout(() => document.getElementById(aba === 'criar' ? 'inicio-nome' : 'inicio-codigo').focus(), 50);
}

function atualizarPreviaIconeNovo() {
    const nome = document.getElementById('inicio-nome').value.trim() || '?';
    preencherIconeServidor(document.getElementById('inicio-previa'), { nome, icone: iconeNovoServidor });
    document.getElementById('inicio-remover-icone').style.display = iconeNovoServidor ? '' : 'none';
}

function abrirTelaInicio({ cancelavel }) {
    inicioCancelavel = cancelavel;
    iconeNovoServidor = null;
    const podeCriar = origemPerfil === 'discord' && !meusServidores.some((s) => s.souDono);
    let texto = 'Crie o seu servidor ou entre no de um amigo com um código de convite.';
    if (origemPerfil !== 'discord') texto = 'Pra criar um servidor, o Estrivisor precisa detectar o seu Discord aberto. Mas você já pode entrar no servidor de um amigo com um código de convite.';
    else if (!podeCriar) texto = 'Você já tem um servidor (o limite é 1 por pessoa). Pra entrar em outro, use um código de convite.';
    document.getElementById('inicio-texto').textContent = texto;
    document.getElementById('inicio-titulo').textContent = meusServidores.length ? 'Servidores' : 'Bem-vindo ao Estrivisor';
    document.getElementById('inicio-aba-criar').style.display = podeCriar ? '' : 'none';
    document.getElementById('inicio-nome').value = podeCriar ? nomeServidorAntigo() : '';
    document.getElementById('inicio-codigo').value = '';
    document.getElementById('inicio-fechar').style.display = cancelavel ? '' : 'none';
    document.getElementById('tela-inicio').style.display = 'flex';
    atualizarPreviaIconeNovo();
    mostrarAbaInicio(podeCriar ? 'criar' : 'entrar');
}

function fecharTelaInicio() {
    document.getElementById('tela-inicio').style.display = 'none';
}

function erroInicio(err) {
    document.getElementById('inicio-erro').textContent = err && err.message ? err.message : 'Algo deu errado.';
}

document.getElementById('inicio-aba-criar').addEventListener('click', () => mostrarAbaInicio('criar'));
document.getElementById('inicio-aba-entrar').addEventListener('click', () => mostrarAbaInicio('entrar'));
document.getElementById('inicio-fechar').addEventListener('click', fecharTelaInicio);
document.getElementById('inicio-nome').addEventListener('input', atualizarPreviaIconeNovo);
document.getElementById('inicio-escolher-icone').addEventListener('click', () => document.getElementById('inicio-arquivo').click());
document.getElementById('inicio-remover-icone').addEventListener('click', () => { iconeNovoServidor = null; atualizarPreviaIconeNovo(); });
document.getElementById('inicio-arquivo').addEventListener('change', async (e) => {
    const arquivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    try { iconeNovoServidor = await reduzirIconeServidor(arquivo); atualizarPreviaIconeNovo(); document.getElementById('inicio-erro').textContent = ''; }
    catch (err) { erroInicio(err); }
});

async function entrarNoServidorRecebido(servidor) {
    const idx = meusServidores.findIndex((s) => s.id === servidor.id);
    if (idx >= 0) meusServidores[idx] = servidor; else meusServidores.push(servidor);
    await sairCanalVoz();
    sairDoTextoAtual();
    definirServidorAtual(servidor);
    fecharTelaInicio();
}

let ocupadoInicio = false;
async function criarMeuServidor() {
    if (ocupadoInicio) return;
    const nome = document.getElementById('inicio-nome').value.replace(/\s+/g, ' ').trim();
    if (!nome) return erroInicio(new Error('Dê um nome ao servidor.'));
    ocupadoInicio = true;
    try {
        const d = await api('POST', '/servidores', { nome, icone: iconeNovoServidor || undefined, nomeUsuario: nomeUsuarioAtual });
        await entrarNoServidorRecebido(d.servidor);
        mostrarNotificacao(`Servidor "${d.servidor.nome}" criado! Gere um convite em ⚙️ pra chamar seus amigos.`, 'info');
    } catch (err) { erroInicio(err); } finally { ocupadoInicio = false; }
}

async function entrarComConvite() {
    if (ocupadoInicio) return;
    const codigo = document.getElementById('inicio-codigo').value.trim();
    if (!codigo) return erroInicio(new Error('Digite o código do convite.'));
    ocupadoInicio = true;
    try {
        const d = await api('POST', '/convites/usar', { codigo, nomeUsuario: nomeUsuarioAtual });
        await entrarNoServidorRecebido(d.servidor);
        mostrarNotificacao(`Você entrou em "${d.servidor.nome}".`, 'info');
    } catch (err) { erroInicio(err); } finally { ocupadoInicio = false; }
}

document.getElementById('inicio-criar-ok').addEventListener('click', criarMeuServidor);
document.getElementById('inicio-entrar-ok').addEventListener('click', entrarComConvite);
document.getElementById('inicio-nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') criarMeuServidor(); });
document.getElementById('inicio-codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrarComConvite(); });
document.getElementById('tela-inicio').addEventListener('keydown', (e) => { if (e.key === 'Escape' && inicioCancelavel) fecharTelaInicio(); });

// ---------- Ajustes do servidor ----------
const modalAjustes = () => document.getElementById('modal-ajustes');
const ajustesAbertos = () => modalAjustes().style.display === 'flex';
function fecharAjustes() { modalAjustes().style.display = 'none'; }
function erroAjustes(err) {
    document.getElementById('ajustes-erro').textContent = err ? (err.message || 'Algo deu errado.') : '';
    // Ação feita pelo menu de uma pessoa (com os ajustes fechados): o erro aparece como aviso.
    if (err && modalAjustes().style.display !== 'flex') mostrarNotificacao(err.message || 'Algo deu errado.');
}

// Faz uma alteração no servidor (só o dono) e atualiza a tela com a resposta.
async function alterarServidor(corpo) {
    erroAjustes(null);
    try {
        const d = await api('PATCH', `/servidores/${servidorAtual.id}`, corpo);
        const idx = meusServidores.findIndex((s) => s.id === d.servidor.id);
        if (idx >= 0) meusServidores[idx] = d.servidor;
        servidorAtual = { ...d.servidor, chave: d.servidor.id };
        aplicarNomeServidor();
        renderizarBarraServidores();
        renderizarAjustes();
        return true;
    } catch (err) { erroAjustes(err); return false; }
}

function linhaDeLista(rotulo, sub, botoes) {
    const linha = document.createElement('div');
    linha.className = 'item-lista-ajustes';
    const r = document.createElement('span');
    r.className = 'rotulo';
    r.textContent = rotulo;
    if (sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = ' ' + sub; r.appendChild(s); }
    linha.appendChild(r);
    (botoes || []).forEach(({ texto, perigo, acao }) => {
        const b = document.createElement('button');
        b.textContent = texto;
        b.className = perigo ? 'btn-perigo' : 'btn-secundario';
        b.addEventListener('click', acao);
        linha.appendChild(b);
    });
    return linha;
}

function formatarValidade(ms) {
    const dias = Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
    return dias <= 1 ? 'vence hoje/amanhã' : `vence em ${dias} dias`;
}


async function renderizarConvites() {
    const lista = document.getElementById('ajustes-convites');
    lista.innerHTML = '';
    if (!servidorAtual.souDono) return;
    try {
        const d = await api('GET', `/servidores/${servidorAtual.id}/convites`);
        d.convites.forEach((c) => {
            lista.appendChild(linhaDeLista(c.formatado, `por ${c.criadoPor} · ${formatarValidade(c.expiraEm)}`, [
                { texto: 'Copiar', acao: () => copiarTexto(c.formatado) },
                { texto: 'Cancelar', perigo: true, acao: async () => {
                    try { await api('DELETE', `/servidores/${servidorAtual.id}/convites/${encodeURIComponent(c.codigo)}`); renderizarConvites(); }
                    catch (err) { erroAjustes(err); }
                } }
            ]));
        });
    } catch (err) { /* lista de convites é opcional; erro aparece em outras ações */ }
}

// Quem foi expulso e não pode voltar (só o dono vê). "Deixar voltar" tira da lista: a pessoa entra de novo com um convite.
async function renderizarBanidos() {
    let caixa = document.getElementById('ajustes-banidos');
    if (!caixa) {
        caixa = document.createElement('div');
        caixa.id = 'ajustes-banidos';
        caixa.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:10px;';
        document.getElementById('ajustes-membros').insertAdjacentElement('afterend', caixa);
    }
    caixa.replaceChildren();
    if (!servidorAtual.souDono) return;
    const idServidor = servidorAtual.id;
    try {
        const d = await api('GET', `/servidores/${idServidor}/banidos`);
        if (servidorAtual.id !== idServidor || !Array.isArray(d.banidos) || !d.banidos.length) return;
        caixa.replaceChildren();
        const titulo = document.createElement('div'); titulo.className = 'titulo-ajustes'; titulo.textContent = `Expulsos (não podem voltar) — ${d.banidos.length}`;
        caixa.appendChild(titulo);
        d.banidos.forEach((b) => {
            caixa.appendChild(linhaDeLista(String(b.nome || b.usuario).slice(0, 40), 'expulso em ' + new Date(b.ts).toLocaleDateString('pt-BR'), [
                { texto: 'Deixar voltar', acao: async () => {
                    try { await api('DELETE', `/servidores/${idServidor}/banidos/${encodeURIComponent(b.usuario)}`); renderizarBanidos(); }
                    catch (err) { erroAjustes(err); }
                } }
            ]));
        });
    } catch (err) { /* servidor antigo (sem esta lista): só não mostra */ }
}

function renderizarAjustes() {
    const s = servidorAtual;
    const dono = s.souDono === true;
    preencherIconeServidor(document.getElementById('ajustes-icone'), s);
    document.getElementById('ajustes-titulo').textContent = s.nome;
    document.getElementById('ajustes-aparencia').style.display = dono ? 'flex' : 'none';
    const inputNome = document.getElementById('ajustes-nome');
    if (document.activeElement !== inputNome) inputNome.value = s.nome;
    document.getElementById('ajustes-remover-icone').style.display = s.icone ? '' : 'none';
    if (/^#[0-9a-fA-F]{6}$/.test(s.cor || '')) document.getElementById('ajustes-cor').value = s.cor;

    const membros = document.getElementById('ajustes-membros');
    membros.innerHTML = '';
    document.getElementById('ajustes-titulo-membros').textContent = `Membros — ${s.membros.length}`;
    s.membros.forEach((m) => {
        const ehVoce = m.usuario === obterIdentidadeUsuario();
        const botoes = [];
        if (dono && !ehVoce) {
            botoes.push({ texto: 'Dar o servidor', acao: () => transferirServidor(m) });
            botoes.push({ texto: 'Expulsar', perigo: true, acao: () => expulsarMembro(m) });
        }
        const conta = contaDiferente(m.nome, m.conta);
        membros.appendChild(linhaDeLista(m.nome + (ehVoce ? ' (você)' : ''), [conta ? `conta: ${conta}` : '', m.dono ? '👑 dono' : ''].filter(Boolean).join(' · '), botoes));
    });
    renderizarBanidos();

    const perigo = document.getElementById('ajustes-perigo');
    perigo.textContent = dono ? 'Apagar servidor' : 'Sair do servidor';
    renderizarConvites();
}

function abrirAjustes() {
    if (!servidorAtual.id) return;
    erroAjustes(null);
    document.getElementById('ajustes-convite-novo').innerHTML = '';
    renderizarAjustes();
    modalAjustes().style.display = 'flex';
}

async function transferirServidor(m) {
    const r = await pedirTexto({ titulo: `Dar o servidor pra ${m.nome}?`, dica: 'Ele vira o dono e você passa a ser só membro. Isso só funciona se a pessoa ainda não tiver um servidor próprio.', semCampo: true, rotuloOk: 'Transferir' });
    if (!r) return;
    try {
        const d = await api('POST', `/servidores/${servidorAtual.id}/transferir`, { novoDono: m.usuario });
        const idx = meusServidores.findIndex((s) => s.id === d.servidor.id);
        if (idx >= 0) meusServidores[idx] = d.servidor;
        servidorAtual = { ...d.servidor, chave: d.servidor.id };
        aplicarNomeServidor(); renderizarListaCanais(); atualizarControlesDoServidor(); renderizarAjustes();
    } catch (err) { erroAjustes(err); }
}

async function expulsarMembro(m) {
    const r = await pedirTexto({ titulo: `Expulsar ${m.nome}?`, dica: 'A pessoa sai do servidor na hora e NÃO consegue voltar, nem com convite (os convites que ela criou são cancelados). Para liberar depois: aqui nos ajustes, em "Expulsos" > "Deixar voltar".', semCampo: true, rotuloOk: 'Expulsar' });
    if (!r) return;
    try { await api('POST', `/servidores/${servidorAtual.id}/expulsar`, { alvo: m.usuario }); await recarregarServidorAtual(); }
    catch (err) { erroAjustes(err); }
}

document.getElementById('btn-renomear-servidor').addEventListener('click', abrirAjustes);
document.getElementById('ajustes-fechar').addEventListener('click', fecharAjustes);
modalAjustes().addEventListener('click', (e) => { if (e.target === modalAjustes()) fecharAjustes(); });
modalAjustes().addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharAjustes(); });

document.getElementById('ajustes-salvar-nome').addEventListener('click', async () => {
    const nome = document.getElementById('ajustes-nome').value.replace(/\s+/g, ' ').trim();
    if (!nome) return erroAjustes(new Error('Dê um nome ao servidor.'));
    if (nome !== servidorAtual.nome && await alterarServidor({ nome })) mostrarNotificacao('Nome do servidor atualizado.', 'info');
});
document.getElementById('ajustes-nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('ajustes-salvar-nome').click(); });
document.getElementById('ajustes-escolher-icone').addEventListener('click', () => document.getElementById('ajustes-arquivo').click());
document.getElementById('ajustes-remover-icone').addEventListener('click', () => alterarServidor({ icone: null }));
document.getElementById('ajustes-arquivo').addEventListener('change', async (e) => {
    const arquivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    try { await alterarServidor({ icone: await reduzirIconeServidor(arquivo) }); } catch (err) { erroAjustes(err); }
});
document.getElementById('ajustes-cor').addEventListener('change', (e) => alterarServidor({ cor: e.target.value }));
document.getElementById('ajustes-limpar-cor').addEventListener('click', () => alterarServidor({ cor: null }));

document.getElementById('ajustes-gerar-convite').addEventListener('click', async () => {
    erroAjustes(null);
    const area = document.getElementById('ajustes-convite-novo');
    try {
        const d = await api('POST', `/servidores/${servidorAtual.id}/convites`);
        area.innerHTML = '';
        const linha = linhaDeLista('', formatarValidade(d.convite.expiraEm), [{ texto: 'Copiar', acao: () => copiarTexto(d.convite.formatado) }]);
        const codigo = document.createElement('span');
        codigo.className = 'codigo-convite';
        codigo.textContent = d.convite.formatado;
        linha.querySelector('.rotulo').prepend(codigo);
        area.appendChild(linha);
        copiarTexto(d.convite.formatado);
        renderizarConvites();
    } catch (err) { erroAjustes(err); }
});

document.getElementById('ajustes-perigo').addEventListener('click', async () => {
    const dono = servidorAtual.souDono === true;
    const id = servidorAtual.id;
    const r = await pedirTexto(dono
        ? { titulo: `Apagar "${servidorAtual.nome}"?`, dica: 'O servidor, os canais e os convites somem pra todo mundo e não dá pra desfazer. Depois você pode criar outro.', semCampo: true, rotuloOk: 'Apagar' }
        : { titulo: `Sair de "${servidorAtual.nome}"?`, dica: 'Pra voltar, você vai precisar de um convite novo.', semCampo: true, rotuloOk: 'Sair' });
    if (!r) return;
    try {
        if (dono) await api('DELETE', `/servidores/${id}`); else await api('POST', `/servidores/${id}/sair`);
    } catch (err) { return erroAjustes(err); }
    fecharAjustes();
    await sairCanalVoz();
    sairDoTextoAtual();
    servidorAtual = SERVIDOR_VAZIO;
    await carregarMeusServidores();
});


function atualizarListaOnline() {
    atualizarSubMembrosVoz(); // quem está em cada canal de voz (embaixo do canal)
    const lista = document.getElementById('lista-online');
    const titulo = document.getElementById('titulo-online');
    lista.innerHTML = '';

    const todos = [...presencaParticipantes.entries()];
    titulo.textContent = `ONLINE — ${todos.length}`;

    todos.forEach(([identity, info]) => {
        const canal = info.canalVoz ? servidorAtual.canais.find(c => c.id === info.canalVoz) : null;
        const item = document.createElement('div');
        item.className = 'item-membro';
        item.innerHTML = `
            <span class="avatar-participante"></span>
            <span class="info-membro">
                <span>${htmlNomeComConta(info.nome, info.conta)}</span>
                ${canal ? `<span class="legenda-canal-voz">🔊 ${escaparHtml(canal.nome)}</span>` : ''}
                ${info.status ? `<span class="legenda-status" title="${escaparHtml(info.status)}">${escaparHtml(info.status)}</span>` : ''}
            </span>`;
        aplicarAvatar(item.querySelector('.avatar-participante'), identity, info.nome, info.avatar);
        { const medalhas = linhaConquistas(identity); if (medalhas) item.querySelector('.info-membro').appendChild(medalhas); }
        if (identity !== obterIdentidadeUsuario()) {
            item.style.cursor = 'pointer';
            item.addEventListener('click', (e) => abrirMenuPessoa(e.clientX, e.clientY, identity, info.nome));
            item.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenuPessoa(e.clientX, e.clientY, identity, info.nome); });
        } else {
            item.style.cursor = 'pointer';
            item.title = 'Ver o meu perfil (botão direito: mais opções)';
            item.addEventListener('click', () => abrirPerfil(identity));
            item.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenuPessoa(e.clientX, e.clientY, identity, info.nome); });
        }
        lista.appendChild(item);
    });

    // Quem é do servidor mas não está online agora (o próprio usuário não entra aqui).
    const listaOff = document.getElementById('lista-offline');
    const tituloOff = document.getElementById('titulo-offline');
    listaOff.innerHTML = '';
    const eu = obterIdentidadeUsuario();
    const offline = (servidorAtual.membros || [])
        .filter((m) => m && m.usuario !== eu && !presencaParticipantes.has(String(m.usuario)))
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }));
    tituloOff.style.display = offline.length ? 'block' : 'none';
    tituloOff.textContent = `OFFLINE — ${offline.length}`;
    offline.forEach((m) => {
        const nome = m.nome || m.usuario;
        const item = document.createElement('div');
        item.className = 'item-membro offline';
        item.innerHTML = `<span class="avatar-participante"></span><span class="info-membro"><span>${htmlNomeComConta(nome, m.conta)}</span></span>`;
        aplicarAvatar(item.querySelector('.avatar-participante'), String(m.usuario), nome, null);
        { const medalhas = linhaConquistas(m.usuario); if (medalhas) item.querySelector('.info-membro').appendChild(medalhas); }
        item.style.cursor = 'pointer';
        item.addEventListener('click', (e) => abrirMenuPessoa(e.clientX, e.clientY, String(m.usuario), nome));
        item.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenuPessoa(e.clientX, e.clientY, String(m.usuario), nome); });
        listaOff.appendChild(item);
    });
}

// ---------- Sala de espera (aprovação) ----------
let intervaloPendentes = null;
function iniciarChecagemPendentes(sala) {
    pararChecagemPendentes();
    intervaloPendentes = setInterval(async () => {
        try {
            const pedidos = await window.electronAPI.listarPendentes({ sala });
            renderizarPendentes(sala, Array.isArray(pedidos) ? pedidos : []);
        } catch (e) { /* servidor fora do ar: tenta de novo daqui a pouco */ }
    }, 2500);
}
function pararChecagemPendentes() {
    if (intervaloPendentes) { clearInterval(intervaloPendentes); intervaloPendentes = null; }
}
function renderizarPendentes(sala, pedidos) {
    const lista = document.getElementById('lista-pendentes-voz');
    lista.innerHTML = '';
    if (pedidos.length === 0) {
        lista.innerHTML = '<div style="color:var(--texto-fraco);font-size:12.5px;">Ninguém esperando.</div>';
        return;
    }
    pedidos.forEach(pedido => {
        const item = document.createElement('div');
        item.className = 'pedido-item';
        item.innerHTML = `<span>${escaparHtml(pedido.nome || pedido.usuario)} quer entrar</span><span class="pedido-botoes"><button class="btn-aceitar">Aceitar</button><button class="btn-recusar">Recusar</button></span>`;
        const decidir = (decisao) => window.electronAPI.decidirPendente({ sala, solicitacaoId: pedido.solicitacaoId, decisao })
            .then(() => item.remove())
            .catch((err) => mostrarNotificacao('Não consegui responder ao pedido: ' + err.message));
        item.querySelector('.btn-aceitar').addEventListener('click', () => decidir('aprovado'));
        item.querySelector('.btn-recusar').addEventListener('click', () => decidir('negado'));
        lista.appendChild(item);
    });
}

// ---------- Abas da coluna da direita (Membros / Vídeo / Visual) ----------
function abrirAbaDireita(nome) {
    ['membros', 'video', 'visual'].forEach((aba) => {
        document.getElementById('aba-' + aba).style.display = aba === nome ? 'block' : 'none';
    });
    document.querySelectorAll('.aba-direita').forEach((botao) => {
        botao.classList.toggle('ativa', botao.dataset.aba === nome);
    });
}
document.querySelectorAll('.aba-direita').forEach((botao) => {
    botao.addEventListener('click', () => abrirAbaDireita(botao.dataset.aba));
});

// ---------- Modo ampliado (cinema) ----------
// Esconde a barra de servidores e as duas colunas pra transmissão ocupar a janela inteira.
function alternarModoCinema(forcar) {
    const ligar = typeof forcar === 'boolean' ? forcar : !document.body.classList.contains('modo-cinema');
    document.body.classList.toggle('modo-cinema', ligar);
    aplicarTamanhoVideo();
    renderizarVideo(); // refaz os quadros pra o botão trocar de ícone
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('modo-cinema') && !document.fullscreenElement) alternarModoCinema(false);
});

// ---------- Tamanho da transmissão na sua tela ----------
// Só muda COMO VOCÊ VÊ a transmissão dos outros (não o que você envia).
// "Grande" ocupa toda a área (o comportamento de sempre).
const TAMANHOS_VIDEO = { pequeno: 40, medio: 70, grande: 100 };
let tamanhoVideo = { modo: 'grande', pct: 100 };

function aplicarTamanhoVideo() {
    const area = document.getElementById('area-voz');
    area.style.setProperty('--tam-video', tamanhoVideo.pct + '%');
    area.dataset.tamanho = (tamanhoVideo.pct >= 100 || document.body.classList.contains('modo-cinema')) ? 'cheio' : 'parcial';
    document.querySelectorAll('#seg-tamanho button').forEach((botao) => {
        botao.classList.toggle('ativo', botao.dataset.tam === tamanhoVideo.modo);
    });
    document.getElementById('linha-slider-tamanho').style.display = tamanhoVideo.modo === 'personalizado' ? 'flex' : 'none';
    document.getElementById('slider-tamanho-video').value = tamanhoVideo.pct;
    document.getElementById('valor-tamanho-video').textContent = tamanhoVideo.pct + '%';
}

function definirTamanhoVideo(modo, pct) {
    if (!['pequeno', 'medio', 'grande', 'personalizado'].includes(modo)) modo = 'grande';
    if (modo === 'personalizado') {
        pct = Math.round(limitar(pct, { min: 25, max: 100, padrao: 100 }) / 5) * 5;
    } else {
        pct = TAMANHOS_VIDEO[modo];
    }
    tamanhoVideo = { modo, pct };
    aplicarTamanhoVideo();
    salvarPreferenciasVideo();
}

document.querySelectorAll('#seg-tamanho button').forEach((botao) => {
    botao.addEventListener('click', () => definirTamanhoVideo(botao.dataset.tam, tamanhoVideo.pct));
});
document.getElementById('slider-tamanho-video').addEventListener('input', () => {
    definirTamanhoVideo('personalizado', Number(document.getElementById('slider-tamanho-video').value));
});

// ---------- Memória das configurações de vídeo ----------
// Qualidade, valores do "Personalizado" e tamanho na tela ficam salvos pra próxima vez.
// (O codec e a opção do Discord já se lembram sozinhos.)
const CHAVE_PREFS_VIDEO = 'estrivisor_video';
const QUALIDADES_VALIDAS = ['automatico', 'alta', 'balanceado', 'economia', 'personalizado'];

function salvarPreferenciasVideo() {
    const c = lerCamposPersonalizados();
    localStorage.setItem(CHAVE_PREFS_VIDEO, JSON.stringify({
        qualidade: document.getElementById('select-qualidade').value,
        largura: c.largura, altura: c.altura, fps: c.fps, bitrate: c.bitrate,
        simulcast: document.getElementById('custom-simulcast').checked,
        som: document.getElementById('check-som-sistema').checked,
        tamanho: tamanhoVideo
    }));
}

function carregarPreferenciasVideo() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(CHAVE_PREFS_VIDEO) || 'null'); } catch (e) { /* dado corrompido: ignora */ }
    if (p && typeof p === 'object') {
        if (QUALIDADES_VALIDAS.includes(p.qualidade)) document.getElementById('select-qualidade').value = p.qualidade;
        document.getElementById('custom-largura').value = p.largura;
        document.getElementById('custom-altura').value = p.altura;
        document.getElementById('custom-fps').value = p.fps;
        document.getElementById('custom-bitrate').value = p.bitrate;
        document.getElementById('custom-simulcast').checked = p.simulcast === true;
        document.getElementById('check-som-sistema').checked = p.som !== false;
        if (p.tamanho && typeof p.tamanho === 'object') tamanhoVideo = { modo: p.tamanho.modo, pct: p.tamanho.pct };
    }
    // Passa tudo pelos mesmos limites de sempre (valores ausentes ou estranhos viram o padrão).
    const c = lerCamposPersonalizados();
    document.getElementById('custom-largura').value = c.largura;
    document.getElementById('custom-altura').value = c.altura;
    document.getElementById('custom-fps').value = c.fps;
    document.getElementById('custom-bitrate').value = c.bitrate;
    sincronizarPresetResolucao();
    atualizarPainelPersonalizado();
    qualidadeValida = document.getElementById('select-qualidade').value;
    definirTamanhoVideo(tamanhoVideo.modo, tamanhoVideo.pct);
}

// ---------- Foto de fundo (só no PC de cada pessoa) ----------
// A foto escolhida é reduzida (lado maior de até 1920 px) e recomprimida em WebP
// (cai pra JPEG se o WebP não existir), com meta de ~300 KB. Fica guardada no
// armazenamento do próprio app e nunca vai pro servidor, pro GitHub ou pros outros.
const CHAVE_FUNDO = 'estrivisor_fundo';
const CHAVE_FUNDO_AJUSTES = 'estrivisor_fundo_ajustes';
const FUNDO_META_BYTES = 300 * 1024;
const FUNDO_ARQUIVO_MAX_BYTES = 40 * 1024 * 1024; // recusa arquivos gigantes (a decodificação consome memória)
const REGEX_FUNDO = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+\/=]+$/;
let ajustesFundo = { escuro: 60, desfoque: 0 };

function lerFundoSalvo() {
    try {
        const dado = localStorage.getItem(CHAVE_FUNDO);
        return typeof dado === 'string' && REGEX_FUNDO.test(dado) ? dado : null;
    } catch (e) {
        return null;
    }
}

function aplicarAjustesFundo() {
    const camada = document.getElementById('fundo-app');
    camada.style.setProperty('--fundo-escuro', String(ajustesFundo.escuro / 100));
    camada.style.setProperty('--fundo-desfoque', ajustesFundo.desfoque + 'px');
    document.getElementById('slider-fundo-escuro').value = ajustesFundo.escuro;
    document.getElementById('valor-fundo-escuro').textContent = ajustesFundo.escuro + '%';
    document.getElementById('slider-fundo-desfoque').value = ajustesFundo.desfoque;
    document.getElementById('valor-fundo-desfoque').textContent = ajustesFundo.desfoque + ' px';
}

function aplicarFundo() {
    const camada = document.getElementById('fundo-app');
    const dado = lerFundoSalvo();
    document.body.classList.toggle('com-fundo', !!dado);
    if (dado) camada.style.setProperty('--fundo-img', `url("${dado}")`);
    else camada.style.removeProperty('--fundo-img');
    document.getElementById('btn-remover-fundo').disabled = !dado;
    document.getElementById('info-fundo').textContent = dado
        ? `Foto atual: ${Math.max(1, Math.round((dado.length * 0.75) / 1024))} KB`
        : 'Nenhuma foto escolhida.';
}

function salvarAjustesFundo() {
    try { localStorage.setItem(CHAVE_FUNDO_AJUSTES, JSON.stringify(ajustesFundo)); } catch (e) { /* sem espaço: ignora */ }
}

function carregarFundo() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(CHAVE_FUNDO_AJUSTES) || 'null'); } catch (e) { /* dado corrompido: ignora */ }
    if (p && typeof p === 'object') {
        ajustesFundo.escuro = Math.round(limitar(p.escuro, { min: 0, max: 90, padrao: 60 }) / 5) * 5;
        ajustesFundo.desfoque = Math.round(limitar(p.desfoque, { min: 0, max: 20, padrao: 0 }));
    }
    aplicarAjustesFundo();
    aplicarFundo();
}

function blobParaDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result);
        leitor.onerror = () => reject(leitor.error);
        leitor.readAsDataURL(blob);
    });
}

// Devolve um data URL pequeno. Tenta lados maiores/qualidades melhores primeiro e
// vai reduzindo até caber na meta (ou devolve o menor que conseguiu).
async function comprimirImagemDeFundo(arquivo) {
    const bitmap = await createImageBitmap(arquivo); // falha se o arquivo não for uma imagem válida
    const canvas = document.createElement('canvas');
    try {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        const ladoMaior = Math.max(bitmap.width, bitmap.height);
        let tipo = 'image/webp';
        let menor = null;

        for (const ladoAlvo of [1920, 1440, 1080]) {
            const escala = Math.min(1, ladoAlvo / ladoMaior);
            canvas.width = Math.max(1, Math.round(bitmap.width * escala));
            canvas.height = Math.max(1, Math.round(bitmap.height * escala));
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

            for (const qualidade of [0.8, 0.65, 0.5]) {
                let blob = await new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade));
                if (blob && blob.type !== tipo && tipo === 'image/webp') {
                    // Esse Chromium não gera WebP: usa JPEG daqui pra frente.
                    tipo = 'image/jpeg';
                    blob = await new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade));
                }
                if (!blob) throw new Error('Não consegui converter essa imagem.');
                if (!menor || blob.size < menor.size) menor = blob;
                if (blob.size <= FUNDO_META_BYTES) return await blobParaDataUrl(blob);
            }
        }
        return await blobParaDataUrl(menor);
    } finally {
        bitmap.close();
        canvas.width = canvas.height = 0; // libera a memória do canvas
    }
}

async function escolherFundo(arquivo) {
    if (!arquivo.type.startsWith('image/')) return mostrarNotificacao('Esse arquivo não é uma imagem.');
    if (arquivo.size > FUNDO_ARQUIVO_MAX_BYTES) return mostrarNotificacao('Imagem grande demais (máximo de 40 MB). Escolha uma menor.');
    let dado;
    try {
        dado = await comprimirImagemDeFundo(arquivo);
    } catch (e) {
        return mostrarNotificacao('Não consegui abrir essa imagem. Tente um JPG, PNG ou WebP.');
    }
    if (!REGEX_FUNDO.test(dado)) return mostrarNotificacao('Não consegui preparar essa imagem.');
    try {
        localStorage.setItem(CHAVE_FUNDO, dado);
    } catch (e) {
        return mostrarNotificacao('Não coube no armazenamento do app. Tente uma imagem mais simples.');
    }
    aplicarFundo();
    mostrarNotificacao('Foto de fundo aplicada.', 'info');
}

document.getElementById('btn-escolher-fundo').addEventListener('click', () => {
    document.getElementById('input-arquivo-fundo').click();
});
document.getElementById('input-arquivo-fundo').addEventListener('change', (evento) => {
    const arquivo = evento.target.files && evento.target.files[0];
    evento.target.value = ''; // deixa escolher o mesmo arquivo de novo depois
    if (arquivo) escolherFundo(arquivo);
});
document.getElementById('btn-remover-fundo').addEventListener('click', () => {
    try { localStorage.removeItem(CHAVE_FUNDO); } catch (e) { /* ignora */ }
    aplicarFundo();
    mostrarNotificacao('Foto de fundo removida.', 'info');
});
document.getElementById('slider-fundo-escuro').addEventListener('input', (evento) => {
    ajustesFundo.escuro = Math.round(limitar(evento.target.value, { min: 0, max: 90, padrao: 60 }) / 5) * 5;
    aplicarAjustesFundo();
    salvarAjustesFundo();
});
document.getElementById('slider-fundo-desfoque').addEventListener('input', (evento) => {
    ajustesFundo.desfoque = Math.round(limitar(evento.target.value, { min: 0, max: 20, padrao: 0 }));
    aplicarAjustesFundo();
    salvarAjustesFundo();
});

// Soltar um arquivo na janela fazia o app "navegar" até o arquivo e sumir. Agora é ignorado
// (o processo principal também bloqueia qualquer navegação).
['dragover', 'drop'].forEach((tipo) => document.addEventListener(tipo, (e) => e.preventDefault()));

// ============================================================
// Configurações do usuário (tela cheia, categorias na lateral)
// ============================================================
// Reaproveita os blocos de Vídeo, Visual e Discord que antes ficavam na coluna da direita:
// os elementos são MOVIDOS pra cá (mesmos ids e mesmos eventos), então nada deixa de funcionar.
(function moverSecoesParaConfig() {
    const destino = (id) => document.getElementById(id);
    const video = document.querySelectorAll('#aba-video > .secao-config');
    if (video[0]) destino('cfg-painel-video').appendChild(video[0]); // tamanho na tela
    if (video[1]) destino('cfg-painel-video').appendChild(video[1]); // qualidade do que envia
    if (video[2]) destino('cfg-painel-discord').appendChild(video[2]); // Discord
    // Privacidade: perfil privado e registrar jogo, prévia de links e, por último, "Seus dados" (que já está lá no HTML).
    const dados = destino('cfg-grupo-dados');
    if (video[4]) destino('cfg-painel-privacidade').insertBefore(video[4], dados); // Perfil e estatísticas
    if (video[3]) destino('cfg-painel-privacidade').insertBefore(video[3], dados); // Mensagens (prévia de links)
    // Janela flutuante ganhou aba própria: leva o conteúdo (mesmos ids) e tira a caixa que abria/fechava.
    const grupoFlutuante = document.getElementById('grupo-flutuante');
    if (grupoFlutuante) {
        [...grupoFlutuante.children].filter((c) => c.tagName !== 'SUMMARY').forEach((c) => destino('cfg-painel-flutuante').appendChild(c));
        grupoFlutuante.remove();
    }
    // "Sons do app" tem aba própria: leva o conteúdo (mesmos ids) e tira a caixa que abria/fechava.
    const grupoSons = document.getElementById('grupo-sons');
    if (grupoSons) {
        const conteudoSons = grupoSons.querySelector(':scope > .secao-config');
        if (conteudoSons) destino('cfg-painel-som').appendChild(conteudoSons);
        grupoSons.remove();
    }
    document.querySelectorAll('#aba-visual > .grupo-config, #aba-visual > .secao-config').forEach((el) => destino('cfg-painel-aparencia').appendChild(el));
})();

// ---------- Anotar na tela transmitida ----------
// Caneta e seta que todo mundo da chamada vê sobre a transmissão e que somem sozinhas em alguns segundos.
// As posições vão de 0 a 1 em relação à imagem, então batem em qualquer tamanho de janela (regras em desenho.js).
const desenhos = window.Desenho.criarRegistro();
let quadroDesenhoAtivo = 0;
function iniciarLoopDesenho() {
    if (quadroDesenhoAtivo) return;
    const dpr = window.devicePixelRatio || 1;
    const quadro = () => {
        quadroDesenhoAtivo = 0;
        const agora = Date.now();
        let algum = false;
        document.querySelectorAll('canvas.canvas-desenho').forEach((cv) => {
            const w = cv.clientWidth, h = cv.clientHeight;
            if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
            const ctx = cv.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            const alvo = cv.dataset.alvo, origem = cv.dataset.origem;
            const video = cv.parentElement && cv.parentElement.querySelector('video');
            const ret = window.Desenho.retanguloDaImagem(w, h, video ? video.videoWidth : 0, video ? video.videoHeight : 0);
            const ativos = desenhos.ativos(alvo, origem, agora);
            if (ativos.length) algum = true;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ativos.forEach((t) => {
                const pts = [];
                for (let i = 0; i + 1 < t.pontos.length; i += 2) pts.push(window.Desenho.paraPixels(t.pontos[i], t.pontos[i + 1], ret));
                if (!pts.length) return;
                ctx.globalAlpha = t.alfa;
                const cor = window.Desenho.corDoAutor(t.autor);
                const tracar = (largura, estilo) => {
                    ctx.lineWidth = largura; ctx.strokeStyle = estilo; ctx.fillStyle = estilo;
                    if (t.modo === 'seta' && pts.length >= 2) {
                        const [a, b] = [pts[0], pts[pts.length - 1]];
                        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), cab = 16 + largura;
                        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(b[0], b[1]);
                        ctx.lineTo(b[0] - cab * Math.cos(ang - 0.45), b[1] - cab * Math.sin(ang - 0.45));
                        ctx.lineTo(b[0] - cab * Math.cos(ang + 0.45), b[1] - cab * Math.sin(ang + 0.45));
                        ctx.closePath(); ctx.fill();
                    } else {
                        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
                        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
                        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                        ctx.stroke();
                    }
                };
                tracar(7, 'rgba(0,0,0,0.55)'); // contorno escuro para aparecer em qualquer fundo
                tracar(4, cor);
            });
            ctx.globalAlpha = 1;
        });
        if (algum || desenhos.temAlgo()) quadroDesenhoAtivo = requestAnimationFrame(quadro);
    };
    quadroDesenhoAtivo = requestAnimationFrame(quadro);
}

function ligarDesenhoNoTile(tile, info) {
    const D = window.Desenho;
    const meuId = () => (roomVoz ? roomVoz.localParticipant.identity : '');
    const cv = document.createElement('canvas');
    cv.className = 'canvas-desenho'; cv.dataset.alvo = info.identidade; cv.dataset.origem = info.origem;
    tile.appendChild(cv);

    const barra = document.createElement('div'); barra.className = 'barra-desenho'; barra.style.display = 'none';
    let modo = 'livre';
    const botao = (rotulo, titulo, acao) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = rotulo; b.title = titulo; b.addEventListener('click', (e) => { e.stopPropagation(); acao(b); }); return b; };
    const bLivre = botao('✏️ Livre', 'Desenhar à mão', () => definirModo('livre'));
    const bSeta = botao('↗ Seta', 'Arrastar para apontar com uma seta', () => definirModo('seta'));
    const bLimpar = botao('🧽 Limpar', 'Apaga os seus desenhos para todo mundo', () => {
        desenhos.limpar(info.identidade, info.origem, meuId());
        enviarDesenho({ modo: 'limpar', id: '', pontos: [] });
    });
    const bFechar = botao('✕', 'Sair do modo desenho', () => ligar(false));
    function definirModo(m) { modo = m; bLivre.classList.toggle('ativo', m === 'livre'); bSeta.classList.toggle('ativo', m === 'seta'); }
    barra.append(bLivre, bSeta, bLimpar, bFechar);
    definirModo('livre');
    tile.appendChild(barra);

    const btn = document.createElement('button');
    btn.className = 'btn-tela-cheia desenho'; btn.title = 'Desenhar na transmissão (todos veem)'; btn.textContent = '✏️';
    btn.addEventListener('click', (e) => { e.stopPropagation(); ligar(barra.style.display === 'none'); });
    tile.appendChild(btn);
    function ligar(sim) { barra.style.display = sim ? 'flex' : 'none'; cv.classList.toggle('ativo', sim); btn.classList.toggle('ligado', sim); }

    function enviarDesenho({ modo: m, id, pontos }) {
        if (!vozConectada()) return;
        roomVoz.localParticipant.sendText(D.criarMensagem({ alvo: info.identidade, origem: info.origem, modo: m, id, pontos }), { topic: D.TOPICO }).catch(() => {});
    }

    // Gesto: arrastar com o mouse desenha; os pontos vão em pedaços a cada ~100 ms.
    let traco = null;
    const posicao = (e) => {
        const r = cv.getBoundingClientRect();
        const video = tile.querySelector('video');
        const ret = D.retanguloDaImagem(r.width, r.height, video ? video.videoWidth : 0, video ? video.videoHeight : 0);
        const [nx, ny] = D.paraNormalizado(e.clientX - r.left, e.clientY - r.top, ret);
        return [Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny))];
    };
    const soltarPedaco = (final) => {
        if (!traco) return;
        if (traco.modo === 'seta') {
            enviarDesenho({ modo: 'seta', id: traco.id, pontos: [...traco.inicio, ...traco.atual] });
        } else {
            while (traco.pendentes.length) {
                const pedaco = traco.pendentes.splice(0, D.MAX_PONTOS_MSG - 2);
                enviarDesenho({ modo: 'livre', id: traco.id, pontos: [...traco.ultimoEnviado, ...pedaco] });
                traco.ultimoEnviado = pedaco.slice(-2);
            }
        }
        if (final) { clearInterval(traco.timer); traco = null; }
    };
    cv.addEventListener('pointerdown', (e) => {
        if (!cv.classList.contains('ativo') || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        cv.setPointerCapture(e.pointerId);
        const p = posicao(e);
        const id = Math.random().toString(36).slice(2, 10);
        traco = { id, modo, inicio: p, atual: p, pendentes: [...p], ultimoEnviado: p, timer: setInterval(() => soltarPedaco(false), 100) };
        desenhos.adicionar(info.identidade, info.origem, meuId(), modo, id, modo === 'seta' ? [...p, ...p] : [...p], Date.now());
        iniciarLoopDesenho();
    });
    cv.addEventListener('pointermove', (e) => {
        if (!traco) return;
        const p = posicao(e);
        if (traco.modo === 'seta') {
            traco.atual = p;
            desenhos.adicionar(info.identidade, info.origem, meuId(), 'seta', traco.id, [...traco.inicio, ...p], Date.now());
        } else {
            traco.pendentes.push(...p);
            desenhos.adicionar(info.identidade, info.origem, meuId(), 'livre', traco.id, [...p], Date.now());
        }
        iniciarLoopDesenho();
    });
    const terminar = () => { if (traco) soltarPedaco(true); };
    cv.addEventListener('pointerup', terminar);
    cv.addEventListener('pointercancel', terminar);
    cv.addEventListener('click', (e) => e.stopPropagation());
}

function registrarDesenhoNaSala(sala) {
    sala.registerTextStreamHandler(window.Desenho.TOPICO, async (reader, quem) => {
        if (sala !== roomVoz) return;
        let m = null;
        try { m = window.Desenho.lerMensagem(await reader.readAll()); } catch (e) { return; }
        if (!m || !roomVoz.remoteParticipants.has(quem.identity)) return; // só gente que está na sala
        if (m.modo === 'limpar') desenhos.limpar(m.alvo, m.origem, quem.identity);
        else desenhos.adicionar(m.alvo, m.origem, quem.identity, m.modo, m.id, m.pontos, Date.now());
        iniciarLoopDesenho();
    });
}

// ---------- Sala de cinema sincronizada ----------
// Cada um abre o MESMO arquivo no próprio PC; só mensagens curtas viajam (regras em cinema.js). Quem iniciou controla.
let cinema = null; // { id, papel:'dono'|'convidado', dono, oferta, url, ultimo:{pos,tocando,em}, prontos:Set, timer }
let conviteCinema = null; // { de, oferta }
const elCinema = (id) => document.getElementById(id);

function enviarCinema(tipo, campos, destino) {
    if (!vozConectada()) return;
    const opcoes = { topic: window.Cinema.TOPICO };
    if (destino) opcoes.destinationIdentities = Array.isArray(destino) ? destino : [destino];
    roomVoz.localParticipant.sendText(window.Cinema.criarMensagem(tipo, campos), opcoes).catch(() => {});
}
function atualizarBotaoCinema() { elCinema('btn-cinema-rodape').classList.toggle('ativo', !!cinema); }
function atualizarTempoCinema() {
    const v = elCinema('cinema-video');
    elCinema('cinema-tempo').textContent = `${window.Cinema.formatarTempo(v.currentTime)} / ${window.Cinema.formatarTempo(v.duration)}`;
    if (v.duration > 0 && document.activeElement !== elCinema('cinema-seek')) elCinema('cinema-seek').value = String(Math.round(v.currentTime / v.duration * 1000));
    elCinema('cinema-play').textContent = v.paused ? '▶' : '⏸';
}
function atualizarStatusCinema() {
    if (!cinema) return;
    if (cinema.papel === 'dono') {
        const total = roomVoz && roomVoz.remoteParticipants ? roomVoz.remoteParticipants.size : 0;
        elCinema('cinema-status').textContent = total ? `Prontos: ${cinema.prontos.size} de ${total}` : 'Ninguém mais na chamada';
    } else {
        elCinema('cinema-status').textContent = `Quem controla: ${nomeDeParticipante(cinema.dono)}`;
    }
}
function estadoDoDono() {
    const v = elCinema('cinema-video');
    enviarCinema('estado', { id: cinema.id, pos: v.currentTime, tocando: !v.paused && !v.ended });
}
function abrirSalaCinema() {
    if (!cinema) return;
    const dono = cinema.papel === 'dono';
    const sala = elCinema('cinema-sala');
    sala.classList.toggle('convidado', !dono);
    elCinema('cinema-titulo').textContent = '🎬 ' + cinema.oferta.nome;
    elCinema('cinema-fechar').textContent = dono ? 'Encerrar para todos' : 'Sair da sala';
    sala.style.display = 'flex';
    atualizarStatusCinema(); atualizarTempoCinema();
}
function carregarVideoLocal(arquivo) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(arquivo);
        const v = elCinema('cinema-video');
        const limpar = () => { v.onloadedmetadata = null; v.onerror = null; clearTimeout(t); };
        const t = setTimeout(() => { limpar(); URL.revokeObjectURL(url); reject(new Error('demorou demais para abrir o vídeo')); }, 15000);
        v.onloadedmetadata = () => { limpar(); resolve({ url, duracao: v.duration }); };
        v.onerror = () => { limpar(); URL.revokeObjectURL(url); reject(new Error('o app não consegue tocar este formato de vídeo (use mp4 com H.264, ou webm)')); };
        v.src = url;
    });
}
function ligarVideoCinema() {
    const v = elCinema('cinema-video');
    v.volume = Number(elCinema('cinema-volume').value) / 100;
    ['timeupdate', 'pause', 'play', 'seeked'].forEach((ev) => v.addEventListener(ev, atualizarTempoCinema));
    ['play', 'pause', 'seeked'].forEach((ev) => v.addEventListener(ev, () => { if (cinema && cinema.papel === 'dono') estadoDoDono(); }));
}
ligarVideoCinema();

async function iniciarCinema(arquivo) {
    const C = window.Cinema;
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    if (cinema) { abrirSalaCinema(); return; }
    if (!C.extensaoOk(arquivo.name)) return mostrarNotificacao('Escolha um vídeo (mp4, webm, mkv, mov...).');
    try {
        const { url, duracao } = await carregarVideoLocal(arquivo);
        if (!vozConectada()) { URL.revokeObjectURL(url); return; }
        const oferta = { nome: arquivo.name, tamanho: arquivo.size, duracao: Math.round(duracao * 10) / 10 };
        cinema = { id: C.novoId(), papel: 'dono', dono: roomVoz.localParticipant.identity, oferta, url, ultimo: null, prontos: new Set(), timer: null };
        enviarCinema('oferta', { id: cinema.id, ...oferta });
        cinema.timer = setInterval(() => { if (cinema) { estadoDoDono(); atualizarStatusCinema(); } }, 2000);
        atualizarBotaoCinema(); abrirSalaCinema();
    } catch (err) { mostrarNotificacao('Não consegui abrir o vídeo: ' + err.message); }
}
async function entrarNoCinema(arquivo) {
    const C = window.Cinema;
    const convite = conviteCinema;
    if (!convite || cinema) return;
    try {
        const { url, duracao } = await carregarVideoLocal(arquivo);
        const r = C.arquivoCombina(convite.oferta, { nome: arquivo.name, tamanho: arquivo.size }, duracao);
        if (!r.ok) { URL.revokeObjectURL(url); elCinema('cinema-video').removeAttribute('src'); return mostrarNotificacao(r.motivo); }
        if (!vozConectada() || !roomVoz.remoteParticipants.has(convite.de)) { URL.revokeObjectURL(url); return mostrarNotificacao('A sessão de cinema já acabou.'); }
        cinema = { id: convite.oferta.id, papel: 'convidado', dono: convite.de, oferta: convite.oferta, url, ultimo: null, prontos: new Set(), timer: null };
        conviteCinema = null; elCinema('cinema-convite').style.display = 'none';
        enviarCinema('pronto', { id: cinema.id }, convite.de);
        atualizarBotaoCinema(); abrirSalaCinema();
        if (r.nomeDiferente) mostrarNotificacao('O nome do arquivo é diferente, mas o tamanho e a duração batem. Tudo certo!', 'info');
    } catch (err) { mostrarNotificacao('Não consegui abrir o vídeo: ' + err.message); }
}
function aplicarEstadoCinema(est) {
    const v = elCinema('cinema-video');
    const desde = Date.now() - est.em;
    const a = window.Cinema.ajuste({ pos: v.currentTime, tocando: !v.paused }, { pos: est.pos, tocando: est.tocando }, desde);
    if (a.seek !== null) v.currentTime = Math.min(Math.max(0, a.seek), v.duration || a.seek);
    if (v.playbackRate !== a.taxa) v.playbackRate = a.taxa;
    if (a.tocando && v.paused) v.play().catch(() => {});
    if (!a.tocando && !v.paused) v.pause();
}
function encerrarCinemaLocal() {
    if (cinema) {
        if (cinema.timer) clearInterval(cinema.timer);
        try { URL.revokeObjectURL(cinema.url); } catch (e) { /* ok */ }
    }
    cinema = null; conviteCinema = null;
    const v = elCinema('cinema-video');
    try { v.pause(); } catch (e) { /* ok */ }
    v.removeAttribute('src'); v.playbackRate = 1; try { v.load(); } catch (e) { /* ok */ }
    elCinema('cinema-sala').style.display = 'none';
    elCinema('cinema-convite').style.display = 'none';
    atualizarBotaoCinema();
}
function registrarCinemaNaSala(sala) {
    sala.registerTextStreamHandler(window.Cinema.TOPICO, async (reader, quem) => {
        if (sala !== roomVoz) return;
        let m = null;
        try { m = window.Cinema.lerMensagem(await reader.readAll()); } catch (e) { return; }
        if (!m || !roomVoz.remoteParticipants.has(quem.identity)) return; // só gente que está na sala
        if (m.t === 'oferta') {
            if (cinema || conviteCinema) return; // já está numa sessão ou com um convite aberto
            conviteCinema = { de: quem.identity, oferta: m };
            elCinema('cinema-convite-texto').textContent = `🎬 ${nomeDeParticipante(quem.identity)} quer assistir "${m.nome}" (${formatarTamanhoArquivo(m.tamanho)}, ${window.Cinema.formatarTempo(m.duracao)}) com você. Você precisa ter o mesmo arquivo no seu computador.`;
            elCinema('cinema-convite').style.display = 'block';
            tocarSomApp('mensagem');
        } else if (!cinema || m.id !== cinema.id) {
            return;
        } else if (m.t === 'pronto' && cinema.papel === 'dono') {
            cinema.prontos.add(quem.identity); atualizarStatusCinema();
            estadoDoDono(); // quem acabou de entrar já se alinha
        } else if (m.t === 'estado' && cinema.papel === 'convidado' && quem.identity === cinema.dono) {
            cinema.ultimo = { pos: m.pos, tocando: m.tocando, em: Date.now() };
            aplicarEstadoCinema(cinema.ultimo);
        } else if (m.t === 'fim' && cinema.papel === 'convidado' && quem.identity === cinema.dono) {
            encerrarCinemaLocal();
            mostrarNotificacao('A sessão de cinema foi encerrada.', 'info');
        }
    });
}
function aoEntrarParticipanteCinema(p) {
    // Quem entra na chamada depois do começo também recebe o convite.
    if (cinema && cinema.papel === 'dono' && p && p.identity) enviarCinema('oferta', { id: cinema.id, ...cinema.oferta }, p.identity);
}
function aoSairParticipanteCinema(identidade) {
    if (!identidade) return;
    if (cinema) {
        if (cinema.papel === 'convidado' && cinema.dono === identidade) { encerrarCinemaLocal(); mostrarNotificacao('Quem controlava o cinema saiu da chamada. A sessão acabou.', 'info'); }
        else if (cinema.papel === 'dono') { cinema.prontos.delete(identidade); atualizarStatusCinema(); }
    } else if (conviteCinema && conviteCinema.de === identidade) { conviteCinema = null; elCinema('cinema-convite').style.display = 'none'; }
}
function formatarTamanhoArquivo(bytes) { return window.Arquivos.formatarTamanho(bytes); }

elCinema('btn-cinema-rodape').addEventListener('click', () => {
    if (cinema) return abrirSalaCinema();
    if (!vozConectada()) return mostrarNotificacao('Entre num canal de voz primeiro.');
    elCinema('entrada-cinema').click();
});
elCinema('entrada-cinema').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) iniciarCinema(f); });
elCinema('cinema-convite-ok').addEventListener('click', () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/*,.mkv,.mp4,.webm,.m4v,.mov,.ogv'; i.addEventListener('change', () => { const f = i.files && i.files[0]; if (f) entrarNoCinema(f); }); i.click(); });
elCinema('cinema-convite-nao').addEventListener('click', () => { conviteCinema = null; elCinema('cinema-convite').style.display = 'none'; });
elCinema('cinema-minimizar').addEventListener('click', () => { elCinema('cinema-sala').style.display = 'none'; });
elCinema('cinema-fechar').addEventListener('click', () => {
    if (!cinema) return encerrarCinemaLocal();
    if (cinema.papel === 'dono') enviarCinema('fim', { id: cinema.id });
    encerrarCinemaLocal();
});
elCinema('cinema-play').addEventListener('click', () => {
    if (!cinema || cinema.papel !== 'dono') return;
    const v = elCinema('cinema-video');
    if (v.paused) v.play().catch(() => {}); else v.pause();
});
elCinema('cinema-seek').addEventListener('input', () => {
    if (!cinema || cinema.papel !== 'dono') return;
    const v = elCinema('cinema-video');
    if (v.duration > 0) v.currentTime = Number(elCinema('cinema-seek').value) / 1000 * v.duration;
});
elCinema('cinema-volume').addEventListener('input', () => { elCinema('cinema-video').volume = Number(elCinema('cinema-volume').value) / 100; });
elCinema('cinema-tela-cheia').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else elCinema('cinema-sala').requestFullscreen().catch(() => {});
});
elCinema('cinema-sala').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.fullscreenElement) elCinema('cinema-sala').style.display = 'none'; });

// ---------- Quem está vendo a minha transmissão ----------
// Quem assiste manda uma mensagem curta a quem transmite; o selo verde mostra os nomes (regras em espectadores.js).
const espectadores = window.Espectadores.criarRegistro();
function avisarQueEstouVendo(acao, identidadeDoQueTransmite, origem) {
    if (!vozConectada() || !identidadeDoQueTransmite) return;
    roomVoz.localParticipant.sendText(window.Espectadores.criarMensagem(acao, origem), { topic: window.Espectadores.TOPICO, destinationIdentities: [identidadeDoQueTransmite] }).catch(() => {});
}
function atualizarChipEspectadores() {
    const chip = document.getElementById('chip-espectadores');
    if (!chip) return;
    const nomes = espectadores.nomes();
    chip.style.display = nomes.length ? 'inline-flex' : 'none';
    chip.textContent = nomes.length ? '👁 ' + window.Espectadores.resumo(nomes) + (nomes.length === 1 ? ' está vendo' : ' estão vendo') : '';
    chip.title = nomes.length ? 'Vendo a sua transmissão: ' + nomes.join(', ') : '';
}
function tirarEspectador(identidade) { if (identidade) { espectadores.removerPessoa(identidade); atualizarChipEspectadores(); } }
function registrarEspectadoresNaSala(sala) {
    sala.registerTextStreamHandler(window.Espectadores.TOPICO, async (reader, quem) => {
        if (sala !== roomVoz) return;
        let m = null;
        try { m = window.Espectadores.lerMensagem(await reader.readAll()); } catch (e) { return; }
        if (!m || !roomVoz.remoteParticipants.has(quem.identity)) return; // só gente que está na sala
        if (m.acao === 'entrou') espectadores.entrou(quem.identity, nomeDeParticipante(quem.identity), m.origem);
        else espectadores.saiu(quem.identity, m.origem);
        atualizarChipEspectadores();
    });
}

// ---------- Arquivos pela chamada ----------
// Quem envia manda uma OFERTA; cada pessoa aceita ou recusa; só então o arquivo vai, e só pra quem aceitou.
// As regras (limite, nome seguro, formato das mensagens) ficam em arquivos.js.
const enviosArquivos = new Map();      // id -> { arquivo, resolvidos:Set, aceitantes:[], recusaram:[], card }
const ofertasArquivos = new Map();     // id -> { de, oferta, card, timer }
const arquivosEsperados = new Map();   // "identidade|nomeOriginal" -> id (só recebe o que a pessoa aceitou)
const urlsArquivos = new Set();

function nomeDeParticipante(identidade) {
    const p = roomVoz && roomVoz.remoteParticipants && roomVoz.remoteParticipants.get(identidade);
    return (p && p.name) || identidade || 'Alguém';
}
// Cartão na tela. Todo texto entra por textContent (nome de arquivo e de pessoa vêm de fora).
function criarCartaoArquivo(titulo) {
    const raiz = document.createElement('div'); raiz.className = 'cartao-arquivo';
    const t = document.createElement('div'); t.className = 'ca-titulo'; t.textContent = titulo;
    const info = document.createElement('div'); info.className = 'ca-info';
    const aviso = document.createElement('div'); aviso.className = 'ca-aviso'; aviso.style.display = 'none';
    const barra = document.createElement('div'); barra.className = 'ca-barra'; const preench = document.createElement('div'); barra.appendChild(preench);
    const botoes = document.createElement('div'); botoes.className = 'ca-botoes';
    raiz.append(t, info, aviso, barra, botoes);
    document.getElementById('painel-arquivos').appendChild(raiz);
    return {
        raiz,
        info(texto) { info.textContent = texto; },
        aviso(texto) { aviso.textContent = texto; aviso.style.display = texto ? '' : 'none'; },
        progresso(frac) { barra.style.display = frac == null ? 'none' : 'block'; if (frac != null) preench.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; },
        botoes(lista) { botoes.replaceChildren(...lista.map(([rotulo, acao]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = rotulo; b.addEventListener('click', acao); return b; })); },
        remover() { raiz.remove(); }
    };
}
function fecharCartaoDepois(card, ms) { setTimeout(() => card.remover(), ms); }

async function oferecerArquivos(lista) {
    if (!vozConectada()) { mostrarNotificacao('Entre num canal de voz para enviar arquivos.'); return; }
    if (!roomVoz.remoteParticipants.size) { mostrarNotificacao('Não tem mais ninguém na chamada para receber.'); return; }
    for (const arquivo of Array.from(lista)) {
        const problema = window.Arquivos.problemaNoEnvio(arquivo);
        if (problema) { mostrarNotificacao(window.Arquivos.nomeSeguro(arquivo && arquivo.name) + ': ' + problema); continue; }
        const id = window.Arquivos.novoId();
        const nome = window.Arquivos.nomeSeguro(arquivo.name);
        const card = criarCartaoArquivo('📤 ' + nome);
        card.info(window.Arquivos.formatarTamanho(arquivo.size) + ' — esperando alguém aceitar…');
        const envio = { arquivo, resolvidos: new Set(), aceitantes: [], recusaram: [], enviados: [], falhas: [], andamento: '', card };
        enviosArquivos.set(id, envio);
        card.botoes([['Cancelar', () => { enviosArquivos.delete(id); card.remover(); }]]);
        try {
            await roomVoz.localParticipant.sendText(window.Arquivos.criarOferta({ id, nome: arquivo.name, tamanho: arquivo.size, tipo: arquivo.type }), { topic: window.Arquivos.TOPICOS.oferta });
        } catch (err) { enviosArquivos.delete(id); card.remover(); mostrarNotificacao('Não consegui enviar a oferta: ' + err.message); continue; }
        setTimeout(() => { // ninguém respondeu em 2 minutos
            const e = enviosArquivos.get(id);
            if (e && !e.aceitantes.length) { enviosArquivos.delete(id); card.info('Ninguém aceitou.'); card.botoes([]); fecharCartaoDepois(card, 4000); }
        }, 120000);
    }
}

// Resumo do envio no cartão: o que está indo, o que já foi, quem recusou e o que falhou.
function atualizarCartaoEnvio(envio) {
    const partes = [];
    if (envio.andamento) partes.push(envio.andamento);
    if (envio.enviados.length) partes.push('Enviado para: ' + envio.enviados.join(', '));
    if (envio.recusaram.length) partes.push('Recusado por: ' + envio.recusaram.join(', '));
    if (envio.falhas.length) partes.push('Falhou para: ' + envio.falhas.join(', '));
    envio.card.info(partes.join(' · '));
}

// Alguém respondeu a uma oferta minha: se aceitou, mando o arquivo só pra essa pessoa.
async function aoReceberRespostaArquivo(reader, quem) {
    let r = null;
    try { r = window.Arquivos.lerResposta(await reader.readAll()); } catch (e) { return; }
    const envio = r && enviosArquivos.get(r.id);
    if (!envio || envio.resolvidos.has(quem.identity)) return;
    envio.resolvidos.add(quem.identity);
    const nome = nomeDeParticipante(quem.identity);
    if (!r.aceito) { envio.recusaram.push(nome); atualizarCartaoEnvio(envio); return; }
    envio.aceitantes.push(nome);
    const card = envio.card;
    card.botoes([]);
    card.progresso(0);
    envio.andamento = 'Enviando para ' + nome + '…'; atualizarCartaoEnvio(envio);
    try {
        await roomVoz.localParticipant.sendFile(envio.arquivo, {
            topic: window.Arquivos.TOPICOS.arquivo, mimeType: envio.arquivo.type || 'application/octet-stream',
            destinationIdentities: [quem.identity], onProgress: (p) => { card.progresso(p); envio.andamento = 'Enviando para ' + nome + '… ' + Math.round(p * 100) + '%'; atualizarCartaoEnvio(envio); }
        });
        envio.enviados.push(nome); envio.andamento = '';
        card.progresso(1); atualizarCartaoEnvio(envio);
        fecharCartaoDepois(card, 8000);
    } catch (err) { envio.falhas.push(nome); envio.andamento = ''; card.progresso(null); atualizarCartaoEnvio(envio); mostrarNotificacao('Falhou o envio para ' + nome + ': ' + err.message); }
}

// Alguém me ofereceu um arquivo.
async function aoReceberOfertaArquivo(reader, quem) {
    let oferta = null;
    try { oferta = window.Arquivos.lerOferta(await reader.readAll()); } catch (e) { return; }
    if (!oferta || !vozConectada() || quem.identity === roomVoz.localParticipant.identity) return;
    const responder = (aceito) => roomVoz.localParticipant.sendText(window.Arquivos.criarResposta(oferta.id, aceito), { topic: window.Arquivos.TOPICOS.resposta, destinationIdentities: [quem.identity] }).catch(() => {});
    if (ofertasArquivos.has(oferta.id) || ofertasArquivos.size >= window.Arquivos.MAX_OFERTAS_PENDENTES) { responder(false); return; }
    const de = nomeDeParticipante(quem.identity);
    const card = criarCartaoArquivo('📥 ' + oferta.nome);
    card.info(de + ' quer te enviar este arquivo (' + window.Arquivos.formatarTamanho(oferta.tamanho) + ').');
    if (window.Arquivos.extensaoPerigosa(oferta.nome)) card.aviso('⚠️ Este tipo de arquivo roda programas. Só aceite se você confia em ' + de + '.');
    const item = { de: quem.identity, oferta, card, timer: null };
    ofertasArquivos.set(oferta.id, item);
    const encerrar = () => { clearTimeout(item.timer); ofertasArquivos.delete(oferta.id); arquivosEsperados.delete(quem.identity + '|' + oferta.nomeOriginal); };
    const recusar = () => { responder(false); encerrar(); card.remover(); };
    item.timer = setTimeout(() => { if (ofertasArquivos.has(oferta.id) && !item.aceita) recusar(); }, 120000);
    card.botoes([['Aceitar', () => {
        item.aceita = true;
        arquivosEsperados.set(quem.identity + '|' + oferta.nomeOriginal, oferta.id);
        card.botoes([['Cancelar', () => { recusar(); }]]);
        card.info('Esperando o arquivo de ' + de + '…');
        responder(true);
    }], ['Recusar', recusar]]);
    tocarSomApp('mensagem');
    avisarFlutuante(de + ' quer te enviar um arquivo');
}

// Chegou o arquivo em si. Só é aceito se a pessoa tiver clicado em "Aceitar" para esse arquivo.
async function aoReceberArquivo(reader, quem) {
    const chave = quem.identity + '|' + reader.info.name;
    const id = arquivosEsperados.get(chave);
    const item = id && ofertasArquivos.get(id);
    if (!item) { reader.readAll({ signal: AbortSignal.abort() }).catch(() => {}); return; }
    arquivosEsperados.delete(chave);
    clearTimeout(item.timer);
    const { oferta, card } = item;
    const pedacos = []; let total = 0;
    try {
        card.progresso(0);
        for await (const pedaco of reader) {
            total += pedaco.length;
            if (total > oferta.tamanho) throw new Error('o arquivo é maior do que foi combinado');
            pedacos.push(pedaco);
            const p = oferta.tamanho ? total / oferta.tamanho : 1;
            card.progresso(p); card.info('Recebendo… ' + Math.round(p * 100) + '%');
        }
        if (total !== oferta.tamanho) throw new Error('o arquivo chegou incompleto');
    } catch (err) {
        ofertasArquivos.delete(oferta.id);
        card.progresso(null); card.info('Falhou o recebimento: ' + err.message); card.botoes([['Fechar', () => card.remover()]]);
        return;
    }
    const url = URL.createObjectURL(new Blob(pedacos, { type: 'application/octet-stream' }));
    urlsArquivos.add(url);
    card.progresso(1);
    card.info('Pronto: ' + window.Arquivos.formatarTamanho(total) + '. Nada foi aberto — clique em Salvar para escolher onde guardar.');
    const fechar = () => { URL.revokeObjectURL(url); urlsArquivos.delete(url); ofertasArquivos.delete(oferta.id); card.remover(); };
    card.botoes([['💾 Salvar', () => {
        const a = document.createElement('a'); a.href = url; a.download = oferta.nome; document.body.appendChild(a); a.click(); a.remove();
    }], ['Fechar', fechar]]);
}

function registrarArquivosNaSala(sala) {
    const T = window.Arquivos.TOPICOS;
    sala.registerTextStreamHandler(T.oferta, (r, q) => (sala === roomVoz ? aoReceberOfertaArquivo(r, q) : undefined));
    sala.registerTextStreamHandler(T.resposta, (r, q) => (sala === roomVoz ? aoReceberRespostaArquivo(r, q) : undefined));
    sala.registerByteStreamHandler(T.arquivo, (r, q) => (sala === roomVoz ? aoReceberArquivo(r, q) : undefined));
}
function limparArquivosDaChamada() {
    ofertasArquivos.forEach((o) => clearTimeout(o.timer));
    enviosArquivos.clear(); ofertasArquivos.clear(); arquivosEsperados.clear();
    urlsArquivos.forEach((u) => URL.revokeObjectURL(u)); urlsArquivos.clear();
    document.getElementById('painel-arquivos').replaceChildren();
}
// Quem ofereceu saiu da chamada: tira o cartão que não vai mais funcionar.
function aoSairParticipanteArquivos(identidade) {
    ofertasArquivos.forEach((o, id) => { if (o.de === identidade && !o.aceita) { clearTimeout(o.timer); ofertasArquivos.delete(id); o.card.remover(); } });
}

document.getElementById('btn-arquivo-rodape').addEventListener('click', () => document.getElementById('entrada-arquivo').click());
document.getElementById('entrada-arquivo').addEventListener('change', (e) => { const l = Array.from(e.target.files || []); e.target.value = ''; if (l.length) oferecerArquivos(l); });
// Arrastar arquivo para a janela: sempre impede o Electron de abrir o arquivo no lugar do app.
const temArquivoNoArrasto = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragover', (e) => { if (!temArquivoNoArrasto(e)) return; e.preventDefault(); if (vozConectada()) document.body.classList.add('arrastando-arquivo'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('arrastando-arquivo'); });
document.addEventListener('drop', (e) => {
    if (!temArquivoNoArrasto(e)) return;
    e.preventDefault(); document.body.classList.remove('arrastando-arquivo');
    if (vozConectada()) oferecerArquivos(e.dataTransfer.files);
    else mostrarNotificacao('Entre num canal de voz para enviar arquivos.');
});

// ---------- O que há de novo ----------
// Aparece uma vez depois de cada atualização. Os textos ficam em novidades.js (só texto, sempre via textContent).
const CHAVE_NOVIDADE_VISTA = 'estrivisor_novidade_vista';
let versaoDoApp = '';
function renderizarNovidades(lista) {
    const corpo = document.getElementById('novidades-corpo');
    corpo.replaceChildren();
    const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; };
    // Resumido: só as primeiras novidades da versão mais nova aparecem; o resto fica atrás de "Ver tudo".
    const VISIVEIS = 4;
    let escondidas = 0;
    lista.forEach((n, iv) => {
        const extraVersao = iv > 0;
        const cab = [el('div', 'nov-versao', 'VERSÃO ' + n.versao), el('div', 'nov-resumo', n.titulo)];
        cab.forEach((c) => { if (extraVersao) c.classList.add('novidades-extra'); corpo.appendChild(c); });
        n.itens.forEach((it, ii) => {
            const linha = el('div', 'nov-item');
            const txt = el('div');
            txt.append(el('b', '', it.t), el('div', 'nov-desc', it.d), el('div', 'nov-como', '📍 ' + it.c));
            linha.append(el('div', 'nov-icone', it.i), txt);
            if (extraVersao || ii >= VISIVEIS) { linha.classList.add('novidades-extra'); escondidas++; }
            corpo.appendChild(linha);
        });
    });
    corpo.classList.toggle('resumido', escondidas > 0);
    if (escondidas > 0) {
        const botao = el('button', 'novidades-ver-tudo', `Ver tudo (mais ${escondidas} novidade${escondidas > 1 ? 's' : ''})`);
        botao.type = 'button';
        botao.addEventListener('click', () => { corpo.classList.remove('resumido'); botao.remove(); });
        corpo.appendChild(botao);
    }
}
function abrirNovidades(lista) {
    if (!lista || !lista.length) return;
    renderizarNovidades(lista);
    document.getElementById('tela-novidades').style.display = 'flex';
}
function fecharNovidades() {
    document.getElementById('tela-novidades').style.display = 'none';
    if (versaoDoApp) { try { localStorage.setItem(CHAVE_NOVIDADE_VISTA, versaoDoApp); } catch (e) {} }
}
document.getElementById('novidades-fechar').addEventListener('click', fecharNovidades);
document.getElementById('tela-novidades').addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharNovidades(); });
document.getElementById('cfg-ver-novidades').addEventListener('click', () => {
    window.electronAPI.versaoApp().then((v) => {
        const todas = window.Novidades.NOVIDADES.filter((n) => window.Novidades.compararVersoes(n.versao, v) <= 0).slice(0, 3);
        abrirNovidades(todas.length ? todas : window.Novidades.NOVIDADES.slice(0, 1));
    }).catch(() => abrirNovidades(window.Novidades.NOVIDADES.slice(0, 1)));
});
// Depois de entrar (sem nenhuma tela de login/termos aberta), mostra o que mudou desde a última vez.
(async function mostrarNovidadesAposAtualizar() {
    try { versaoDoApp = await window.electronAPI.versaoApp(); } catch (e) { return; }
    if (!versaoDoApp) return;
    let vista = null;
    try { vista = localStorage.getItem(CHAVE_NOVIDADE_VISTA); } catch (e) {}
    const lista = window.Novidades.novidadesParaMostrar(vista, versaoDoApp);
    if (!lista.length) { if (vista !== versaoDoApp) { try { localStorage.setItem(CHAVE_NOVIDADE_VISTA, versaoDoApp); } catch (e) {} } return; }
    let tentativas = 0;
    const espera = setInterval(() => {
        const telaAberta = Array.from(document.querySelectorAll('.tela-login')).some((t) => t.id !== 'tela-novidades' && getComputedStyle(t).display !== 'none');
        if (++tentativas > 120) return clearInterval(espera); // desiste depois de ~4 min
        if (telaAberta || (!servidorAtual.id && tentativas < 10)) return; // quem não tem servidor espera ~20 s e vê assim mesmo
        clearInterval(espera);
        abrirNovidades(lista);
    }, 2000);
})();

// ---------- Preferências de áudio (guardadas só neste PC) ----------
// ---------- Efeitos de voz criados pela pessoa ----------
// Guardados só neste PC: { id, nome, perfil }. "perfil" são números (tom, timbre, robô, eco...), conferidos por Ruido.perfilDeVoz.
// Efeitos antigos (criados a partir de uma gravação, só tom + timbre) continuam valendo e podem ser editados.
const CHAVE_VOZES_CRIADAS = 'estrivisor_vozes_criadas';
const MAX_VOZES_CRIADAS = 12;
function vozesCriadas() {
    let lista = [];
    try { lista = JSON.parse(localStorage.getItem(CHAVE_VOZES_CRIADAS) || '[]'); } catch (e) { lista = []; }
    if (!Array.isArray(lista)) return [];
    return lista.filter((v) => v && /^voz:[a-z0-9]{6,12}$/.test(v.id) && typeof v.nome === 'string')
        .map((v) => ({ id: v.id, nome: v.nome.slice(0, 24), perfil: window.Ruido.perfilDeVoz(v.perfil), painel: painelValido(v.painel) })).filter((v) => v.perfil).slice(0, MAX_VOZES_CRIADAS);
}
// Só a posição dos botões do editor (não muda o som): números dentro dos limites e nomes de pedais conhecidos.
function painelValido(p) {
    if (!p || typeof p !== 'object') return null;
    const AJ = window.Ruido.AJUSTES_EFEITO, valores = {};
    if (p.valores && typeof p.valores === 'object') for (const [k, [min, max]] of Object.entries(AJ)) { const n = Number(p.valores[k]); if (Number.isFinite(n)) valores[k] = Math.min(max, Math.max(min, n)); }
    const ids = ['tom', 'eq', 'filtros', 'robo', 'dist', 'vib', 'trem', 'eco', 'amb'];
    const desligados = Array.isArray(p.desligados) ? p.desligados.filter((d) => ids.includes(d)) : [];
    return { valores, desligados };
}
function salvarVozesCriadas(lista) { try { localStorage.setItem(CHAVE_VOZES_CRIADAS, JSON.stringify(lista)); } catch (e) { mostrarNotificacao('Não consegui guardar o efeito neste computador.'); } }
function vozCriadaPorId(id) { return typeof id === 'string' && id.startsWith('voz:') ? (vozesCriadas().find((v) => v.id === id) || null) : null; }
let efeitoEmEdicao = null; // rascunho do editor: só o teste do microfone usa (nunca vai pra chamada)
function nomeDoEfeito(id) {
    if (window.Ruido.EFEITOS[id]) return window.Ruido.EFEITOS[id].nome;
    const v = vozCriadaPorId(id);
    return v ? '🎭 ' + v.nome : 'efeito';
}
// Põe as vozes criadas no seletor de efeitos e a lista (com o botão de apagar) logo abaixo.
function popularEfeitosCriados() {
    const sel = document.getElementById('cfg-efeito-voz');
    sel.querySelectorAll('optgroup').forEach((g) => g.remove());
    const lista = vozesCriadas();
    if (lista.length) {
        const g = document.createElement('optgroup'); g.label = 'Minhas vozes';
        lista.forEach((v) => { const o = document.createElement('option'); o.value = v.id; o.textContent = '🎭 ' + v.nome; g.appendChild(o); });
        sel.appendChild(g);
    }
    const area = document.getElementById('vozes-criadas');
    area.replaceChildren();
    lista.forEach((v) => {
        const linha = document.createElement('div'); linha.className = 'voz-criada';
        const nome = document.createElement('span'); nome.textContent = '🎭 ' + v.nome;
        const editar = document.createElement('button'); editar.type = 'button'; editar.textContent = '✏️'; editar.title = 'Editar este efeito';
        editar.setAttribute('aria-label', 'Editar o efeito ' + v.nome);
        editar.addEventListener('click', () => abrirEditorEfeito(v.id));
        const apagar = document.createElement('button'); apagar.type = 'button'; apagar.textContent = '🗑️'; apagar.title = 'Apagar este efeito';
        apagar.setAttribute('aria-label', 'Apagar o efeito ' + v.nome);
        apagar.addEventListener('click', async () => {
            const r = await pedirTexto({ titulo: 'Apagar o efeito "' + v.nome + '"?', dica: 'Só some deste computador.', semCampo: true, rotuloOk: 'Apagar' });
            if (!r) return;
            salvarVozesCriadas(vozesCriadas().filter((x) => x.id !== v.id));
            if (prefsAudio.efeito === v.id) { prefsAudio.efeito = 'nenhum'; atualizarFiltroRuidoAoVivo(); }
            popularEfeitosCriados();
            sel.value = prefsAudio.efeito;
        });
        linha.append(nome, editar, apagar);
        area.appendChild(linha);
    });
}

// ---------- Editor de efeito de voz (Configurações > Voz > Criar efeito) ----------
// Montado como uma pedaleira: cada pedal é um efeito (liga/desliga) com botões de girar. Enquanto edita, só o
// "Ouvir com meu microfone" usa o rascunho; a chamada continua com o efeito escolhido. Ao salvar, o efeito
// entra na lista e já fica escolhido. O monitor desenha o som que sai do efeito (o que os outros ouviriam).
const FMT = {
    db: (v) => (v > 0 ? '+' : '') + String(v).replace('.', ',') + ' dB',
    pct: (v) => Math.round(v) + '%',
    hz: (v) => v.toFixed(1).replace('.', ',') + ' Hz'
};
// [chave, rótulo no botão, passo, formatar, explicação]
const BOTOES_EFEITO = {
    tom: ['Tom', 0.5, (v) => (v > 0 ? '+' : '') + String(v).replace('.', ','), 'Semitons. Para cima: voz mais fina. Para baixo: mais grossa. Não muda a velocidade da fala. 12 = uma oitava.'],
    graves: ['Graves', 0.5, FMT.db, 'Corpo e peso da voz (abaixo de ~250 Hz).'],
    medios: ['Médios', 0.5, FMT.db, 'Presença: mais = voz "na frente", nasal; menos = oca.'],
    agudos: ['Agudos', 0.5, FMT.db, 'Brilho e chiado (acima de ~3 kHz).'],
    cortaGraves: ['Corta grave', 10, (v) => (v <= 0 ? 'off' : Math.round(v) + ' Hz'), 'Tira o grave abaixo deste ponto. Uns 400 Hz dão cara de rádio/telefone.'],
    cortaAgudos: ['Corta agudo', 100, (v) => (v >= 12000 ? 'off' : (v / 1000).toFixed(1).replace('.', ',') + ' kHz'), 'Abafa a voz acima deste ponto. Perto de 1 kHz parece debaixo d\'água.'],
    roboInt: ['Força', 1, FMT.pct, 'Quanto da voz vira metálica.'],
    roboVel: ['Frequência', 1, (v) => Math.round(v) + ' Hz', 'Baixo: robô antigo. Alto: voz de sino, alienígena.'],
    distorcao: ['Drive', 1, FMT.pct, 'Voz rasgada, de megafone ou demônio. Muito alto fica difícil de entender.'],
    vibInt: ['Força', 1, FMT.pct, 'Quanto o tom treme.'],
    vibVel: ['Velocidade', 0.1, FMT.hz, 'Devagar (1 Hz): arrastado, bêbado. Rápido (9 Hz): tremido, alienígena.'],
    tremInt: ['Força', 1, FMT.pct, 'Quanto o volume sobe e desce.'],
    tremVel: ['Velocidade', 0.1, FMT.hz, 'Quantas vezes por segundo o volume pulsa.'],
    ecoVol: ['Volume', 1, FMT.pct, 'Volume das repetições.'],
    ecoAtraso: ['Tempo', 10, (v) => Math.round(v) + ' ms', 'Curto: sala pequena. Longo: estádio, montanha.'],
    ecoRep: ['Repetições', 1, FMT.pct, 'Quanto o eco continua repetindo antes de sumir.'],
    ambiente: ['Quantidade', 1, FMT.pct, 'Som de lugar grande: igreja, caverna, banheiro.'],
    volume: ['Volume', 1, FMT.pct, 'Compensa se o efeito deixou a voz alta ou baixa demais.']
};
const PEDAIS_EFEITO = [
    { id: 'tom', nome: 'Tom', icone: '🎚️', cor: '#8b7bff', desc: 'Voz mais fina ou mais grossa', ajustes: ['tom'] },
    { id: 'eq', nome: 'Equalizador', icone: '🎛️', cor: '#3fb6ff', desc: 'O timbre da voz', ajustes: ['graves', 'medios', 'agudos'] },
    { id: 'filtros', nome: 'Filtros', icone: '📻', cor: '#2fc59a', desc: 'Rádio, telefone, abafada', ajustes: ['cortaGraves', 'cortaAgudos'] },
    { id: 'robo', nome: 'Robô', icone: '🤖', cor: '#a9b6c8', desc: 'Voz metálica', ajustes: ['roboInt', 'roboVel'] },
    { id: 'dist', nome: 'Distorção', icone: '🔥', cor: '#ff6a3d', desc: 'Voz rasgada', ajustes: ['distorcao'] },
    { id: 'vib', nome: 'Vibrato', icone: '〰️', cor: '#e05ad8', desc: 'O tom treme', ajustes: ['vibInt', 'vibVel'] },
    { id: 'trem', nome: 'Pulsar', icone: '💓', cor: '#ff4d7a', desc: 'O volume pulsa', ajustes: ['tremInt', 'tremVel'] },
    { id: 'eco', nome: 'Eco', icone: '🏔️', cor: '#f2b53a', desc: 'Repete o que você fala', ajustes: ['ecoVol', 'ecoAtraso', 'ecoRep'] },
    { id: 'amb', nome: 'Ambiente', icone: '⛪', cor: '#56c3e0', desc: 'Lugar grande', ajustes: ['ambiente'] },
    { id: 'saida', nome: 'Saída', icone: '🔊', cor: '#c9d1dc', desc: 'Volume final', ajustes: ['volume'], semChave: true }
];
// valores = posição dos botões; desligados = pedais desligados (os botões guardam a posição, mas o efeito usa o padrão)
const editorEfeito = { id: null, bandas: [], mexeu: false, valores: {}, desligados: new Set(), comparando: false };
const padraoAjuste = (k) => window.Ruido.AJUSTES_EFEITO[k][2];
function pedalDoAjuste(k) { return PEDAIS_EFEITO.find((p) => p.ajustes.includes(k)); }
function lerControlesEfeito() {
    const p = { versao: 2, bandas: editorEfeito.bandas };
    for (const [k, v] of Object.entries(editorEfeito.valores)) p[k] = editorEfeito.desligados.has(pedalDoAjuste(k).id) ? padraoAjuste(k) : v;
    return window.Ruido.perfilDeVoz(p);
}
// Ponto do arco do botão (ângulo em graus, 0 = em cima).
function pontoArco(cx, cy, r, ang) { const a = (ang - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function caminhoArco(a0, a1) {
    if (Math.abs(a1 - a0) < 0.5) return '';
    const [x0, y0] = pontoArco(32, 32, 24, Math.min(a0, a1)), [x1, y1] = pontoArco(32, 32, 24, Math.max(a0, a1));
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A 24 24 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function desenharBotao(botao) {
    const k = botao.dataset.ajuste, [min, max] = window.Ruido.AJUSTES_EFEITO[k];
    const v = editorEfeito.valores[k], fr = (v - min) / (max - min);
    const ang = -135 + fr * 270;
    const centro = min < 0 && max > 0 ? -135 + ((0 - min) / (max - min)) * 270 : -135;
    botao.querySelector('.arco-valor').setAttribute('d', caminhoArco(centro, ang));
    botao.querySelector('.ponteiro').setAttribute('transform', `rotate(${ang} 32 32)`);
    const texto = BOTOES_EFEITO[k][2](v);
    botao.parentElement.querySelector('.botao-valor').textContent = texto;
    botao.setAttribute('aria-valuenow', String(v));
    botao.setAttribute('aria-valuetext', texto);
    botao.parentElement.classList.toggle('mexido', v !== padraoAjuste(k));
}
function mudarAjuste(k, v, porPessoa) {
    const [min, max] = window.Ruido.AJUSTES_EFEITO[k], passo = BOTOES_EFEITO[k][1];
    v = Math.min(max, Math.max(min, Math.round(v / passo) * passo));
    v = Math.round(v * 100) / 100;
    if (v === editorEfeito.valores[k]) return;
    editorEfeito.valores[k] = v;
    const botao = document.querySelector(`#efeito-controles .botao-girar[data-ajuste="${k}"]`);
    if (botao) desenharBotao(botao);
    if (porPessoa) {
        editorEfeito.mexeu = true;
        const pedal = pedalDoAjuste(k);
        if (editorEfeito.desligados.has(pedal.id)) alternarPedal(pedal.id, true); // mexeu num pedal desligado: liga
        marcarModelo(null);
        atualizarRascunhoEfeito();
    }
}
function alternarPedal(id, ligar) {
    const card = document.querySelector(`#efeito-controles .pedal[data-pedal="${id}"]`);
    if (ligar) editorEfeito.desligados.delete(id); else editorEfeito.desligados.add(id);
    if (card) {
        card.classList.toggle('desligado', !ligar);
        const chave = card.querySelector('.pedal-chave');
        if (chave) { chave.setAttribute('aria-pressed', ligar ? 'true' : 'false'); chave.title = ligar ? 'Desligar este pedal' : 'Ligar este pedal'; }
    }
}
function criarBotaoGirar(k, cor) {
    const [min, max] = window.Ruido.AJUSTES_EFEITO[k], [rotulo, passo, , dica] = BOTOES_EFEITO[k];
    const caixa = document.createElement('div'); caixa.className = 'botao-caixa'; caixa.title = dica + '\nArraste para cima/baixo ou use a rodinha. Clique duplo volta ao padrão.';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64'); svg.classList.add('botao-girar');
    svg.dataset.ajuste = k;
    svg.setAttribute('role', 'slider'); svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', `${rotulo} (${pedalDoAjuste(k).nome})`);
    svg.setAttribute('aria-valuemin', String(min)); svg.setAttribute('aria-valuemax', String(max));
    svg.style.setProperty('--cor', cor);
    const trilho = document.createElementNS(NS, 'path'); trilho.setAttribute('d', caminhoArco(-135, 135)); trilho.setAttribute('class', 'arco-trilho');
    const valor = document.createElementNS(NS, 'path'); valor.setAttribute('class', 'arco-valor');
    const corpo = document.createElementNS(NS, 'circle'); corpo.setAttribute('cx', '32'); corpo.setAttribute('cy', '32'); corpo.setAttribute('r', '17'); corpo.setAttribute('class', 'botao-corpo');
    const ponteiro = document.createElementNS(NS, 'line'); ponteiro.setAttribute('x1', '32'); ponteiro.setAttribute('y1', '19'); ponteiro.setAttribute('x2', '32'); ponteiro.setAttribute('y2', '26'); ponteiro.setAttribute('class', 'ponteiro');
    svg.append(trilho, valor, corpo, ponteiro);
    const nome = document.createElement('div'); nome.className = 'botao-rotulo'; nome.textContent = rotulo;
    const mostra = document.createElement('div'); mostra.className = 'botao-valor';
    caixa.append(svg, mostra, nome);
    // arrastar na vertical (Shift = ajuste fino), rodinha, teclado e clique duplo
    let arrasto = null;
    svg.addEventListener('pointerdown', (e) => { e.preventDefault(); svg.focus(); svg.setPointerCapture(e.pointerId); arrasto = { y: e.clientY, v: editorEfeito.valores[k] }; svg.classList.add('girando'); });
    svg.addEventListener('pointermove', (e) => {
        if (!arrasto) return;
        const faixa = (max - min) * (e.shiftKey ? 0.2 : 1);
        mudarAjuste(k, arrasto.v + ((arrasto.y - e.clientY) / 180) * faixa, true);
    });
    const soltar = () => { arrasto = null; svg.classList.remove('girando'); };
    svg.addEventListener('pointerup', soltar); svg.addEventListener('pointercancel', soltar);
    svg.addEventListener('wheel', (e) => { e.preventDefault(); const n = Math.max(1, Math.round((max - min) / passo / 40)); mudarAjuste(k, editorEfeito.valores[k] + (e.deltaY < 0 ? 1 : -1) * passo * (e.shiftKey ? 1 : n), true); }, { passive: false });
    svg.addEventListener('dblclick', () => mudarAjuste(k, padraoAjuste(k), true));
    svg.addEventListener('keydown', (e) => {
        const n = Math.max(1, Math.round((max - min) / passo / 20));
        const mapa = { ArrowUp: passo, ArrowRight: passo, ArrowDown: -passo, ArrowLeft: -passo, PageUp: passo * n, PageDown: -passo * n };
        if (e.key in mapa) { e.preventDefault(); mudarAjuste(k, editorEfeito.valores[k] + mapa[e.key], true); }
        else if (e.key === 'Home') { e.preventDefault(); mudarAjuste(k, min, true); }
        else if (e.key === 'End') { e.preventDefault(); mudarAjuste(k, max, true); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); mudarAjuste(k, padraoAjuste(k), true); }
    });
    return caixa;
}
function montarControlesEfeito() {
    const area = document.getElementById('efeito-controles');
    if (area.childElementCount) return;
    for (const k of Object.keys(window.Ruido.AJUSTES_EFEITO)) editorEfeito.valores[k] = padraoAjuste(k);
    PEDAIS_EFEITO.forEach((p) => {
        const card = document.createElement('section'); card.className = 'pedal' + (p.ajustes.length > 2 ? ' largo' : ''); card.dataset.pedal = p.id;
        card.style.setProperty('--cor', p.cor);
        card.setAttribute('aria-label', 'Pedal ' + p.nome);
        const topo = document.createElement('div'); topo.className = 'pedal-topo';
        const ic = document.createElement('span'); ic.className = 'pedal-icone'; ic.textContent = p.icone; ic.setAttribute('aria-hidden', 'true');
        const tx = document.createElement('div'); tx.className = 'pedal-textos';
        const nm = document.createElement('div'); nm.className = 'pedal-nome'; nm.textContent = p.nome;
        const ds = document.createElement('div'); ds.className = 'pedal-desc'; ds.textContent = p.desc;
        tx.append(nm, ds);
        topo.append(ic, tx);
        if (!p.semChave) {
            const chave = document.createElement('button'); chave.type = 'button'; chave.className = 'pedal-chave';
            chave.setAttribute('aria-label', 'Ligar ou desligar o pedal ' + p.nome); chave.setAttribute('aria-pressed', 'true');
            chave.addEventListener('click', () => { alternarPedal(p.id, editorEfeito.desligados.has(p.id)); editorEfeito.mexeu = true; marcarModelo(null); atualizarRascunhoEfeito(); });
            topo.appendChild(chave);
        }
        const botoes = document.createElement('div'); botoes.className = 'pedal-botoes';
        p.ajustes.forEach((k) => botoes.appendChild(criarBotaoGirar(k, p.cor)));
        card.append(topo, botoes);
        area.appendChild(card);
    });
    area.querySelectorAll('.botao-girar').forEach(desenharBotao);
    const chips = document.getElementById('efeito-modelos');
    Object.entries(window.Ruido.MODELOS_EFEITO).forEach(([k, m]) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-modelo'; b.dataset.modelo = k;
        b.textContent = k === 'zero' ? '✨ Do zero' : m.nome;
        b.addEventListener('click', () => {
            editorEfeito.bandas = [];
            mostrarControlesEfeito(window.Ruido.perfilDoModelo(k), null);
            marcarModelo(k);
            editorEfeito.mexeu = true;
            atualizarRascunhoEfeito();
        });
        chips.appendChild(b);
    });
}
function marcarModelo(k) { document.querySelectorAll('#efeito-modelos .chip-modelo').forEach((b) => b.classList.toggle('ativo', b.dataset.modelo === k)); }
// Põe os valores nos botões. Sem "desligados" salvos, liga só os pedais que mudam alguma coisa.
function mostrarControlesEfeito(perfil, painel) {
    for (const k of Object.keys(window.Ruido.AJUSTES_EFEITO)) {
        const guardado = painel && painel.valores && Number.isFinite(painel.valores[k]) ? painel.valores[k] : perfil[k];
        editorEfeito.valores[k] = guardado;
    }
    document.querySelectorAll('#efeito-controles .botao-girar').forEach(desenharBotao);
    PEDAIS_EFEITO.forEach((p) => {
        if (p.semChave) return;
        const ligado = painel && Array.isArray(painel.desligados) ? !painel.desligados.includes(p.id) : p.ajustes.some((k) => editorEfeito.valores[k] !== padraoAjuste(k));
        alternarPedal(p.id, ligado);
    });
}
let esperaRascunho = 0;
function atualizarRascunhoEfeito() {
    efeitoEmEdicao = editorEfeito.comparando ? window.Ruido.perfilDoModelo('zero') : lerControlesEfeito();
    clearTimeout(esperaRascunho);
    esperaRascunho = setTimeout(async () => {
        if (!microfoneTesteAtivo) return;
        if (cadeiaTesteMic) cadeiaTesteMic.ajustar(opcoesFiltroRuido(true));
        else if (filtroRuidoNecessario(true)) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
    }, 40);
}
// ---------- Monitor: onda e espectro do que sai do efeito ----------
let quadroMonitor = 0;
function desenharMonitorEfeito() {
    cancelAnimationFrame(quadroMonitor);
    const tela = document.getElementById('efeito-monitor');
    const painel = document.getElementById('cfg-painel-efeito');
    if (!tela || !painel.classList.contains('ativo')) return;
    const dpr = window.devicePixelRatio || 1, w = tela.clientWidth, h = tela.clientHeight;
    if (tela.width !== Math.round(w * dpr)) { tela.width = Math.round(w * dpr); tela.height = Math.round(h * dpr); }
    const c = tela.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    for (let x = 0; x < w; x += 40) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); c.stroke(); }
    c.beginPath(); c.moveTo(0, h / 2 + 0.5); c.lineTo(w, h / 2 + 0.5); c.stroke();
    const an = analisadorMedidor;
    const legenda = document.getElementById('efeito-monitor-legenda');
    if (!an || !microfoneTesteAtivo) {
        legenda.textContent = 'Clique em "Ouvir com meu microfone" e fale: aqui aparece o som que sai do efeito.';
        legenda.style.display = '';
        quadroMonitor = requestAnimationFrame(desenharMonitorEfeito);
        return;
    }
    legenda.style.display = 'none';
    const freq = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(freq);
    const barras = 64, maxBin = Math.floor(freq.length * 0.55);
    const grad = c.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, 'rgba(139,123,255,0.15)'); grad.addColorStop(1, 'rgba(63,182,255,0.55)');
    c.fillStyle = grad;
    for (let i = 0; i < barras; i++) {
        const b0 = Math.floor(Math.pow(i / barras, 1.8) * maxBin), b1 = Math.max(b0 + 1, Math.floor(Math.pow((i + 1) / barras, 1.8) * maxBin));
        let m = 0; for (let b = b0; b < b1; b++) m = Math.max(m, freq[b]);
        const alt = (m / 255) * h * 0.95, bw = w / barras;
        c.fillRect(i * bw + 1, h - alt, bw - 2, alt);
    }
    const onda = new Uint8Array(an.fftSize); an.getByteTimeDomainData(onda);
    c.strokeStyle = '#8ef0b0'; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < onda.length; i++) { const x = (i / (onda.length - 1)) * w, y = (onda[i] / 255) * h; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
    quadroMonitor = requestAnimationFrame(desenharMonitorEfeito);
}
function abrirEditorEfeito(id) {
    montarControlesEfeito();
    const existente = id ? vozCriadaPorId(id) : null;
    if (!existente && vozesCriadas().length >= MAX_VOZES_CRIADAS) return mostrarNotificacao(`Você já tem ${MAX_VOZES_CRIADAS} efeitos criados. Apague algum antes.`);
    editorEfeito.id = existente ? existente.id : null;
    editorEfeito.bandas = existente ? existente.perfil.bandas : [];
    editorEfeito.mexeu = false; editorEfeito.comparando = false;
    document.getElementById('efeito-titulo').textContent = existente ? 'Editar efeito de voz' : 'Criar efeito de voz';
    document.getElementById('efeito-nome').value = existente ? existente.nome : '';
    mostrarControlesEfeito(existente ? existente.perfil : window.Ruido.perfilDoModelo('zero'), existente ? existente.painel : null);
    marcarModelo(existente ? null : 'zero');
    efeitoEmEdicao = lerControlesEfeito();
    if (!configAberta()) abrirConfig('voz');
    irParaSecaoConfig('efeito');
    if (cadeiaTesteMic) cadeiaTesteMic.ajustar(opcoesFiltroRuido(true));
    desenharMonitorEfeito();
    document.getElementById('efeito-nome').focus();
}
function sairDoEditorEfeito() {
    efeitoEmEdicao = null;
    clearTimeout(esperaRascunho);
    cancelAnimationFrame(quadroMonitor);
    if (cadeiaTesteMic) cadeiaTesteMic.ajustar(opcoesFiltroRuido(true));
}
async function fecharEditorEfeito() {
    if (editorEfeito.mexeu) {
        const r = await pedirTexto({ titulo: 'Sair sem salvar?', dica: 'As mudanças neste efeito vão ser perdidas.', semCampo: true, rotuloOk: 'Sair sem salvar' });
        if (!r) return;
    }
    sairDoEditorEfeito();
    irParaSecaoConfig('voz');
}
document.getElementById('cfg-criar-voz').addEventListener('click', () => abrirEditorEfeito(null));
document.getElementById('efeito-voltar').addEventListener('click', fecharEditorEfeito);
document.getElementById('efeito-cancelar').addEventListener('click', fecharEditorEfeito);
document.getElementById('efeito-ouvir').addEventListener('click', async () => { efeitoEmEdicao = lerControlesEfeito(); await alternarTesteMicrofone(); desenharMonitorEfeito(); });
// Segurar "Sem efeito" toca a sua voz normal (pra comparar); soltar volta pro efeito.
{
    const comparar = document.getElementById('efeito-comparar');
    const ligar = (v) => { if (editorEfeito.comparando === v) return; editorEfeito.comparando = v; comparar.classList.toggle('ativo', v); atualizarRascunhoEfeito(); };
    comparar.addEventListener('pointerdown', () => ligar(true));
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((t) => comparar.addEventListener(t, () => ligar(false)));
    comparar.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ligar(true); } });
    comparar.addEventListener('keyup', () => ligar(false));
}
document.getElementById('efeito-zerar').addEventListener('click', () => {
    editorEfeito.bandas = [];
    mostrarControlesEfeito(window.Ruido.perfilDoModelo('zero'), null);
    marcarModelo('zero');
    editorEfeito.mexeu = true;
    atualizarRascunhoEfeito();
});
document.getElementById('efeito-nome').addEventListener('input', () => { editorEfeito.mexeu = true; });
document.getElementById('efeito-salvar').addEventListener('click', () => {
    const perfil = lerControlesEfeito();
    if (!perfil) return mostrarNotificacao('Não consegui ler os controles do efeito.');
    const lista = vozesCriadas();
    const nome = document.getElementById('efeito-nome').value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24)
        || (editorEfeito.id ? (vozCriadaPorId(editorEfeito.id) || {}).nome : '') || 'Meu efeito ' + (lista.length + 1);
    const guardar = { ...perfil }; delete guardar.fator; // o fator sai do tom; guarda só os controles
    const painel = { valores: { ...editorEfeito.valores }, desligados: [...editorEfeito.desligados] };
    let id = editorEfeito.id;
    if (id && lista.some((v) => v.id === id)) {
        salvarVozesCriadas(lista.map((v) => (v.id === id ? { id, nome, perfil: guardar, painel } : v)));
    } else {
        if (lista.length >= MAX_VOZES_CRIADAS) return mostrarNotificacao(`Você já tem ${MAX_VOZES_CRIADAS} efeitos criados. Apague algum antes.`);
        do { id = 'voz:' + Math.random().toString(36).slice(2, 10).padEnd(8, 'x'); } while (lista.some((v) => v.id === id));
        salvarVozesCriadas(lista.concat([{ id, nome, perfil: guardar, painel }]));
    }
    editorEfeito.mexeu = false;
    sairDoEditorEfeito();
    irParaSecaoConfig('voz');
    popularEfeitosCriados();
    const sel = document.getElementById('cfg-efeito-voz');
    sel.value = id; sel.dispatchEvent(new Event('change'));
    mostrarNotificacao(`Efeito "${nome}" salvo e ligado. Para trocar, use a lista de efeitos (ou o botão direito no seu nome na chamada).`, 'info');
});

const CHAVE_PREFS_AUDIO = 'estrivisor_audio';
const BITRATE_VOZ = { normal: 32000, alta: 64000, muito_alta: 96000 };
const PREFS_AUDIO_PADRAO = { microfoneId: '', micAoEntrar: true, saidaId: '', eco: true, ruido: true, ganho: true, qualidade: 'alta', dtx: true, red: true, ruidoAvancado: true, porta: false, limiarPorta: 12, efeito: 'nenhum' };
let prefsAudio = { ...PREFS_AUDIO_PADRAO };

function carregarPreferenciasAudio() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(CHAVE_PREFS_AUDIO) || 'null'); } catch (e) { /* corrompido: usa o padrão */ }
    if (!p || typeof p !== 'object') return;
    const bool = (v, padrao) => (typeof v === 'boolean' ? v : padrao);
    prefsAudio = {
        microfoneId: typeof p.microfoneId === 'string' ? p.microfoneId.slice(0, 300) : '',
        saidaId: typeof p.saidaId === 'string' ? p.saidaId.slice(0, 300) : '',
        micAoEntrar: bool(p.micAoEntrar, true),
        eco: bool(p.eco, true), ruido: bool(p.ruido, true), ganho: bool(p.ganho, true),
        qualidade: BITRATE_VOZ[p.qualidade] ? p.qualidade : 'alta',
        dtx: bool(p.dtx, true), red: bool(p.red, true),
        ruidoAvancado: bool(p.ruidoAvancado, true), porta: bool(p.porta, false),
        limiarPorta: window.Ruido.limiarValido(p.limiarPorta, 12),
        efeito: window.Ruido.efeitoValido(p.efeito)
    };
    if (/^voz:/.test(prefsAudio.efeito) && !vozCriadaPorId(prefsAudio.efeito)) prefsAudio.efeito = 'nenhum'; // a voz foi apagada
}
function salvarPreferenciasAudio() {
    try { localStorage.setItem(CHAVE_PREFS_AUDIO, JSON.stringify(prefsAudio)); } catch (e) {}
}
// Como o microfone é captado (valem pra chamada e pro teste).
function opcoesCapturaMicrofone() {
    // Com o filtro avançado ligado, o do Chromium fica desligado (filtrar duas vezes abafa a voz).
    const o = { echoCancellation: prefsAudio.eco, noiseSuppression: prefsAudio.ruido && !ruidoAvancadoAtivo(), autoGainControl: prefsAudio.ganho, channelCount: 1 };
    if (prefsAudio.microfoneId) o.deviceId = prefsAudio.microfoneId;
    return o;
}
// Como a voz é enviada (qualidade e proteções).
function opcoesPublicacaoAudio() {
    return { dtx: prefsAudio.dtx, red: prefsAudio.red, audioPreset: { maxBitrate: BITRATE_VOZ[prefsAudio.qualidade] || BITRATE_VOZ.alta } };
}

// ---------- Supressão de ruído avançada (RNNoise) e porta de ruído ----------
// O filtro roda aqui, no PC de quem fala (ver ruido.js). Se não conseguir iniciar, o app avisa e volta
// para o filtro comum do Chromium, sem derrubar a chamada.
let falhaFiltroRuido = false;
let processadorRuido = null;
function ruidoAvancadoAtivo() { return prefsAudio.ruidoAvancado && !falhaFiltroRuido; }
function filtroRuidoNecessario(paraTeste) { return !falhaFiltroRuido && (prefsAudio.ruidoAvancado || prefsAudio.porta || prefsAudio.efeito !== 'nenhum' || Boolean(paraTeste && efeitoEmEdicao)); }
// paraTeste: o teste do microfone ouve o rascunho do editor de efeitos (se estiver aberto); a chamada nunca.
function opcoesFiltroRuido(paraTeste) {
    const base = { rnnoise: prefsAudio.ruidoAvancado, porta: prefsAudio.porta, limiar: prefsAudio.limiarPorta };
    if (paraTeste && efeitoEmEdicao) return { ...base, efeito: 'voz:rascunho', perfil: efeitoEmEdicao };
    const v = vozCriadaPorId(prefsAudio.efeito);
    return { ...base, efeito: prefsAudio.efeito, perfil: v ? v.perfil : undefined };
}

// Liga, atualiza ou tira o filtro da trilha do microfone que está na chamada.
async function aplicarFiltroRuidoNaChamada() {
    if (!vozConectada()) return;
    const pub = roomVoz.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone);
    const trilha = pub && pub.audioTrack;
    if (!trilha) return;
    try {
        if (filtroRuidoNecessario()) {
            if (processadorRuido && trilha.getProcessor() === processadorRuido) processadorRuido.ajustar(opcoesFiltroRuido());
            else {
                processadorRuido = window.Ruido.criarProcessadorLiveKit(opcoesFiltroRuido); await trilha.setProcessor(processadorRuido);
                if (prefsAudio.efeito !== 'nenhum') mostrarNotificacao('Efeito de voz ligado: ' + nomeDoEfeito(prefsAudio.efeito), 'info');
            }
        } else if (trilha.getProcessor()) { await trilha.stopProcessor(); processadorRuido = null; }
    } catch (err) {
        console.error('Filtro de ruído avançado:', err);
        falhaFiltroRuido = true; processadorRuido = null;
        mostrarNotificacao('Não consegui ligar a supressão de ruído avançada (' + err.message + '). Usando a comum.');
        preencherControlesAudio();
        reaplicarAudioNaChamada(false);
    }
}

// Aplica uma mudança de áudio durante a chamada (se estiver numa).
// Mudou microfone, eco, ruído ou volume automático: o microfone é MONTADO DE NOVO do zero, igual a quando você
// entra na chamada. Antes ele só era "reiniciado no lugar", e às vezes o Windows ficava com parte das opções
// antigas: quem escutava passava a ouvir você mais baixo (ou mais alto) até você sair e entrar de novo.
// A sua voz some por menos de 1 segundo enquanto troca. Várias mudanças seguidas viram uma só (fila).
let micPendente = false, saidaPendente = false, rodandoAudio = false;
async function reaplicarAudioNaChamada(saidaMudou) {
    if (saidaMudou) saidaPendente = true; else micPendente = true;
    if (rodandoAudio) return;
    rodandoAudio = true;
    try {
        while (micPendente || saidaPendente) {
            const s = saidaPendente, m = micPendente;
            saidaPendente = micPendente = false;
            if (!vozConectada()) break;
            await aplicarMudancaDeAudio(s, m);
        }
    } finally { rodandoAudio = false; atualizarBotaoMicrofone(); }
}

// O que o Windows entregou bate com o que foi pedido (eco, ruído, volume automático)?
function capturaConfere(mediaTrack) {
    try {
        const st = mediaTrack.getSettings(), q = opcoesCapturaMicrofone();
        return !['echoCancellation', 'noiseSuppression', 'autoGainControl'].some((k) => st[k] !== undefined && st[k] !== q[k]);
    } catch (e) { return true; }
}

// Tira o microfone da chamada (com o filtro) e publica um novo, do zero.
async function montarMicrofoneDeNovo() {
    const lp = roomVoz.localParticipant;
    const pub = lp.getTrackPublication(LivekitClient.Track.Source.Microphone);
    const trilha = pub && pub.audioTrack;
    if (trilha) {
        try { if (trilha.getProcessor && trilha.getProcessor()) await trilha.stopProcessor(); } catch (e) { /* segue */ }
        await lp.unpublishTrack(trilha, true);
    }
    processadorRuido = null;
    await new Promise((ok) => setTimeout(ok, 150)); // dá tempo do Windows soltar o microfone antes de abrir de novo
    await lp.setMicrophoneEnabled(true, opcoesCapturaMicrofone(), opcoesPublicacaoAudio());
    await aplicarFiltroRuidoNaChamada();
    const nova = lp.getTrackPublication(LivekitClient.Track.Source.Microphone);
    return nova && nova.audioTrack;
}

async function aplicarMudancaDeAudio(saidaMudou, micMudou) {
    reaplicandoAudio++;
    try {
        if (saidaMudou) await roomVoz.switchActiveDevice('audiooutput', prefsAudio.saidaId || 'default');
        if (micMudou && microfoneAtivo) {
            let trilha = await montarMicrofoneDeNovo();
            // O Windows não aceitou as opções de primeira: tenta mais uma vez.
            if (trilha && trilha.mediaStreamTrack && !capturaConfere(trilha.mediaStreamTrack)) {
                await new Promise((ok) => setTimeout(ok, 400));
                trilha = await montarMicrofoneDeNovo();
            }
            { const r = trilha && trilha.mediaStreamTrack && resumoCaptura(trilha.mediaStreamTrack); if (r) mostrarNotificacao(r, 'info'); }
            const pub = roomVoz.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone);
            if (pub && pub.isMuted && pub.audioTrack) await pub.audioTrack.unmute(); // garante que não ficou mudo por acidente
        }
    } catch (err) { mostrarNotificacao('Não consegui aplicar a mudança de áudio: ' + err.message); }
    finally { setTimeout(() => { reaplicandoAudio = Math.max(0, reaplicandoAudio - 1); }, 500); }
}

// ---------- Medidor de nível do microfone ----------
let ctxMedidor = null, fonteMedidor = null, quadroMedidor = 0, analisadorMedidor = null;
function iniciarMedidorMicrofone(stream) {
    pararMedidorMicrofone();
    const barras = ['cfg-medidor-barra', 'efeito-medidor-barra'].map((id) => document.getElementById(id)).filter(Boolean);
    if (!barras.length) return;
    try {
        ctxMedidor = new (window.AudioContext || window.webkitAudioContext)();
        fonteMedidor = ctxMedidor.createMediaStreamSource(stream);
        const analisador = ctxMedidor.createAnalyser();
        analisador.fftSize = 2048;
        analisador.smoothingTimeConstant = 0.7;
        analisadorMedidor = analisador;
        fonteMedidor.connect(analisador);
        const dados = new Uint8Array(analisador.fftSize);
        const quadro = () => {
            analisador.getByteTimeDomainData(dados);
            let pico = 0;
            for (let i = 0; i < dados.length; i++) pico = Math.max(pico, Math.abs(dados[i] - 128));
            const largura = Math.min(100, Math.round((pico / 128) * 140)) + '%';
            barras.forEach((b) => { b.style.width = largura; });
            quadroMedidor = requestAnimationFrame(quadro);
        };
        quadro();
    } catch (e) { /* sem medidor: o teste continua funcionando */ }
}
function pararMedidorMicrofone() {
    if (quadroMedidor) cancelAnimationFrame(quadroMedidor);
    quadroMedidor = 0;
    try { if (fonteMedidor) fonteMedidor.disconnect(); } catch (e) {}
    try { if (ctxMedidor) ctxMedidor.close(); } catch (e) {}
    fonteMedidor = null; ctxMedidor = null; analisadorMedidor = null;
    ['cfg-medidor-barra', 'efeito-medidor-barra'].forEach((id) => { const b = document.getElementById(id); if (b) b.style.width = '0'; });
}
function atualizarBotaoTesteConfig() {
    const b = document.getElementById('cfg-testar-mic');
    if (b) b.textContent = microfoneTesteAtivo ? '⏹ Parar teste' : '🎧 Testar microfone';
    const o = document.getElementById('efeito-ouvir');
    if (o) { o.textContent = microfoneTesteAtivo ? '⏹ Parar de ouvir' : '🎧 Ouvir com meu microfone'; o.classList.toggle('ativo', microfoneTesteAtivo); }
}

// ---------- Lista de dispositivos ----------
async function preencherDispositivosAudio() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let lista = [];
    try {
        lista = await navigator.mediaDevices.enumerateDevices();
        // Sem permissão os nomes vêm vazios: pede uma vez (e solta o microfone logo em seguida).
        if (lista.some((d) => d.kind === 'audioinput' && !d.label)) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ audio: true });
                s.getTracks().forEach((t) => t.stop());
                lista = await navigator.mediaDevices.enumerateDevices();
            } catch (e) { /* sem permissão: segue com nomes genéricos */ }
        }
    } catch (e) { return; }
    const preencher = (selectId, tipo, atual, rotuloPadrao) => {
        const sel = document.getElementById(selectId);
        sel.textContent = '';
        const padrao = document.createElement('option');
        padrao.value = ''; padrao.textContent = rotuloPadrao;
        sel.appendChild(padrao);
        let n = 0;
        lista.filter((d) => d.kind === tipo && d.deviceId !== 'default' && d.deviceId !== 'communications').forEach((d) => {
            n++;
            const o = document.createElement('option');
            o.value = d.deviceId;
            o.textContent = d.label || `${tipo === 'audioinput' ? 'Microfone' : 'Saída'} ${n}`;
            sel.appendChild(o);
        });
        // Dispositivo salvo que não existe mais (fone desconectado): volta pro padrão.
        sel.value = [...sel.options].some((o) => o.value === atual) ? atual : '';
    };
    preencher('cfg-select-entrada', 'audioinput', prefsAudio.microfoneId, 'Padrão do sistema');
    preencher('cfg-select-saida', 'audiooutput', prefsAudio.saidaId, 'Padrão do sistema');
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => { if (configAberta()) preencherDispositivosAudio(); });
}

// ---------- Abrir / fechar / navegar ----------
const modalConfig = () => document.getElementById('modal-config');
function configAberta() { return modalConfig().style.display === 'flex'; }

function irParaSecaoConfig(nome) {
    document.querySelectorAll('.cfg-item').forEach((b) => b.classList.toggle('ativo', b.dataset.cfg === nome));
    document.querySelectorAll('.cfg-painel').forEach((p) => p.classList.toggle('ativo', p.id === 'cfg-painel-' + nome));
    if (nome === 'voz') preencherDispositivosAudio();
    if (nome === 'acesso') { abaAdmin = 'pedidos'; irParaAbaAdmin('pedidos'); carregarAcesso(false); }
    if (nome !== 'voz' && nome !== 'efeito' && microfoneTesteAtivo) pararTesteMicrofone();
    if (nome !== 'efeito' && efeitoEmEdicao) sairDoEditorEfeito();
    if (nome === 'efeito') document.querySelectorAll('.cfg-item').forEach((b) => b.classList.toggle('ativo', b.dataset.cfg === 'voz'));
    else { try { localStorage.setItem('estrivisor_config_secao', nome); } catch (e) {} }
    marcarSecaoVista(nome);
    if (nome !== 'busca') { const b = document.getElementById('cfg-busca'); if (b && b.value) b.value = ''; }
    modalConfig().querySelector('.cfg-conteudo').scrollTop = 0;
}

// Selo "novo" nas seções novas: some depois que a pessoa abre a seção uma vez.
function marcarSecaoVista(nome) {
    const selo = document.querySelector(`.cfg-novo[data-novo="${nome}"]`);
    if (selo) { selo.remove(); try { localStorage.setItem('estrivisor_cfg_visto_' + nome, '1'); } catch (e) {} }
}
document.querySelectorAll('.cfg-novo[data-novo]').forEach((selo) => {
    try { if (localStorage.getItem('estrivisor_cfg_visto_' + selo.dataset.novo)) selo.remove(); } catch (e) {}
});

// ---------- Procurar configuração ----------
// Procura nos títulos e nas opções de todas as seções (menos Administração) e leva direto até a opção.
const normalizarBusca = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const NOMES_SECAO_CONFIG = { conta: 'Minha conta', privacidade: 'Privacidade', voz: 'Voz e áudio', video: 'Vídeo e transmissão', aparencia: 'Aparência', flutuante: 'Janela flutuante', som: 'Sons do app', discord: 'Discord', sobre: 'Sobre' };
function textoDoAlvo(el) {
    const b = el.matches('label') ? el.querySelector('b') : null;
    return ((b || el).textContent || '').replace(/\s+/g, ' ').trim();
}
function procurarConfig(texto) {
    const q = normalizarBusca(texto).trim();
    let painel = document.getElementById('cfg-painel-busca');
    if (!q) {
        if (painel && painel.classList.contains('ativo')) {
            let ultima = 'conta'; try { ultima = localStorage.getItem('estrivisor_config_secao') || 'conta'; } catch (e) {}
            irParaSecaoConfig(NOMES_SECAO_CONFIG[ultima] ? ultima : 'conta');
        }
        return;
    }
    if (!painel) {
        painel = document.createElement('section');
        painel.className = 'cfg-painel'; painel.id = 'cfg-painel-busca';
        modalConfig().querySelector('.cfg-conteudo').appendChild(painel);
    }
    const titulo = document.createElement('h2'); titulo.textContent = `Resultados para "${texto.trim()}"`;
    const lista = document.createElement('div'); lista.className = 'busca-resultados';
    const vistos = new Set();
    document.querySelectorAll('.cfg-painel').forEach((p) => {
        const sec = p.id.replace('cfg-painel-', '');
        if (!NOMES_SECAO_CONFIG[sec]) return;
        p.querySelectorAll('label, .cfg-grupo-titulo, .titulo-config, summary, .rotulo-config, .cfg-rotulo, button').forEach((alvo) => {
            const t = textoDoAlvo(alvo);
            if (!t || t.length > 90 || !normalizarBusca(t).includes(q)) return;
            if (alvo.closest('[style*="display:none"], [style*="display: none"]')) return;
            const chave = sec + '|' + t;
            if (vistos.has(chave) || vistos.size >= 40) return;
            vistos.add(chave);
            const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
            const onde = document.createElement('span'); onde.textContent = NOMES_SECAO_CONFIG[sec]; b.appendChild(onde);
            b.addEventListener('click', () => irParaConfigAchada(sec, alvo));
            lista.appendChild(b);
        });
    });
    if (!lista.children.length) {
        const nada = document.createElement('div'); nada.className = 'cfg-dica';
        nada.textContent = 'Nada encontrado. Tente outra palavra (ex.: microfone, ruído, tema, transmissão).';
        lista.appendChild(nada);
    }
    painel.replaceChildren(titulo, lista);
    document.querySelectorAll('.cfg-item').forEach((b) => b.classList.remove('ativo'));
    document.querySelectorAll('.cfg-painel').forEach((p) => p.classList.toggle('ativo', p === painel));
    if (microfoneTesteAtivo) pararTesteMicrofone();
    modalConfig().querySelector('.cfg-conteudo').scrollTop = 0;
}
function irParaConfigAchada(sec, alvo) {
    irParaSecaoConfig(sec);
    // abre as caixas (Avançado, grupos da Aparência) que escondem a opção
    for (let d = alvo.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    const bloco = alvo.closest('label, .cfg-grupo, .secao-config') || alvo;
    requestAnimationFrame(() => {
        bloco.scrollIntoView({ block: 'center', behavior: 'auto' });
        bloco.classList.remove('cfg-achado'); void bloco.offsetWidth; bloco.classList.add('cfg-achado');
        setTimeout(() => bloco.classList.remove('cfg-achado'), 2000);
        const campo = alvo.matches('input, select, button') ? alvo : (bloco.querySelector('input, select, textarea') || null);
        if (campo && typeof campo.focus === 'function') campo.focus({ preventScroll: true });
    });
}
{
    const busca = document.getElementById('cfg-busca');
    let espera = 0;
    busca.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => procurarConfig(busca.value), 120); });
    busca.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && busca.value) { e.stopPropagation(); busca.value = ''; procurarConfig(''); }
        if (e.key === 'Enter') { const primeiro = document.querySelector('#cfg-painel-busca .busca-resultados button'); if (primeiro) primeiro.click(); }
    });
}

function preencherContaConfig() {
    const nome = nomeUsuarioAtual || '—';
    document.getElementById('cfg-nome').textContent = nome;
    aplicarAvatar(document.getElementById('cfg-avatar'), obterIdentidadeUsuario() || '', nome, avatarUsuarioAtual || null);
    document.getElementById('cfg-conta-tipo').textContent = contaAtual ? 'Conta do Estrivisor (entrou com o Discord)' : 'Sem conta — modo local';
    document.getElementById('cfg-sair-conta').style.display = contaAtual ? '' : 'none';
    document.getElementById('cfg-grupo-dados').style.display = contaAtual ? '' : 'none';
    document.getElementById('cfg-codigo-amigo').textContent = amigosEstado.codigo || '—';
}
function preencherControlesAudio() {
    document.getElementById('cfg-mic-ao-entrar').checked = prefsAudio.micAoEntrar !== false;
    document.getElementById('cfg-eco').checked = prefsAudio.eco;
    document.getElementById('cfg-ruido').checked = prefsAudio.ruido;
    document.getElementById('cfg-ganho').checked = prefsAudio.ganho;
    document.getElementById('cfg-qualidade-voz').value = prefsAudio.qualidade;
    document.getElementById('cfg-dtx').checked = prefsAudio.dtx;
    document.getElementById('cfg-red').checked = prefsAudio.red;
    document.getElementById('cfg-ruido-avancado').checked = ruidoAvancadoAtivo();
    document.getElementById('cfg-ruido-avancado').disabled = falhaFiltroRuido;
    document.getElementById('cfg-porta').checked = prefsAudio.porta;
    document.getElementById('cfg-limiar-porta').value = prefsAudio.limiarPorta;
    document.getElementById('cfg-limiar-valor').textContent = prefsAudio.limiarPorta;
    document.getElementById('cfg-linha-limiar').style.display = prefsAudio.porta ? '' : 'none';
    document.getElementById('cfg-limiar-marca').style.display = prefsAudio.porta ? '' : 'none';
    document.getElementById('cfg-limiar-marca').style.left = prefsAudio.limiarPorta + '%';
    popularEfeitosCriados();
    document.getElementById('cfg-efeito-voz').value = prefsAudio.efeito;
}

function abrirConfig(secao) {
    preencherContaConfig();
    preencherControlesAudio();
    let ultima = 'conta';
    try { ultima = localStorage.getItem('estrivisor_config_secao') || 'conta'; } catch (e) {}
    const valida = ['conta', 'privacidade', 'voz', 'video', 'aparencia', 'flutuante', 'som', 'discord', 'sobre'];
    irParaSecaoConfig(valida.includes(secao) ? secao : (valida.includes(ultima) ? ultima : 'conta'));
    modalConfig().style.display = 'flex';
    window.electronAPI.versaoApp().then((v) => { document.getElementById('cfg-versao').textContent = 'versão ' + v; }).catch(() => {});
}
function fecharConfig() {
    if (microfoneTesteAtivo) pararTesteMicrofone();
    if (efeitoEmEdicao) sairDoEditorEfeito();
    modalConfig().style.display = 'none';
}

document.getElementById('btn-config-usuario').addEventListener('click', () => abrirConfig());
document.getElementById('cfg-fechar').addEventListener('click', fecharConfig);
document.querySelectorAll('.cfg-item').forEach((b) => b.addEventListener('click', () => irParaSecaoConfig(b.dataset.cfg)));
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && configAberta() && document.getElementById('modal-texto').style.display !== 'flex') fecharConfig();
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); configAberta() ? fecharConfig() : abrirConfig(); }
});

document.getElementById('cfg-sair-conta').addEventListener('click', () => { fecharConfig(); document.getElementById('btn-login-sair-conta').click(); });

document.getElementById('cfg-exportar-dados').addEventListener('click', async () => {
    try {
        const r = await window.electronAPI.exportarMeusDados();
        if (r.ok) mostrarNotificacao('Arquivo salvo em: ' + r.arquivo);
        else if (!r.cancelado) mostrarNotificacao('Não consegui exportar: ' + (r.erro || 'erro desconhecido'));
    } catch (e) { mostrarNotificacao('Não consegui exportar os seus dados.'); }
});

document.getElementById('cfg-apagar-conta').addEventListener('click', async () => {
    const r = await pedirTexto({
        titulo: 'Apagar a minha conta?',
        dica: 'Isso apaga as suas mensagens, tira você dos servidores e remove as suas amizades. Não dá para desfazer. Para entrar de novo, o administrador precisa liberar o seu acesso outra vez. Digite APAGAR para confirmar.',
        max: 10, rotuloOk: 'Apagar tudo',
    });
    if (!r) return;
    if (r.texto.trim().toUpperCase() !== 'APAGAR') { mostrarNotificacao('Não apaguei: você precisa digitar APAGAR.'); return; }
    try {
        const res = await window.electronAPI.apagarMinhaConta();
        if (!res.ok) { mostrarNotificacao('Não consegui apagar a conta: ' + (res.erro || 'erro desconhecido')); return; }
    } catch (e) { mostrarNotificacao('Não consegui apagar a conta.'); return; }
    fecharConfig();
    await encerrarContaNoApp();
    mostrarTelaLogin('entrar');
    mostrarNotificacao('Sua conta foi apagada.');
});

// ---------- Eventos dos controles de voz ----------
document.getElementById('cfg-testar-mic').addEventListener('click', alternarTesteMicrofone);
document.getElementById('cfg-select-entrada').addEventListener('change', async (e) => {
    prefsAudio.microfoneId = e.target.value; salvarPreferenciasAudio();
    if (microfoneTesteAtivo) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
    reaplicarAudioNaChamada(false);
});
document.getElementById('cfg-select-saida').addEventListener('change', (e) => {
    prefsAudio.saidaId = e.target.value; salvarPreferenciasAudio();
    if (audioTesteMic && audioTesteMic.setSinkId) audioTesteMic.setSinkId(prefsAudio.saidaId || '').catch(() => {});
    reaplicarAudioNaChamada(true);
});
document.getElementById('cfg-mic-ao-entrar').addEventListener('change', (e) => { prefsAudio.micAoEntrar = e.target.checked; salvarPreferenciasAudio(); });
[['cfg-eco', 'eco'], ['cfg-ruido', 'ruido'], ['cfg-ganho', 'ganho'], ['cfg-dtx', 'dtx'], ['cfg-red', 'red']].forEach(([id, chave]) => {
    document.getElementById(id).addEventListener('change', async (e) => {
        prefsAudio[chave] = e.target.checked; salvarPreferenciasAudio();
        if (microfoneTesteAtivo) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
        reaplicarAudioNaChamada(false, chave === 'dtx' || chave === 'red');
    });
});
// Filtro avançado e porta de ruído: valem na hora, sem reiniciar o teste nem a chamada
// (só ligar/desligar o filtro avançado muda como o microfone é captado, então reinicia).
function atualizarFiltroRuidoAoVivo() {
    salvarPreferenciasAudio();
    preencherControlesAudio();
    if (cadeiaTesteMic) cadeiaTesteMic.ajustar(opcoesFiltroRuido(true));
    aplicarFiltroRuidoNaChamada();
}
document.getElementById('cfg-ruido-avancado').addEventListener('change', async (e) => {
    prefsAudio.ruidoAvancado = e.target.checked; salvarPreferenciasAudio();
    preencherControlesAudio();
    if (microfoneTesteAtivo) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
    reaplicarAudioNaChamada(false);
});
document.getElementById('cfg-porta').addEventListener('change', async (e) => {
    prefsAudio.porta = e.target.checked;
    atualizarFiltroRuidoAoVivo();
    if (microfoneTesteAtivo && !cadeiaTesteMic && filtroRuidoNecessario()) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
});
document.getElementById('cfg-efeito-voz').addEventListener('change', async (e) => {
    prefsAudio.efeito = window.Ruido.efeitoValido(e.target.value);
    atualizarFiltroRuidoAoVivo();
    // Se o teste ou a chamada estavam sem o filtro, ele precisa ser montado agora.
    if (microfoneTesteAtivo && !cadeiaTesteMic && filtroRuidoNecessario()) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
});
document.getElementById('cfg-limiar-porta').addEventListener('input', (e) => {
    prefsAudio.limiarPorta = window.Ruido.limiarValido(e.target.value, 12);
    atualizarFiltroRuidoAoVivo();
});
document.getElementById('cfg-qualidade-voz').addEventListener('change', (e) => {
    prefsAudio.qualidade = BITRATE_VOZ[e.target.value] ? e.target.value : 'alta'; salvarPreferenciasAudio();
    reaplicarAudioNaChamada(false, true);
});

// ---------- Menus do microfone e do fone (setinhas no cartão do usuário) ----------
async function listarDispositivosAudio(tipo) {
    try {
        const lista = await navigator.mediaDevices.enumerateDevices();
        return lista.filter((d) => d.kind === tipo && d.deviceId !== 'default' && d.deviceId !== 'communications');
    } catch (e) { return []; }
}
function escolherDispositivoAudio(entrada, id) {
    if (entrada) prefsAudio.microfoneId = id; else prefsAudio.saidaId = id;
    salvarPreferenciasAudio();
    reaplicarAudioNaChamada(!entrada);
    if (configAberta()) preencherDispositivosAudio();
}
async function abrirMenuDispositivos(tipo, botao) {
    const entrada = tipo === 'audioinput';
    const r = botao.closest('.grupo-icone') ? botao.closest('.grupo-icone').getBoundingClientRect() : botao.getBoundingClientRect();
    const dispositivos = await listarDispositivosAudio(tipo);
    abrirMenu(r.left, r.top, () => {
        const atualId = entrada ? prefsAudio.microfoneId : prefsAudio.saidaId;
        const itens = [{ titulo: entrada ? 'Usar este microfone' : 'Ouvir por' }];
        itens.push({ id: 'padrao', rotulo: 'Padrão do Windows', marcado: atualId === '', mantemAberto: true, acao: () => escolherDispositivoAudio(entrada, '') });
        dispositivos.forEach((d, i) => {
            const nome = (d.label || `${entrada ? 'Microfone' : 'Saída'} ${i + 1}`).slice(0, 44);
            itens.push({ id: 'disp-' + i, rotulo: nome, marcado: atualId === d.deviceId, dica: d.label || '', mantemAberto: true, acao: () => escolherDispositivoAudio(entrada, d.deviceId) });
        });
        itens.push({ separador: true });
        if (entrada) {
            itens.push({ titulo: 'Ajustes rápidos' });
            const ajustes = [
                ['eco', 'Cancelamento de eco', 'Evita que o som dos seus fones ou caixas volte pela sua voz.'],
                ['ruidoAvancado', 'Filtro de ruído avançado', 'Tira barulho de fundo (teclado, ventilador) antes de enviar a sua voz.'],
                ['ganho', 'Volume automático', 'Deixa a sua voz sempre no mesmo volume, aumentando quando você fala baixo.']
            ];
            if (!prefsAudio.ruidoAvancado) ajustes.splice(2, 0, ['ruido', 'Supressão de ruído comum', 'O filtro de ruído mais simples, do próprio Windows/Chromium.']);
            ajustes.forEach(([chave, nome, dica]) => {
                itens.push({
                    id: 'proc-' + chave, rotulo: nome, dica, chave: Boolean(prefsAudio[chave]), mantemAberto: true,
                    acao: async () => {
                        prefsAudio[chave] = !prefsAudio[chave]; salvarPreferenciasAudio(); preencherControlesAudio();
                        if (microfoneTesteAtivo) { pararTesteMicrofone(); await alternarTesteMicrofone(); }
                        reaplicarAudioNaChamada(false);
                    }
                });
            });
            itens.push({ id: 'efeito', rotulo: '🎭 Efeito de voz: ' + nomeDoEfeito(prefsAudio.efeito), submenu: itensEfeitoDeVoz });
            itens.push({ separador: true });
            itens.push({ id: 'testar', rotulo: microfoneTesteAtivo ? '⏹ Parar o teste do microfone' : '🎧 Testar o microfone (ouvir a sua voz)', mantemAberto: true, acao: () => alternarTesteMicrofone() });
        } else {
            if (vozConectada()) itens.push({ id: 'refazer-audio', rotulo: '🔄 Não ouço alguém: refazer o áudio', dica: 'Recarrega o som de todo mundo da chamada, sem você sair.', acao: () => refazerAudioDosOutros() });
        }
        itens.push({ id: 'cfg-voz', rotulo: '⚙️ Mais ajustes de voz', acao: () => abrirConfig('voz') });
        return { cabecalho: entrada ? '🎤 Microfone' : '🔊 Saída de áudio', itens };
    });
}
document.getElementById('btn-mic-seta').addEventListener('click', (e) => { e.stopPropagation(); abrirMenuDispositivos('audioinput', e.currentTarget); });
document.getElementById('btn-fone-seta').addEventListener('click', (e) => { e.stopPropagation(); abrirMenuDispositivos('audiooutput', e.currentTarget); });

// ---------- Conexão de voz: ícone de wifi + mini menu com a latência ----------
// A latência (ping) vem das estatísticas do próprio WebRTC; o LiveKit expõe isso por dentro.
// Se alguma versão não expuser, os campos ficam com "—" e o resto continua funcionando.
let ultimaAmostraVoz = null; // { perdidos, recebidos } da leitura anterior (pra calcular a perda recente)
let estatVoz = { rtt: null, perda: null, jitter: null };

async function lerEstatisticasVoz() {
    const sala = roomVoz;
    if (!sala || !vozConectada()) return null;
    const pcm = sala.engine && sala.engine.pcManager;
    const transportes = [pcm && pcm.publisher, pcm && pcm.subscriber].filter((t) => t && typeof t.getStats === 'function');
    let rttPar = null, rttRemoto = null, jitter = null, perdidos = 0, recebidos = 0;
    for (const t of transportes) {
        let rel = null;
        try { rel = await t.getStats(); } catch (e) { continue; }
        if (!rel) continue;
        rel.forEach((r) => {
            if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && typeof r.currentRoundTripTime === 'number') {
                rttPar = rttPar === null ? r.currentRoundTripTime : Math.min(rttPar, r.currentRoundTripTime);
            }
            if (r.type === 'remote-inbound-rtp' && typeof r.roundTripTime === 'number') rttRemoto = r.roundTripTime;
            if (r.type === 'inbound-rtp' && r.kind === 'audio') {
                perdidos += r.packetsLost || 0; recebidos += r.packetsReceived || 0;
                if (typeof r.jitter === 'number') jitter = Math.max(jitter || 0, r.jitter * 1000);
            }
        });
    }
    const seg = rttPar !== null ? rttPar : rttRemoto;
    let perda = null;
    if (ultimaAmostraVoz) {
        const dp = perdidos - ultimaAmostraVoz.perdidos, dr = recebidos - ultimaAmostraVoz.recebidos;
        if (dp >= 0 && dr >= 0 && dp + dr > 0) perda = (dp / (dp + dr)) * 100;
        else if (dp === 0 && dr === 0) perda = estatVoz.perda;
    }
    ultimaAmostraVoz = { perdidos, recebidos };
    return { rtt: seg === null ? null : Math.round(seg * 1000), perda, jitter: jitter === null ? null : Math.round(jitter) };
}

function nivelDaConexao(e) {
    if (avisoConexaoVoz) return 'desconhecida';
    if (!e || e.rtt === null) return 'desconhecida';
    let n = e.rtt < 80 ? 'otima' : e.rtt < 150 ? 'boa' : e.rtt < 250 ? 'regular' : 'ruim';
    const ordem = ['otima', 'boa', 'regular', 'ruim'];
    const piso = e.perda !== null && e.perda > 10 ? 'ruim' : (e.perda !== null && e.perda > 4 ? 'regular' : 'otima');
    if (ordem.indexOf(piso) > ordem.indexOf(n)) n = piso;
    return n;
}
const ROTULO_NIVEL = { otima: 'Ótima', boa: 'Boa', regular: 'Regular', ruim: 'Ruim', desconhecida: 'Medindo...' };
const DICA_NIVEL = {
    otima: 'Sua conexão está ótima.',
    boa: 'Boa conexão para voz e transmissão.',
    regular: 'A conexão está oscilando. Se a voz picotar, aproxime-se do roteador ou use cabo.',
    ruim: 'Conexão ruim: a voz pode falhar. Tente cabo de rede, feche downloads ou reduza a qualidade da transmissão.',
    desconhecida: ''
};

function desenharConexaoVoz() {
    const nivel = nivelDaConexao(estatVoz);
    document.getElementById('btn-conexao').dataset.nivel = nivel;
    document.getElementById('pop-latencia').textContent = estatVoz.rtt === null ? '—' : estatVoz.rtt + ' ms';
    document.getElementById('pop-qualidade').textContent = ROTULO_NIVEL[nivel];
    document.getElementById('pop-perda').textContent = estatVoz.perda === null ? '—' : estatVoz.perda.toFixed(1).replace('.', ',') + '%';
    document.getElementById('pop-jitter').textContent = estatVoz.jitter === null ? '—' : estatVoz.jitter + ' ms';
    document.getElementById('pop-dica').textContent = DICA_NIVEL[nivel];
}

let medindoVoz = false;
async function atualizarConexaoVoz() {
    if (medindoVoz) return;
    if (!vozConectada()) {
        ultimaAmostraVoz = null;
        estatVoz = { rtt: null, perda: null, jitter: null };
        desenharConexaoVoz();
        return;
    }
    medindoVoz = true;
    try {
        const e = await lerEstatisticasVoz();
        if (e) estatVoz = e;
    } catch (err) { /* sem estatísticas: mantém o último valor */ }
    medindoVoz = false;
    desenharConexaoVoz();
}
setInterval(atualizarConexaoVoz, 2000);

const popoverConexao = () => document.getElementById('popover-conexao');
function fecharPopoverConexao() { popoverConexao().style.display = 'none'; }
document.getElementById('btn-conexao').addEventListener('click', (e) => {
    e.stopPropagation(); // não deixa o clique "entrar" no canal de voz pelo cartão
    const pop = popoverConexao();
    if (pop.style.display === 'flex') return fecharPopoverConexao();
    const r = e.currentTarget.getBoundingClientRect();
    pop.style.left = Math.max(10, Math.min(r.left, window.innerWidth - 260)) + 'px';
    pop.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    pop.style.top = 'auto';
    pop.style.display = 'flex';
    desenharConexaoVoz();
    atualizarConexaoVoz();
});
document.addEventListener('mousedown', (e) => {
    if (popoverConexao().style.display === 'flex' && !popoverConexao().contains(e.target) && !document.getElementById('btn-conexao').contains(e.target)) fecharPopoverConexao();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharPopoverConexao(); });

// ============================================================
// Amigos e mensagens diretas
// ============================================================
let amigosEstado = { codigo: '', amigos: [], recebidos: [], enviados: [] };
let temporizadorAmigos = null;
let abaAmigos = 'amigos';
let dmAtual = null; // { usuario, nome, avatar }

const amigosAbertos = () => document.getElementById('tela-amigos').style.display === 'flex';

function registrarUltimasServidor(servidorId, ultimas) {
    if (!ultimas || typeof ultimas !== 'object') return;
    const mapa = {};
    Object.keys(ultimas).forEach((canalId) => { mapa[chaveCanalTexto(servidorId, canalId)] = ultimas[canalId]; });
    registrarUltimas(mapa);
    atualizarBadges();
}

async function carregarAmigos() {
    if (!obterIdentidadeUsuario()) return;
    try {
        const d = await api('GET', '/amigos');
        amigosEstado = {
            codigo: String(d.codigo || ''),
            amigos: Array.isArray(d.amigos) ? d.amigos : [],
            recebidos: Array.isArray(d.recebidos) ? d.recebidos : [],
            enviados: Array.isArray(d.enviados) ? d.enviados : []
        };
        const mapa = {};
        amigosEstado.amigos.forEach((a) => { mapa[chaveDmLocal(a.usuario)] = a.ultimaDm || 0; });
        registrarUltimas(mapa);
        document.getElementById('cfg-codigo-amigo').textContent = amigosEstado.codigo || '—';
        if (amigosAbertos()) renderizarAmigos();
        assinaturaBadges = ''; // força o redesenho (mudou a lista de amigos ou os pedidos)
        atualizarBadges();
    } catch (err) { /* sem conta ou servidor fora do ar: tenta de novo no próximo ciclo */ }
}
function iniciarAmigos() {
    pararAmigos();
    carregarAmigos();
    iniciarAcesso();
    iniciarAvisosDaConta();
    temporizadorAmigos = setInterval(carregarAmigos, 10000);
}
function pararAmigos() {
    qualidadeConta = null;
    acessoAdmin = false; pararAcesso();
    pararAvisosDaConta();
    if (temporizadorAmigos) { clearInterval(temporizadorAmigos); temporizadorAmigos = null; }
    amigosEstado = { codigo: '', amigos: [], recebidos: [], enviados: [] };
    dmAtual = null;
}


// ============================================================
// Termos de uso (aceite) e denúncias
// ============================================================
const VERSAO_TERMOS_APP = 2;   // tem que ser igual à VERSAO_TERMOS do servidor
let termosPendentes = null;

function garantirTermos() {
    return api('GET', '/termos').then((d) => (d.aceito ? true : mostrarTelaTermos(d.versao))).catch(() => true);
}

// Chamado quando o servidor responde "aceite os termos" no meio do uso.
function exigirTermosAgora() {
    if (termosPendentes) return;
    mostrarTelaTermos(VERSAO_TERMOS_APP).then((ok) => { if (ok) { carregarMeusServidores(); iniciarAmigos(); } });
}

function mostrarTelaTermos(versaoServidor) {
    if (termosPendentes) return termosPendentes;
    const tela = document.getElementById('tela-termos');
    const check = document.getElementById('termos-check');
    const aceitar = document.getElementById('termos-aceitar');
    const desatualizado = versaoServidor !== VERSAO_TERMOS_APP;
    const texto = document.getElementById('termos-texto');
    const aviso = document.getElementById('termos-aviso');
    check.checked = false;
    aceitar.disabled = true;
    texto.scrollTop = 0;
    const conferirLeitura = () => {
        const leu = texto.scrollHeight - texto.scrollTop - texto.clientHeight < 8;
        check.disabled = desatualizado || !leu;
        aviso.style.display = leu ? 'none' : '';
    };
    texto.onscroll = conferirLeitura;
    document.getElementById('termos-versao').textContent = desatualizado
        ? 'Os termos foram atualizados. Instale a versão mais nova do Estrivisor para continuar.'
        : `Termos, versão ${VERSAO_TERMOS_APP}.`;
    tela.style.display = 'flex';
    conferirLeitura();
    termosPendentes = new Promise((resolve) => {
        const fechar = (resultado) => {
            tela.style.display = 'none';
            check.onchange = aceitar.onclick = document.getElementById('termos-sair').onclick = texto.onscroll = null;
            termosPendentes = null;
            resolve(resultado);
        };
        check.onchange = () => { aceitar.disabled = !check.checked || desatualizado; };
        aceitar.onclick = async () => {
            aceitar.disabled = true;
            try {
                await api('POST', '/termos/aceitar', { versao: VERSAO_TERMOS_APP, maior18: true });
                fechar(true);
            } catch (err) { aceitar.disabled = false; mostrarNotificacao('Não consegui registrar o aceite: ' + err.message); }
        };
        document.getElementById('termos-sair').onclick = async () => {
            try { await window.electronAPI.sairDaConta(); } catch (e) { /* sai mesmo assim */ }
            fechar(false);
            await encerrarContaNoApp();
            mostrarTelaLogin('entrar');
        };
    });
    return termosPendentes;
}

const MOTIVOS_DENUNCIA = {
    assedio: 'Assédio / ameaça', 'sexual-menores': 'Conteúdo sexual com menores', golpe: 'Golpe / fraude',
    pirataria: 'Pirataria', ilegal: 'Atividade ilegal', outro: 'Outro'
};

function itemDenunciar(usuario, nome) {
    if (usuario === obterIdentidadeUsuario()) return { separador: true };
    return { id: 'denunciar', rotulo: '🚩 Denunciar', perigo: true, acao: () => abrirDenuncia({ titulo: `Denunciar ${nome}`, corpo: { tipo: 'pessoa', alvo: usuario } }) };
}

function denunciarMensagem(m, caminho) {
    let corpo = null;
    const canal = /^\/servidores\/([^/]+)\/canais\/([^/]+)\/mensagens/.exec(caminho || '');
    const dm = /^\/dm\/([^/]+)\/mensagens/.exec(caminho || '');
    if (canal) corpo = { tipo: 'mensagem', origem: 'canal', servidorId: canal[1], canalId: canal[2], seq: m.seq };
    else if (dm) corpo = { tipo: 'mensagem', origem: 'dm', outro: decodeURIComponent(dm[1]), seq: m.seq };
    if (!corpo) return;
    abrirDenuncia({ titulo: `Denunciar mensagem de ${m.nome || 'alguém'}`, dica: 'O administrador vai ler esta mensagem e as que vieram antes e depois dela.', corpo });
}

function abrirDenuncia({ titulo, dica = '', corpo }) {
    const modal = document.getElementById('modal-denuncia');
    document.getElementById('denuncia-titulo').textContent = titulo;
    document.getElementById('denuncia-dica').textContent = dica;
    document.getElementById('denuncia-motivo').value = 'assedio';
    document.getElementById('denuncia-detalhe').value = '';
    modal.style.display = 'flex';
    const enviar = document.getElementById('denuncia-enviar');
    const fechar = () => { modal.style.display = 'none'; enviar.onclick = null; document.getElementById('denuncia-cancelar').onclick = null; };
    document.getElementById('denuncia-cancelar').onclick = fechar;
    enviar.onclick = async () => {
        enviar.disabled = true;
        try {
            await api('POST', '/denuncias', { ...corpo, motivo: document.getElementById('denuncia-motivo').value, detalhe: document.getElementById('denuncia-detalhe').value });
            fechar();
            mostrarNotificacao('Denúncia enviada. Obrigado por avisar.', 'info');
        } catch (err) { mostrarNotificacao('Não consegui enviar a denúncia: ' + err.message); }
        enviar.disabled = false;
    };
}

// ============================================================
// Administração (só administrador): pedidos, pessoas, servidores, denúncias e histórico
// ============================================================
let acessoAdmin = false;
let acessoPedidosVistos = null;
let temporizadorAcesso = null;
let abaAdmin = 'pedidos';
const ROTULOS_ACAO = {
    liberar: 'liberou', negar: 'negou o pedido de', 'remover-acesso': 'removeu o acesso de', suspender: 'suspendeu', banir: 'baniu',
    'desfazer-punicao': 'desfez a punição de', 'apagar-servidor': 'apagou um servidor de',
    'denuncia-ignorar': 'ignorou uma denúncia contra', 'denuncia-remover-mensagem': 'removeu uma mensagem de',
    'denuncia-suspender': 'suspendeu (denúncia)', 'denuncia-banir': 'baniu (denúncia)',
    'gerar-chaves': 'gerou chaves de qualidade', 'ativar-chave': 'ativou uma chave de qualidade', 'apagar-chave': 'apagou uma chave não usada',
    'revogar-qualidade': 'revogou a qualidade de',
    'liberar-por-id': 'liberou pelo ID', 'encerrar-sessoes': 'encerrou as sessões de', advertir: 'advertiu',
    'aviso-geral': 'publicou um aviso geral', 'tirar-aviso-geral': 'tirou o aviso geral', 'tirar-da-chamada': 'tirou da chamada',
    'expulsar-do-servidor': 'expulsou de um servidor', 'liberar-volta-ao-servidor': 'liberou a volta a um servidor de', 'trocar-dono-do-servidor': 'passou um servidor para',
    'compactar-imagens': 'compactou imagens', 'mudar-configuracao': 'mudou uma configuração', 'ligar-recurso': 'ligou um recurso', 'desligar-recurso': 'desligou um recurso',
    'tornar-moderador': 'tornou moderador', 'tirar-moderador': 'tirou de moderador', 'apagou-a-propria-conta': 'apagou a própria conta'
};
let papelAdmin = 'admin';            // 'admin' ou 'moderador' (o servidor diz)
const filtroAdmin = {};              // texto da busca de cada aba

function textoSeguro(t) { const d = document.createElement('div'); d.textContent = String(t == null ? '' : t); return d.innerHTML; }
const dataHora = (ts) => ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function linhaAdmin({ usuario, avatar, titulo, selos = [], sub = '', botoes = [] }) {
    const li = document.createElement('div');
    li.className = 'acesso-linha';
    const img = document.createElement('span');
    img.className = 'avatar-participante';
    if (usuario) aplicarAvatar(img, usuario, titulo, urlAvatarSegura(avatar));
    else img.style.display = 'none';
    const info = document.createElement('div');
    info.className = 'acesso-info';
    info.innerHTML = `<b>${textoSeguro(titulo)}${selos.map((s) => `<span class="selo ${s.tom || ''}">${textoSeguro(s.texto)}</span>`).join('')}</b><span>${textoSeguro(sub)}</span>`;
    const bt = document.createElement('div');
    bt.className = 'acesso-botoes';
    botoes.forEach((b) => { const el = document.createElement('button'); el.textContent = b.texto; if (b.perigo) el.className = 'cfg-btn-perigo'; el.onclick = b.acao; bt.appendChild(el); });
    li.append(img, info, bt);
    return li;
}

function vazioAdmin(texto) { const d = document.createElement('div'); d.className = 'acesso-vazio'; d.textContent = texto; return d; }

function atualizarContadoresAdmin(d) {
    const p = d.pedidos.length, n = d.denunciasAbertas || 0;
    const a = document.getElementById('adm-cont-pedidos'), b = document.getElementById('adm-cont-denuncias'), c = document.getElementById('cfg-badge-acesso');
    a.textContent = p; a.style.display = p ? '' : 'none';
    b.textContent = n; b.style.display = n ? '' : 'none';
    c.textContent = p + n; c.style.display = p + n ? '' : 'none';
}

async function carregarAcesso(avisar) {
    try {
        const d = await api('GET', '/admin/acesso');
        d.pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
        acessoAdmin = true;
        papelAdmin = d.papel === 'moderador' ? 'moderador' : 'admin';
        document.querySelectorAll('.adm-aba[data-so-admin]').forEach((b) => { b.style.display = papelAdmin === 'admin' ? '' : 'none'; });
        if (papelAdmin !== 'admin' && document.querySelector(`.adm-aba[data-aba="${abaAdmin}"][data-so-admin]`)) { abaAdmin = 'pedidos'; document.querySelectorAll('.adm-aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === 'pedidos')); }
        document.getElementById('cfg-item-acesso').style.display = '';
        atualizarContadoresAdmin(d);
        const ids = new Set(d.pedidos.map((p) => p.usuario));
        if (avisar && acessoPedidosVistos) {
            const novos = d.pedidos.filter((p) => !acessoPedidosVistos.has(p.usuario));
            if (novos.length) mostrarNotificacao(`${novos[0].nome || 'Alguém'} pediu acesso ao Estrivisor. Veja em Configurações > Administração.`, 'info');
        }
        acessoPedidosVistos = ids;
        const focado = document.activeElement;
        const digitando = Boolean(focado && /^(INPUT|TEXTAREA|SELECT)$/.test(focado.tagName) && document.getElementById('adm-conteudo').contains(focado)) || ['aovivo', 'avisos', 'espaco', 'sistema'].includes(abaAdmin); // não rouba o foco de quem está digitando
        if (!digitando && modalConfig().style.display === 'flex' && document.getElementById('cfg-painel-acesso').classList.contains('ativo')) desenharAbaAdmin(d);
    } catch (err) {
        if (err.status === 403) { acessoAdmin = false; pararAcesso(); }
    }
}

function irParaAbaAdmin(aba) {
    abaAdmin = aba;
    document.querySelectorAll('.adm-aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
    desenharAbaAdmin();
}
document.getElementById('adm-abas').addEventListener('click', (e) => { const b = e.target.closest('.adm-aba'); if (b) irParaAbaAdmin(b.dataset.aba); });

async function desenharAbaAdmin(dadosAcesso) {
    const alvo = document.getElementById('adm-conteudo');
    const dica = document.getElementById('adm-dica');
    const minha = abaAdmin;
    try {
        const nova = document.createElement('div');
        nova.className = 'acesso-lista';
        if (minha === 'pedidos') {
            dica.textContent = 'Quem tenta entrar sem estar liberado aparece aqui. Só libere quem você conhece e sabe que é maior de 18 anos.';
            const d = dadosAcesso || await api('GET', '/admin/acesso');
            if (papelAdmin === 'admin') nova.appendChild(formLiberarPorId()); // liberar quem nunca pediu é só do administrador
            if (!d.pedidos.length) nova.appendChild(vazioAdmin('Nenhum pedido no momento.'));
            d.pedidos.forEach((p) => nova.appendChild(linhaAdmin({
                usuario: p.usuario, avatar: p.avatar, titulo: p.nome || p.usuario, sub: `${String(p.usuario).replace('discord:', 'ID ')} · pediu em ${dataHora(p.ts)}`,
                botoes: [
                    { texto: 'Liberar', acao: () => agirAdmin('POST', '/admin/acesso/autorizar', { usuario: p.usuario }) },
                    { texto: 'Negar', perigo: true, acao: () => agirAdmin('POST', '/admin/acesso/negar', { usuario: p.usuario }) },
                    papelAdmin === 'admin' ? { texto: 'Banir', perigo: true, acao: () => punirPessoa(p, 'ban') } : null
                ].filter(Boolean)
            })));
        } else if (minha === 'pessoas') {
            dica.textContent = 'Todas as pessoas com acesso. Suspender tem data de fim; banir vale até você desfazer.';
            const d = await api('GET', '/admin/pessoas');
            if (!d.pessoas.length) nova.appendChild(vazioAdmin('Ninguém ainda.'));
            d.pessoas.forEach((p) => {
                const selos = [];
                if (p.admin) selos.push({ texto: 'admin', tom: 'bom' });
                if (p.online) selos.push({ texto: 'online', tom: 'bom' });
                if (p.estado === 'banido') selos.push({ texto: 'banido', tom: 'ruim' });
                if (p.estado === 'suspenso') selos.push({ texto: 'suspenso até ' + dataHora(p.punicao && p.punicao.ate), tom: 'ruim' });
                if (p.estado === 'removido') selos.push({ texto: 'sem acesso', tom: 'ruim' });
                if (!p.aceite) selos.push({ texto: 'sem aceite dos termos' });
                if (p.moderador) selos.push({ texto: 'moderador', tom: 'bom' });
                const botoes = [{ texto: 'Ficha', acao: () => abrirFichaAdmin(p.usuario) }];
                if (!p.admin && p.estado === 'ok' && (papelAdmin === 'admin' || !p.moderador)) botoes.push({ texto: 'Advertir', acao: () => advertirPessoa(p) });
                if (!p.admin && papelAdmin === 'admin') {
                    if (p.estado === 'banido' || p.estado === 'suspenso') botoes.push({ texto: 'Desfazer punição', acao: () => agirAdmin('POST', '/admin/desfazer-punicao', { usuario: p.usuario }) });
                    else if (p.estado === 'removido') botoes.push({ texto: 'Liberar', acao: () => agirAdmin('POST', '/admin/acesso/autorizar', { usuario: p.usuario }) });
                    else {
                        botoes.push({ texto: 'Suspender', perigo: true, acao: () => punirPessoa(p, 'suspensao') });
                        botoes.push({ texto: 'Banir', perigo: true, acao: () => punirPessoa(p, 'ban') });
                        botoes.push({ texto: 'Remover acesso', perigo: true, acao: () => removerAcesso(p) });
                    }
                }
                nova.appendChild(linhaAdmin({
                    usuario: p.usuario, avatar: p.avatar, titulo: p.nome, selos,
                    sub: `${String(p.usuario).replace('discord:', 'ID ')} · última vez: ${p.online ? 'agora' : dataHora(p.ultimaVez)} · liberado em ${dataHora(p.desde)} · servidores: ${p.servidores.length ? p.servidores.join(', ') : 'nenhum'}${p.aceite ? ' · termos v' + p.aceite.versao + ' em ' + dataHora(p.aceite.ts) : ''}${p.punicao && p.punicao.motivo ? ' · motivo: ' + p.punicao.motivo : ''}`,
                    botoes
                }));
            });
        } else if (minha === 'servidores') {
            dica.textContent = 'Todos os servidores criados. Apagar remove canais, membros e conversas, e não tem volta.';
            const d = await api('GET', '/admin/servidores');
            if (!d.servidores.length) nova.appendChild(vazioAdmin('Nenhum servidor criado.'));
            d.servidores.forEach((s) => nova.appendChild(linhaAdmin({
                titulo: s.nome, sub: `Dono: ${s.donoNome || s.dono} · ${s.membros} membro(s) · ${s.canais} canal(is) · criado em ${dataHora(s.criadoEm)}`,
                botoes: [{ texto: 'Gerenciar', acao: () => abrirServidorAdmin(s.id) }, { texto: 'Apagar servidor', perigo: true, acao: () => apagarServidorAdmin(s) }]
            })));
        } else if (minha === 'denuncias') {
            dica.textContent = 'Você só vê o trecho que a pessoa denunciou, nada além disso.';
            const d = await api('GET', '/admin/denuncias');
            if (!d.denuncias.length) nova.appendChild(vazioAdmin('Nenhuma denúncia.'));
            [...d.denuncias].sort((a, b) => (a.estado === 'aberta' ? 0 : 1) - (b.estado === 'aberta' ? 0 : 1) || b.id - a.id).forEach((x) => nova.appendChild(cartaoDenuncia(x)));
        } else if (minha === 'chaves') {
            dica.textContent = 'Chaves liberam qualidades acima de 720p30. Cada chave vale para uma conta. O texto da chave só aparece uma vez, quando você gera: copie na hora.';
            const d = await api('GET', '/admin/chaves');
            desenharAbaChaves(nova, d);
        } else if (minha === 'aovivo') {
            dica.textContent = 'Quem está em cada chamada neste momento. Tirar alguém só desconecta da chamada: a pessoa pode entrar de novo.';
            await desenharAbaAoVivo(nova);
        } else if (minha === 'avisos') {
            dica.textContent = 'Uma mensagem sua que aparece no topo do app de todo mundo (manutenção, novidade, recado).';
            await desenharAbaAvisos(nova);
        } else if (minha === 'espaco') {
            dica.textContent = 'Quanto cada servidor ocupa em imagens e sons. Compactar troca as imagens originais pela versão reduzida: nada some, só perde qualidade.';
            await desenharAbaEspaco(nova);
        } else if (minha === 'sistema') {
            dica.textContent = 'Ajustes que valem na hora, sem mexer no servidor. Em branco = usa o que está no arquivo de configuração.';
            await desenharAbaSistema(nova);
        } else {
            dica.textContent = 'Tudo o que foi feito pelo painel, do mais novo para o mais antigo.';
            const d = await api('GET', '/admin/historico');
            if (!d.historico.length) nova.appendChild(vazioAdmin('Ainda não há registros.'));
            d.historico.forEach((h) => nova.appendChild(linhaAdmin({
                titulo: `${h.porNome || h.por} ${ROTULOS_ACAO[h.acao] || h.acao}${h.alvoNome ? ' ' + h.alvoNome : ''}`, sub: `${dataHora(h.ts)}${h.detalhe ? ' · ' + h.detalhe : ''}`
            })));
        }
        if (minha !== abaAdmin) return; // trocou de aba enquanto carregava
        if (['pessoas', 'servidores', 'historico'].includes(minha)) porBuscaAdmin(nova, minha);
        alvo.replaceChildren(...nova.childNodes);
    } catch (err) {
        if (minha === abaAdmin) { alvo.replaceChildren(vazioAdmin('Não consegui carregar: ' + err.message)); }
    }
}


// ============================================================
// Administração, parte 2: busca, liberar por ID, ficha da pessoa, advertência, aviso geral, chamadas ao vivo,
// gerenciar servidor por dentro, espaço, configurações ao vivo, interruptores e moderadores.
// ============================================================
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function botaoAdmin(texto, acao, perigo) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = texto;
    if (perigo) b.className = 'cfg-btn-perigo';
    b.addEventListener('click', acao);
    return b;
}
function subtituloAdmin(texto) { const d = document.createElement('div'); d.className = 'adm-subtitulo'; d.textContent = texto; return d; }
const tamanhoAdmin = (bytes) => (bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2).replace('.', ',') + ' GB' : bytes >= 1048576 ? (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.round(bytes / 1024) + ' KB');
function duracaoAdmin(seg) { const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; }

// Campo de busca no topo da lista: esconde as linhas que não têm o texto digitado.
function porBuscaAdmin(nova, aba) {
    const campo = document.createElement('input');
    campo.type = 'text'; campo.className = 'adm-busca'; campo.placeholder = '🔎 Buscar nesta lista...'; campo.maxLength = 60;
    campo.value = filtroAdmin[aba] || '';
    const aplicar = (raiz) => {
        const q = semAcento(campo.value.trim());
        raiz.querySelectorAll(':scope > .acesso-linha').forEach((l) => { l.style.display = !q || semAcento(l.textContent).includes(q) ? '' : 'none'; });
    };
    campo.addEventListener('input', () => { filtroAdmin[aba] = campo.value; aplicar(campo.parentElement); });
    nova.insertBefore(campo, nova.firstChild);
    aplicar(nova);
}

// Pedidos: liberar alguém direto pelo ID do Discord, sem a pessoa precisar pedir antes.
function formLiberarPorId() {
    const f = document.createElement('div'); f.className = 'adm-form';
    const id = document.createElement('input'); id.type = 'text'; id.placeholder = 'ID do Discord (só números)'; id.maxLength = 25; id.style.flex = '1 1 180px';
    const nome = document.createElement('input'); nome.type = 'text'; nome.placeholder = 'Nome (pra você reconhecer)'; nome.maxLength = 40; nome.style.flex = '1 1 160px';
    f.append(id, nome, botaoAdmin('Liberar pelo ID', async () => {
        const v = id.value.replace(/\D/g, '');
        if (v.length < 17 || v.length > 20) return mostrarNotificacao('O ID do Discord tem de 17 a 20 números. No Discord: clique com o botão direito na pessoa > "Copiar ID do usuário" (precisa do Modo desenvolvedor ligado).');
        await agirAdmin('POST', '/admin/acesso/autorizar', { usuario: v, nome: nome.value.trim() });
    }));
    return f;
}

async function advertirPessoa(p) {
    const m = await pedirTexto({ titulo: 'Advertir ' + (p.nome || 'esta pessoa'), dica: 'A pessoa vai ver este texto numa janela e precisa clicar em "Entendi". Fica registrado no histórico e na ficha dela.', max: 400, multilinha: true, rotuloOk: 'Enviar advertência' });
    if (!m || !m.texto.trim()) return;
    try { await api('POST', '/admin/advertir', { usuario: p.usuario, texto: m.texto }); mostrarNotificacao('Advertência enviada.', 'info'); }
    catch (err) { mostrarNotificacao('Não foi possível advertir: ' + err.message); }
}

// ---- Janela de detalhes (ficha da pessoa / servidor por dentro) ----
let detalheAdminAtual = 0;
function abrirDetalheAdmin(titulo) {
    detalheAdminAtual++;
    document.getElementById('adm-detalhe-titulo').textContent = titulo;
    const corpo = document.getElementById('adm-detalhe-corpo');
    corpo.replaceChildren(vazioAdmin('Carregando...'));
    document.getElementById('tela-adm-detalhe').style.display = 'flex';
    return { corpo, id: detalheAdminAtual };
}
function fecharDetalheAdmin() { detalheAdminAtual++; document.getElementById('tela-adm-detalhe').style.display = 'none'; }
document.getElementById('adm-detalhe-fechar').addEventListener('click', fecharDetalheAdmin);
function camposAdmin(pares) {
    const g = document.createElement('div'); g.className = 'adm-campos';
    pares.filter(Boolean).forEach(([rotulo, valor]) => { const c = document.createElement('div'); c.className = 'adm-campo'; const b = document.createElement('b'); b.textContent = rotulo; c.append(b, document.createTextNode(valor === null || valor === undefined || valor === '' ? '—' : String(valor))); g.appendChild(c); });
    return g;
}

async function abrirFichaAdmin(usuario) {
    const { corpo, id } = abrirDetalheAdmin('Ficha da pessoa');
    let d;
    try { d = await api('GET', `/admin/pessoas/${encodeURIComponent(usuario)}`); }
    catch (err) { if (id === detalheAdminAtual) corpo.replaceChildren(vazioAdmin('Não consegui carregar: ' + err.message)); return; }
    if (id !== detalheAdminAtual) return;
    const p = d.pessoa;
    document.getElementById('adm-detalhe-titulo').textContent = 'Ficha: ' + p.nome;
    const recarregar = () => abrirFichaAdmin(usuario);
    const partes = [];
    const estado = p.admin ? 'administrador' : p.moderador ? 'moderador' : p.estado === 'ok' ? 'com acesso' : p.estado === 'banido' ? 'banido' : p.estado === 'suspenso' ? 'suspenso até ' + dataHora(p.punicao && p.punicao.ate) : 'sem acesso';
    partes.push(camposAdmin([
        ['Situação', estado + (p.online ? ' · online agora' : '')],
        ['ID', String(p.usuario).replace('discord:', '')],
        ['Última vez', p.online ? 'agora' : dataHora(p.ultimaVez)],
        ['Liberado em', dataHora(p.liberadoEm) + (p.liberadoPor && p.liberadoPor !== 'migracao' ? ' por ' + p.liberadoPor : '')],
        ['Termos de uso', p.aceite ? `aceitou a versão ${p.aceite.versao} em ${dataHora(p.aceite.ts)}` : 'ainda não aceitou'],
        ['Versão do app', d.app.versao || 'desconhecida'],
        ['Aparelhos logados', d.sessoes.aparelhos],
        ['Dias de uso (últimos 31)', d.app.diasAtivos31],
        ['Tempo em chamada', duracaoAdmin(d.uso.vozSegundos)],
        ['Mensagens enviadas', d.uso.mensagens],
        ['Amigos', d.amigos],
        ['Qualidade de transmissão', d.qualidade.nome + (d.qualidade.ate ? ' até ' + dataHora(d.qualidade.ate) : '')],
        ['Denúncias contra', `${d.denuncias.contra} (${d.denuncias.contraAbertas} aberta(s))`],
        ['Denúncias que fez', d.denuncias.feitas],
        p.punicao ? ['Motivo da punição', p.punicao.motivo] : null,
    ]));
    // Ações
    const acoes = document.createElement('div'); acoes.className = 'adm-form';
    if (!p.admin && p.estado === 'ok' && (papelAdmin === 'admin' || !p.moderador)) acoes.appendChild(botaoAdmin('Advertir', async () => { await advertirPessoa(p); recarregar(); }));
    if (papelAdmin === 'admin') {
        acoes.appendChild(botaoAdmin('Encerrar sessões', async () => {
            const r = await pedirTexto({ titulo: 'Encerrar as sessões de ' + p.nome + '?', dica: 'A pessoa é desconectada de todos os aparelhos e precisa entrar de novo com o Discord. Útil se a conta ou o PC dela foi comprometido.', semCampo: true, rotuloOk: 'Encerrar' });
            if (!r) return;
            try { const x = await api('POST', '/admin/sessoes/encerrar', { usuario: p.usuario }); mostrarNotificacao(`Sessões encerradas (${x.aparelhos} aparelho(s)).`, 'info'); recarregar(); }
            catch (err) { mostrarNotificacao('Não foi possível: ' + err.message); }
        }, true));
        if (!p.admin && p.estado === 'ok' && /^discord:/.test(p.usuario)) {
            acoes.appendChild(botaoAdmin(p.moderador ? 'Tirar de moderador' : 'Tornar moderador', async () => {
                if (!p.moderador) {
                    const r = await pedirTexto({ titulo: 'Tornar ' + p.nome + ' moderador?', dica: 'Moderadores podem: liberar e negar pedidos de acesso, ver a lista de pessoas e as fichas, advertir, cuidar das denúncias (ignorar, remover a mensagem, suspender por até 7 dias) e ver o histórico. Não podem banir, mexer em servidores, chaves, avisos nem no sistema.', semCampo: true, rotuloOk: 'Tornar moderador' });
                    if (!r) return;
                }
                try { if (p.moderador) await api('DELETE', `/admin/moderadores/${encodeURIComponent(p.usuario)}`); else await api('POST', '/admin/moderadores', { usuario: p.usuario }); recarregar(); desenharAbaAdmin(); }
                catch (err) { mostrarNotificacao('Não foi possível: ' + err.message); }
            }));
        }
    }
    if (acoes.childNodes.length) partes.push(acoes);
    // Servidores
    partes.push(subtituloAdmin(`Servidores (${d.servidores.length})`));
    if (!d.servidores.length) partes.push(vazioAdmin('Não está em nenhum servidor.'));
    d.servidores.forEach((s) => partes.push(linhaAdmin({ titulo: s.nome, sub: `${s.papel}${s.apelido && s.apelido !== p.nome ? ' · apelido: ' + s.apelido : ''}`, botoes: papelAdmin === 'admin' ? [{ texto: 'Gerenciar', acao: () => abrirServidorAdmin(s.id) }] : [] })));
    // Notas internas
    partes.push(subtituloAdmin('Notas internas (só a administração vê)'));
    const fNota = document.createElement('div'); fNota.className = 'adm-form';
    const campoNota = document.createElement('input'); campoNota.type = 'text'; campoNota.maxLength = 300; campoNota.placeholder = 'Escreva uma nota sobre esta pessoa...'; campoNota.style.flex = '1 1 240px';
    fNota.append(campoNota, botaoAdmin('Anotar', async () => {
        if (!campoNota.value.trim()) return;
        try { await api('POST', `/admin/pessoas/${encodeURIComponent(usuario)}/notas`, { texto: campoNota.value }); recarregar(); }
        catch (err) { mostrarNotificacao('Não consegui anotar: ' + err.message); }
    }));
    partes.push(fNota);
    d.notas.forEach((n) => partes.push(linhaAdmin({ titulo: n.texto, sub: `${n.porNome || 'administração'} · ${dataHora(n.ts)}`, botoes: papelAdmin === 'admin' ? [{ texto: 'Apagar', perigo: true, acao: async () => {
        try { await api('DELETE', `/admin/pessoas/${encodeURIComponent(usuario)}/notas/${encodeURIComponent(n.id)}`); recarregar(); } catch (err) { mostrarNotificacao('Não consegui apagar: ' + err.message); }
    } }] : [] })));
    // Advertências e histórico
    partes.push(subtituloAdmin(`Advertências (${d.advertencias.length})`));
    if (!d.advertencias.length) partes.push(vazioAdmin('Nenhuma advertência.'));
    d.advertencias.forEach((a) => partes.push(linhaAdmin({ titulo: a.texto, selos: [a.lidaEm ? { texto: 'lida em ' + dataHora(a.lidaEm), tom: 'bom' } : { texto: 'ainda não leu', tom: 'ruim' }], sub: `${a.porNome || 'administração'} · ${dataHora(a.ts)}` })));
    partes.push(subtituloAdmin('Histórico de moderação desta pessoa'));
    if (!d.historico.length) partes.push(vazioAdmin('Nada registrado.'));
    d.historico.forEach((h) => partes.push(linhaAdmin({ titulo: `${h.porNome || h.por} ${ROTULOS_ACAO[h.acao] || h.acao}`, sub: `${dataHora(h.ts)}${h.detalhe ? ' · ' + h.detalhe : ''}` })));
    corpo.replaceChildren(...partes);
}

async function abrirServidorAdmin(servidorId) {
    const { corpo, id } = abrirDetalheAdmin('Servidor');
    let d;
    try { d = await api('GET', `/admin/servidores/${encodeURIComponent(servidorId)}`); }
    catch (err) { if (id === detalheAdminAtual) corpo.replaceChildren(vazioAdmin('Não consegui carregar: ' + err.message)); return; }
    if (id !== detalheAdminAtual) return;
    const s = d.servidor;
    document.getElementById('adm-detalhe-titulo').textContent = 'Servidor: ' + s.nome;
    const recarregar = () => { abrirServidorAdmin(servidorId); desenharAbaAdmin(); };
    const fazer = async (metodo, caminho, corpoPedido) => { try { await api(metodo, caminho, corpoPedido); recarregar(); } catch (err) { mostrarNotificacao('Não foi possível: ' + err.message); } };
    const partes = [camposAdmin([['Criado em', dataHora(s.criadoEm)], ['Membros', s.membros.length], ['Canais', s.canais.length], ['Convites ativos', s.convitesAtivos]])];
    partes.push(subtituloAdmin(`Membros (${s.membros.length})`));
    s.membros.forEach((m) => {
        const botoes = [{ texto: 'Ficha', acao: () => abrirFichaAdmin(m.usuario) }];
        if (!m.dono) {
            botoes.push({ texto: 'Tornar dono', acao: async () => {
                const r = await pedirTexto({ titulo: `Passar "${s.nome}" para ${m.conta || m.apelido}?`, dica: 'O dono atual vira membro comum. Só funciona se essa pessoa ainda não for dona de outro servidor.', semCampo: true, rotuloOk: 'Trocar o dono' });
                if (r) fazer('POST', `/admin/servidores/${encodeURIComponent(s.id)}/transferir`, { novoDono: m.usuario });
            } });
            botoes.push({ texto: 'Expulsar', perigo: true, acao: async () => {
                const r = await pedirTexto({ titulo: `Expulsar ${m.conta || m.apelido} de "${s.nome}"?`, dica: 'A pessoa sai do servidor e não volta com convite até alguém liberar.', semCampo: true, rotuloOk: 'Expulsar' });
                if (r) fazer('POST', `/admin/servidores/${encodeURIComponent(s.id)}/expulsar`, { alvo: m.usuario });
            } });
        }
        partes.push(linhaAdmin({ titulo: m.conta || m.apelido, selos: [m.dono ? { texto: '👑 dono', tom: 'bom' } : null, m.online ? { texto: 'online', tom: 'bom' } : null].filter(Boolean), sub: `${m.apelido && m.apelido !== m.conta ? 'apelido: ' + m.apelido + ' · ' : ''}entrou em ${dataHora(m.entrouEm)}`, botoes }));
    });
    partes.push(subtituloAdmin(`Canais (${s.canais.length})`));
    s.canais.forEach((c) => partes.push(linhaAdmin({ titulo: (c.tipo === 'voz' ? '🔊 ' : '# ') + c.nome, sub: c.tipo === 'voz' ? (c.aprovacao ? 'voz · entrada com aprovação' : 'voz') : `texto · ${c.mensagens || 0} mensagem(ns) já enviadas` })));
    if (s.banidos.length) {
        partes.push(subtituloAdmin(`Expulsos que não podem voltar (${s.banidos.length})`));
        s.banidos.forEach((b) => partes.push(linhaAdmin({ titulo: b.nome || b.usuario, sub: 'expulso em ' + dataHora(b.ts), botoes: [{ texto: 'Deixar voltar', acao: () => fazer('DELETE', `/admin/servidores/${encodeURIComponent(s.id)}/banidos/${encodeURIComponent(b.usuario)}`) }] })));
    }
    corpo.replaceChildren(...partes);
}

// ---- Aba "Ao vivo" ----
async function desenharAbaAoVivo(nova) {
    const d = await api('GET', '/admin/chamadas');
    const topo = document.createElement('div'); topo.className = 'adm-form';
    const total = d.chamadas.reduce((n, c) => n + c.pessoas.length, 0);
    const txt = document.createElement('span'); txt.textContent = `${d.chamadas.length} chamada(s) · ${total} pessoa(s)`; txt.style.flex = '1';
    topo.append(txt, botaoAdmin('🔄 Atualizar', () => desenharAbaAdmin()));
    nova.appendChild(topo);
    if (!d.chamadas.length) nova.appendChild(vazioAdmin('Ninguém em chamada agora.'));
    d.chamadas.forEach((c) => {
        nova.appendChild(subtituloAdmin(`${c.servidor} › 🔊 ${c.canal} (${c.pessoas.length})`));
        c.pessoas.forEach((p) => nova.appendChild(linhaAdmin({
            usuario: p.usuario, titulo: p.conta && p.conta !== p.usuario ? p.conta : p.nome,
            selos: [p.transmitindo ? { texto: 'transmitindo a tela', tom: 'bom' } : null, { texto: p.microfone ? 'microfone ligado' : 'microfone mudo' }].filter(Boolean),
            sub: p.nome && p.nome !== p.conta ? 'apelido: ' + p.nome : '',
            botoes: [{ texto: 'Ficha', acao: () => abrirFichaAdmin(p.usuario) }, { texto: 'Tirar da chamada', perigo: true, acao: async () => {
                const r = await pedirTexto({ titulo: `Tirar ${p.conta || p.nome} da chamada?`, dica: 'Só desconecta agora. Para impedir a volta, suspenda ou expulse do servidor.', semCampo: true, rotuloOk: 'Tirar' });
                if (r) agirAdmin('POST', '/admin/chamadas/remover', { sala: c.sala, usuario: p.usuario });
            } }]
        })));
    });
}

// ---- Aba "Aviso geral" ----
async function desenharAbaAvisos(nova) {
    const d = await api('GET', '/admin/aviso');
    if (d.aviso) {
        nova.appendChild(subtituloAdmin('Aviso no ar'));
        nova.appendChild(linhaAdmin({ titulo: d.aviso.texto, sub: `publicado em ${dataHora(d.aviso.ts)} · some sozinho em ${dataHora(d.aviso.ate)}`, botoes: [{ texto: 'Tirar do ar', perigo: true, acao: () => agirAdmin('DELETE', '/admin/aviso') }] }));
    } else nova.appendChild(vazioAdmin('Nenhum aviso no ar.'));
    nova.appendChild(subtituloAdmin(d.aviso ? 'Trocar por outro' : 'Publicar um aviso'));
    const f = document.createElement('div'); f.className = 'adm-form';
    const texto = document.createElement('textarea'); texto.maxLength = 300; texto.placeholder = 'Ex.: Hoje às 22h o Estrivisor fica fora do ar por uns 10 minutos para atualização.';
    const dur = document.createElement('select');
    [['1', '1 hora'], ['6', '6 horas'], ['24', '1 dia'], ['72', '3 dias'], ['168', '7 dias']].forEach(([v, r]) => { const o = document.createElement('option'); o.value = v; o.textContent = 'Fica ' + r; dur.appendChild(o); });
    dur.value = '24';
    f.append(texto, dur, botaoAdmin('Publicar para todos', async () => {
        if (!texto.value.trim()) return mostrarNotificacao('Escreva o aviso.');
        await agirAdmin('POST', '/admin/aviso', { texto: texto.value, horas: Number(dur.value) });
    }));
    nova.appendChild(f);
}

// ---- Aba "Espaço" ----
async function desenharAbaEspaco(nova) {
    const d = await api('GET', '/admin/espaco');
    const pct = d.total.teto ? Math.min(100, Math.round(d.total.bytes / d.total.teto * 1000) / 10) : 0;
    const topo = document.createElement('div'); topo.className = 'adm-form'; topo.style.flexDirection = 'column'; topo.style.alignItems = 'stretch';
    const t = document.createElement('div'); t.textContent = `Imagens do chat: ${tamanhoAdmin(d.total.bytes)} de ${d.tetoGB} GB (${String(pct).replace('.', ',')}%) · ${d.total.originais} original(is), ${d.total.compactadas} compactada(s) · conversas privadas e canais apagados: ${tamanhoAdmin(d.conversasPrivadas.bytes)}`;
    const barra = document.createElement('div'); barra.className = 'adm-barra'; const dentro = document.createElement('div'); dentro.style.width = pct + '%'; barra.appendChild(dentro);
    topo.append(t, barra);
    nova.appendChild(topo);
    if (!d.servidores.length) nova.appendChild(vazioAdmin('Nenhum servidor.'));
    d.servidores.forEach((s) => nova.appendChild(linhaAdmin({
        titulo: s.nome,
        sub: `imagens: ${tamanhoAdmin(s.imagens.bytes)} (${s.imagens.originais} original(is), ${s.imagens.compactadas} compactada(s)) · sons: ${s.sons.quantidade} (${tamanhoAdmin(s.sons.bytes)}) · ${s.mensagens} mensagem(ns) guardada(s)`,
        botoes: s.imagens.originais ? [{ texto: 'Compactar imagens', acao: async () => {
            const r = await pedirTexto({ titulo: `Compactar as imagens de "${s.nome}"?`, dica: 'As imagens originais deste servidor que têm versão reduzida passam a existir só nela. Continuam abrindo, com menos qualidade (GIF vira imagem parada). Não dá para desfazer.', semCampo: true, rotuloOk: 'Compactar' });
            if (!r) return;
            try { const x = await api('POST', '/admin/espaco/compactar', { servidorId: s.id }); mostrarNotificacao(`${x.feitas} imagem(ns) compactada(s), ${tamanhoAdmin(x.liberado)} liberados.`, 'info'); desenharAbaAdmin(); }
            catch (err) { mostrarNotificacao('Não foi possível: ' + err.message); }
        } }] : []
    })));
}

// ---- Aba "Sistema" ----
async function desenharAbaSistema(nova) {
    const d = await api('GET', '/admin/sistema');
    const salvar = async (corpo) => { try { await api('POST', '/admin/sistema/config', corpo); mostrarNotificacao('Salvo. Já está valendo.', 'info'); desenharAbaAdmin(); } catch (err) { mostrarNotificacao('Não foi possível salvar: ' + err.message); } };
    // Manutenção
    nova.appendChild(subtituloAdmin('Modo manutenção'));
    const fm = document.createElement('div'); fm.className = 'adm-form';
    const textoM = document.createElement('input'); textoM.type = 'text'; textoM.maxLength = 200; textoM.placeholder = 'Recado (ex.: Volto às 23h)'; textoM.value = d.config.manutencaoTexto || ''; textoM.style.flex = '1 1 240px';
    const estadoM = document.createElement('span'); estadoM.textContent = d.config.manutencao ? '🔴 LIGADO: só você consegue usar o app.' : 'Desligado.'; estadoM.style.flex = '1 1 100%';
    fm.append(estadoM, textoM, botaoAdmin(d.config.manutencao ? 'Desligar manutenção' : 'Ligar manutenção', async () => {
        if (!d.config.manutencao) {
            const r = await pedirTexto({ titulo: 'Ligar o modo manutenção?', dica: 'Todo mundo, menos os administradores, deixa de conseguir usar o app (chat, servidores, entrar em chamada) e vê o seu recado. Quem já está numa chamada continua nela.', semCampo: true, rotuloOk: 'Ligar' });
            if (!r) return;
        }
        salvar({ manutencao: !d.config.manutencao, manutencaoTexto: textoM.value });
    }, !d.config.manutencao));
    nova.appendChild(fm);
    // Limites
    nova.appendChild(subtituloAdmin('Limites'));
    const fl = document.createElement('div'); fl.className = 'adm-form';
    const vmin = document.createElement('input'); vmin.type = 'text'; vmin.maxLength = 14; vmin.placeholder = d.doArquivo.versaoMinima ? `padrão: ${d.doArquivo.versaoMinima}` : 'ex.: 3.15.0 (em branco = qualquer)'; vmin.value = d.config.versaoMinima || '';
    const lv = document.createElement('label'); lv.append('Versão mínima do app', vmin);
    const maxs = document.createElement('input'); maxs.type = 'text'; maxs.maxLength = 3; maxs.placeholder = `padrão: ${d.doArquivo.maxPorSala}`; maxs.value = d.config.maxPorSala === null || d.config.maxPorSala === undefined ? '' : String(d.config.maxPorSala); maxs.style.width = '90px';
    const lm = document.createElement('label'); lm.append('Máximo por chamada (0 = sem limite)', maxs);
    fl.append(lv, lm, botaoAdmin('Salvar limites', () => salvar({ versaoMinima: vmin.value.trim(), maxPorSala: maxs.value.trim() === '' ? null : Number(maxs.value) })));
    const valendo = document.createElement('div'); valendo.className = 'cfg-dica'; valendo.style.flex = '1 1 100%';
    valendo.textContent = `Valendo agora: versão mínima ${d.valendo.versaoMinima || 'nenhuma'} · máximo por chamada ${d.valendo.maxPorSala || 'sem limite'}. Cuidado com a versão mínima: quem estiver numa versão mais antiga é barrado até atualizar.`;
    fl.appendChild(valendo);
    nova.appendChild(fl);
    // Interruptores
    nova.appendChild(subtituloAdmin('Recursos (desligue se algo estiver dando problema)'));
    const fr = document.createElement('div'); fr.className = 'adm-form';
    [['imagens', 'Envio de imagens e GIFs no chat'], ['previas', 'Prévia de links'], ['sons', 'Envio de sons do servidor (soundboard)']].forEach(([nome, rotulo]) => {
        const l = document.createElement('label'); l.style.flex = '1 1 100%';
        const c = document.createElement('input'); c.type = 'checkbox'; c.checked = d.recursos[nome] !== false;
        c.addEventListener('change', async () => {
            try { await api('POST', '/admin/sistema/recurso', { nome, ligado: c.checked }); mostrarNotificacao(`${rotulo}: ${c.checked ? 'ligado' : 'desligado'}.`, 'info'); }
            catch (err) { c.checked = !c.checked; mostrarNotificacao('Não foi possível: ' + err.message); }
        });
        l.append(c, rotulo);
        fr.appendChild(l);
    });
    nova.appendChild(fr);
    // Moderadores
    nova.appendChild(subtituloAdmin(`Moderadores (${d.moderadores.length})`));
    if (!d.moderadores.length) nova.appendChild(vazioAdmin('Nenhum moderador. Para nomear: aba Pessoas > Ficha > "Tornar moderador".'));
    d.moderadores.forEach((m) => nova.appendChild(linhaAdmin({ usuario: m.usuario, titulo: m.nome, sub: 'moderador desde ' + dataHora(m.desde), botoes: [{ texto: 'Ficha', acao: () => abrirFichaAdmin(m.usuario) }, { texto: 'Tirar', perigo: true, acao: () => agirAdmin('DELETE', '/admin/moderadores/' + encodeURIComponent(m.usuario)) }] })));
}

// ============================================================
// O que a administração manda pra você: aviso geral (faixa no topo), modo manutenção e advertências.
// ============================================================
const CHAVE_AVISO_VISTO = 'estrivisor_aviso_visto';
let temporizadorAvisos = null;
let advertenciaNaTela = false;
function faixaDeAvisos() {
    let f = document.getElementById('faixa-aviso');
    if (!f) { f = document.createElement('div'); f.id = 'faixa-aviso'; f.className = 'faixa-aviso'; document.body.appendChild(f); }
    return f;
}
function desenharFaixaDeAvisos(d) {
    const f = faixaDeAvisos();
    f.replaceChildren();
    if (d && typeof d.manutencao === 'string' && d.manutencao) {
        const m = document.createElement('div'); m.className = 'manutencao'; m.textContent = '🛠️ ' + d.manutencao.slice(0, 200);
        f.appendChild(m);
    }
    const a = d && d.aviso;
    let visto = '';
    try { visto = localStorage.getItem(CHAVE_AVISO_VISTO) || ''; } catch (e) { /* sem armazenamento */ }
    if (a && typeof a.texto === 'string' && typeof a.id === 'string' && a.id !== visto) {
        const caixa = document.createElement('div');
        const t = document.createElement('span'); t.style.flex = '1'; t.textContent = '📢 ' + a.texto.slice(0, 300);
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '✖'; x.title = 'Fechar este aviso';
        x.addEventListener('click', () => { try { localStorage.setItem(CHAVE_AVISO_VISTO, a.id); } catch (e) { /* ok */ } caixa.remove(); });
        caixa.append(t, x);
        f.appendChild(caixa);
    }
}
// O cargo mudou (virou moderador, deixou de ser...): mostra ou esconde "Administração" na hora, sem reiniciar.
function aplicarPapelDaConta(papel) {
    if (papel === 'admin' || papel === 'moderador') {
        if (!acessoAdmin || papelAdmin !== papel) iniciarAcesso(); // descobre o resto (pedidos, contadores) e liga a checagem
        return;
    }
    if (papel === null && acessoAdmin) {
        acessoAdmin = false;
        pararAcesso();
        if (configAberta() && document.getElementById('cfg-painel-acesso').classList.contains('ativo')) irParaSecaoConfig('conta');
    }
}
const TEXTO_CARGO = {
    entrou: {
        titulo: '🛡️ Você se tornou moderador do Estrivisor',
        dica: 'O administrador te deu o cargo de moderador. Agora você pode:\n• liberar ou negar os pedidos de acesso;\n• ver a lista de pessoas e a ficha de cada uma;\n• advertir e escrever notas internas;\n• cuidar das denúncias: ignorar, remover a mensagem ou suspender por até 7 dias.\n\nTudo fica em Configurações > Administração, e cada ação sua aparece no histórico. Use com cuidado.',
    },
    saiu: {
        titulo: 'Você não é mais moderador do Estrivisor',
        dica: 'O administrador tirou o seu cargo de moderador. A opção "Administração" saiu das suas Configurações. O resto do app continua igual pra você.',
    },
};
let cargoNaTela = false;
async function mostrarAvisoDeCargo(c) {
    if (!c || cargoNaTela || !TEXTO_CARGO[c.tipo] || typeof c.id !== 'string') return;
    cargoNaTela = true;
    try {
        const t = TEXTO_CARGO[c.tipo];
        const r = await pedirTexto({ titulo: t.titulo, dica: t.dica + '\n\n' + dataHora(c.ts) + '.', semCampo: true, rotuloOk: 'Entendi' });
        if (r) { try { await api('POST', `/conta/cargo/${encodeURIComponent(c.id)}/visto`); } catch (e) { /* aparece de novo depois */ } }
        if (r && c.tipo === 'entrou') { await carregarAcesso(false); if (acessoAdmin) { abrirConfig('conta'); irParaSecaoConfig('acesso'); } }
    } finally { cargoNaTela = false; }
}

async function carregarAvisosDaConta() {
    let d;
    try { d = await api('GET', '/conta/avisos'); } catch (e) { return; } // servidor antigo ou fora do ar: nada a mostrar
    desenharFaixaDeAvisos(d);
    if (d && Object.prototype.hasOwnProperty.call(d, 'papel')) aplicarPapelDaConta(d.papel);
    // Se a pessoa está digitando numa janela (motivo de uma suspensão, por exemplo), o aviso espera o próximo ciclo.
    if (resolverModalTexto) return;
    if (d && d.cargo && !advertenciaNaTela) await mostrarAvisoDeCargo(d.cargo);
    const pendentes = Array.isArray(d.advertencias) ? d.advertencias : [];
    if (pendentes.length && !advertenciaNaTela) {
        advertenciaNaTela = true;
        try {
            for (const a of pendentes.slice(0, 5)) {
                const r = await pedirTexto({ titulo: '⚠️ Advertência da administração do Estrivisor', dica: String(a.texto || '').slice(0, 400) + '\n\nRecebida em ' + dataHora(a.ts) + '.', semCampo: true, rotuloOk: 'Entendi' });
                if (!r) break; // fechou sem confirmar: aparece de novo depois
                try { await api('POST', `/conta/advertencias/${encodeURIComponent(a.id)}/lida`); } catch (e) { break; }
            }
        } finally { advertenciaNaTela = false; }
    }
}
function iniciarAvisosDaConta() {
    pararAvisosDaConta();
    carregarAvisosDaConta();
    temporizadorAvisos = setInterval(carregarAvisosDaConta, 60000);
}
function pararAvisosDaConta() {
    if (temporizadorAvisos) { clearInterval(temporizadorAvisos); temporizadorAvisos = null; }
    const f = document.getElementById('faixa-aviso'); if (f) f.replaceChildren();
}

// ---- Aba "Chaves" (gerar, listar e revogar chaves de qualidade) ----
let chavesForm = { nivel: 'hd30', validade: '', qtd: '1', nota: '' };
let chavesRecemGeradas = []; // [{ chave, nivel, ... }] só ficam na tela até a pessoa fechar o aviso
const NOME_VALIDADE = (dias) => (dias ? `${dias} dia(s) após ativar` : 'permanente');

function desenharAbaChaves(nova, d) {
    const nomeNivel = (id) => (d.niveis.find((n) => n.id === id) || {}).nome || id;
    // Formulário
    const form = document.createElement('div');
    form.className = 'chaves-form';
    const selNivel = document.createElement('select');
    ['hd30', 'hd60', 'max'].forEach((id) => { const o = document.createElement('option'); o.value = id; o.textContent = nomeNivel(id); selNivel.appendChild(o); });
    selNivel.value = chavesForm.nivel;
    const selVal = document.createElement('select');
    [['', 'Permanente'], ['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias']].forEach(([v, r]) => { const o = document.createElement('option'); o.value = v; o.textContent = r; selVal.appendChild(o); });
    selVal.value = chavesForm.validade;
    const selQtd = document.createElement('select');
    ['1', '2', '5', '10'].forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v === '1' ? '1 chave' : v + ' chaves'; selQtd.appendChild(o); });
    selQtd.value = chavesForm.qtd;
    const nota = document.createElement('input');
    nota.type = 'text'; nota.maxLength = 60; nota.placeholder = 'Para quem é? (opcional)'; nota.value = chavesForm.nota;
    const gerar = document.createElement('button');
    gerar.textContent = 'Gerar';
    selNivel.onchange = () => { chavesForm.nivel = selNivel.value; };
    selVal.onchange = () => { chavesForm.validade = selVal.value; };
    selQtd.onchange = () => { chavesForm.qtd = selQtd.value; };
    nota.oninput = () => { chavesForm.nota = nota.value; };
    gerar.onclick = async () => {
        gerar.disabled = true;
        try {
            const r = await api('POST', '/admin/chaves', {
                nivel: chavesForm.nivel, validadeDias: chavesForm.validade ? Number(chavesForm.validade) : null,
                quantidade: Number(chavesForm.qtd), nota: chavesForm.nota
            });
            chavesRecemGeradas = r.chaves;
            chavesForm.nota = '';
            desenharAbaAdmin();
        } catch (err) { mostrarNotificacao('Não consegui gerar: ' + err.message); }
        gerar.disabled = false;
    };
    form.append(selNivel, selVal, selQtd, nota, gerar);
    nova.appendChild(form);

    // Chaves recém-geradas (única vez em que o texto aparece)
    if (chavesRecemGeradas.length) {
        const box = document.createElement('div');
        box.className = 'chaves-novas';
        const titulo = document.createElement('div');
        titulo.className = 'cfg-dica';
        titulo.textContent = 'Copie agora: depois de fechar este aviso as chaves não aparecem mais.';
        box.appendChild(titulo);
        const copiar = async (texto) => {
            try { await navigator.clipboard.writeText(texto); mostrarNotificacao('Copiado.', 'info'); }
            catch (e) { mostrarNotificacao('Não consegui copiar sozinho. Selecione o texto e use Ctrl+C.'); }
        };
        chavesRecemGeradas.forEach((c) => {
            const l = document.createElement('div');
            l.className = 'linha-chave';
            const cod = document.createElement('span');
            cod.className = 'chave-codigo';
            cod.textContent = c.chave;
            const info = document.createElement('span');
            info.className = 'cfg-dica';
            info.textContent = `${nomeNivel(c.nivel)} · ${NOME_VALIDADE(c.validadeDias)}${c.nota ? ' · ' + c.nota : ''}`;
            const b = document.createElement('button');
            b.textContent = 'Copiar';
            b.onclick = () => copiar(c.chave);
            l.append(cod, info, b);
            box.appendChild(l);
        });
        const linhaBt = document.createElement('div');
        linhaBt.className = 'acesso-botoes';
        if (chavesRecemGeradas.length > 1) {
            const todas = document.createElement('button');
            todas.textContent = 'Copiar todas';
            todas.onclick = () => copiar(chavesRecemGeradas.map((c) => c.chave).join('\n'));
            linhaBt.appendChild(todas);
        }
        const fechar = document.createElement('button');
        fechar.textContent = 'Já copiei';
        fechar.onclick = () => { chavesRecemGeradas = []; desenharAbaAdmin(); };
        linhaBt.appendChild(fechar);
        box.appendChild(linhaBt);
        nova.appendChild(box);
    }

    // Quem tem qualidade liberada
    const ativos = d.concedidos.filter((c) => !c.vencido);
    const tit1 = document.createElement('div');
    tit1.className = 'titulo-config';
    tit1.textContent = 'Pessoas com qualidade liberada';
    nova.appendChild(tit1);
    if (!ativos.length) nova.appendChild(vazioAdmin('Ninguém ativou uma chave ainda.'));
    ativos.forEach((c) => nova.appendChild(linhaAdmin({
        usuario: c.usuario, titulo: c.nome || c.usuario, selos: [{ texto: nomeNivel(c.nivel), tom: 'bom' }],
        sub: `ativou em ${dataHora(c.desde)} · ${c.ate ? 'vale até ' + dataHora(c.ate) : 'permanente'}`,
        botoes: [{ texto: 'Revogar', perigo: true, acao: () => revogarQualidade(c) }]
    })));

    // Todas as chaves
    const tit2 = document.createElement('div');
    tit2.className = 'titulo-config';
    tit2.textContent = 'Chaves geradas';
    nova.appendChild(tit2);
    if (!d.chaves.length) nova.appendChild(vazioAdmin('Nenhuma chave gerada.'));
    d.chaves.forEach((c) => {
        const usada = Boolean(c.usadaPor);
        const selos = [usada ? (c.revogadaEm ? { texto: 'revogada', tom: 'ruim' } : { texto: 'usada' }) : { texto: 'disponível', tom: 'bom' }];
        nova.appendChild(linhaAdmin({
            titulo: `${nomeNivel(c.nivel)} · ${NOME_VALIDADE(c.validadeDias)}`, selos,
            sub: `${c.nota ? c.nota + ' · ' : ''}criada em ${dataHora(c.criadaEm)}${usada ? ` · usada por ${c.usadaPorNome || c.usadaPor} em ${dataHora(c.usadaEm)}` : ''}`,
            botoes: usada ? [] : [{ texto: 'Apagar', perigo: true, acao: () => agirAdmin('DELETE', '/admin/chaves/' + encodeURIComponent(c.id)) }]
        }));
    });
}

async function revogarQualidade(c) {
    const ok = await pedirTexto({ titulo: `Revogar a qualidade de ${c.nome || 'esta pessoa'}?`, dica: 'Ela volta para 720p30. A chave que ela usou não pode ser usada de novo.', semCampo: true, rotuloOk: 'Revogar' });
    if (!ok) return;
    await agirAdmin('DELETE', '/admin/qualidade/' + encodeURIComponent(c.usuario));
}

function cartaoDenuncia(x) {
    const card = document.createElement('div');
    card.className = 'denuncia-card' + (x.estado === 'aberta' ? '' : ' resolvida');
    const onde = x.origem
        ? (x.origem.tipo === 'dm' ? `mensagem direta com ${x.origem.outroNome || ''}` : `canal #${x.origem.canalNome} em "${x.origem.servidorNome}"`)
        : 'denúncia da pessoa';
    const cab = document.createElement('div');
    cab.className = 'acesso-info';
    cab.innerHTML = `<b>${textoSeguro(MOTIVOS_DENUNCIA[x.motivo] || x.motivo)}<span class="selo ${x.estado === 'aberta' ? 'ruim' : ''}">${x.estado}</span></b>
        <span>${textoSeguro(x.deNome)} denunciou <strong>${textoSeguro(x.alvoNome)}</strong> · ${textoSeguro(onde)} · ${dataHora(x.ts)}</span>`;
    card.appendChild(cab);
    if (x.detalhe) { const d = document.createElement('div'); d.className = 'cfg-dica'; d.textContent = 'Relato: ' + x.detalhe; card.appendChild(d); }
    if (x.contexto && x.contexto.length) {
        const ctx = document.createElement('div');
        ctx.className = 'denuncia-ctx';
        x.contexto.forEach((m) => {
            const l = document.createElement('div');
            if (x.origem && m.seq === x.origem.seq) l.className = 'alvo';
            l.innerHTML = `<b>${textoSeguro(m.nome)}</b> <span class="cfg-dica">${dataHora(m.ts)}</span>: ${textoSeguro(m.texto)}`;
            ctx.appendChild(l);
        });
        card.appendChild(ctx);
    }
    if (x.estado === 'aberta') {
        const bt = document.createElement('div');
        bt.className = 'acesso-botoes';
        const add = (texto, perigo, acao) => { const b = document.createElement('button'); b.textContent = texto; if (perigo) b.className = 'cfg-btn-perigo'; b.onclick = acao; bt.appendChild(b); };
        add('Ignorar', false, () => agirAdmin('POST', `/admin/denuncias/${x.id}/resolver`, { acao: 'ignorar' }));
        if (x.origem) add('Remover mensagem', true, () => agirAdmin('POST', `/admin/denuncias/${x.id}/resolver`, { acao: 'remover-mensagem' }));
        add('Suspender', true, () => punirPessoa({ usuario: x.alvo, nome: x.alvoNome }, 'suspensao', x.id));
        if (papelAdmin === 'admin') add('Banir', true, () => punirPessoa({ usuario: x.alvo, nome: x.alvoNome }, 'ban', x.id));
        card.appendChild(bt);
    } else if (x.resolucao) {
        const r = document.createElement('div');
        r.className = 'cfg-dica';
        r.textContent = `Resolvida (${x.resolucao.acao}${x.resolucao.nota ? ': ' + x.resolucao.nota : ''}) em ${dataHora(x.resolucao.ts)}`;
        card.appendChild(r);
    }
    return card;
}

async function agirAdmin(metodo, caminho, corpo) {
    try { await api(metodo, caminho, corpo); await carregarAcesso(false); desenharAbaAdmin(); }
    catch (err) { mostrarNotificacao('Não foi possível concluir: ' + err.message); }
}

async function punirPessoa(p, tipo, denunciaId) {
    let dias;
    if (tipo === 'suspensao') {
        const maxDias = papelAdmin === 'admin' ? 365 : 7; // moderador suspende por até 7 dias
        const d = await pedirTexto({ titulo: `Suspender ${p.nome || 'esta pessoa'}`, dica: `Por quantos dias? (1 a ${maxDias})`, valor: String(Math.min(7, maxDias)), max: 3 });
        if (!d) return;
        dias = Number(d.texto);
        if (!Number.isInteger(dias) || dias < 1 || dias > maxDias) return mostrarNotificacao(`Digite um número de dias entre 1 e ${maxDias}.`);
    }
    const m = await pedirTexto({
        titulo: (tipo === 'ban' ? 'Banir ' : 'Suspender ') + (p.nome || 'esta pessoa'),
        dica: 'Escreva o motivo. A pessoa vai ler esta mensagem e ele fica no histórico.', max: 200, rotuloOk: tipo === 'ban' ? 'Banir' : 'Suspender'
    });
    if (!m) return;
    if (denunciaId) await agirAdmin('POST', `/admin/denuncias/${denunciaId}/resolver`, { acao: tipo === 'ban' ? 'banir' : 'suspender', dias, motivo: m.texto });
    else await agirAdmin('POST', '/admin/punir', { usuario: p.usuario, tipo, dias, motivo: m.texto });
}

async function removerAcesso(p) {
    const c = await pedirTexto({ titulo: `Remover ${p.nome || 'esta pessoa'}?`, dica: 'A pessoa perde o acesso ao Estrivisor na hora e pode pedir de novo.', semCampo: true, rotuloOk: 'Remover' });
    if (!c) return;
    await agirAdmin('DELETE', '/admin/acesso/' + encodeURIComponent(p.usuario));
}

async function apagarServidorAdmin(s) {
    const c = await pedirTexto({ titulo: `Apagar o servidor "${s.nome}"?`, dica: 'Remove canais, membros e todas as conversas dele. Não tem volta.', semCampo: true, rotuloOk: 'Apagar' });
    if (!c) return;
    await agirAdmin('DELETE', '/admin/servidores/' + encodeURIComponent(s.id));
}

function iniciarAcesso() {
    pararAcesso();
    carregarAcesso(false);
    temporizadorAcesso = setInterval(() => { if (acessoAdmin) carregarAcesso(true); }, 30000);
}
function pararAcesso() {
    if (temporizadorAcesso) { clearInterval(temporizadorAcesso); temporizadorAcesso = null; }
    if (!acessoAdmin) { const i = document.getElementById('cfg-item-acesso'); if (i) i.style.display = 'none'; }
    acessoPedidosVistos = null;
}

const chatDm = criarChat({
    container: document.getElementById('amigos-mensagens'),
    input: document.getElementById('amigos-input-mensagem'),
    aoSemAcesso: () => { dmAtual = null; mostrarDmVazio(); carregarAmigos(); }
});

function mostrarDmVazio() {
    chatDm.fechar();
    document.getElementById('amigos-vazio').style.display = 'flex';
    document.getElementById('amigos-chat').style.display = 'none';
    document.getElementById('amigos-cab-titulo').textContent = 'Mensagens diretas';
}

function abrirDm(amigo) {
    dmAtual = amigo;
    document.getElementById('amigos-vazio').style.display = 'none';
    document.getElementById('amigos-chat').style.display = 'flex';
    document.getElementById('amigos-cab-titulo').textContent = '@ ' + amigo.nome;
    document.getElementById('amigos-input-mensagem').placeholder = `Enviar mensagem para ${amigo.nome}`;
    chatDm.abrir({
        caminho: `/dm/${encodeURIComponent(amigo.usuario)}/mensagens`,
        chaveLida: chaveDmLocal(amigo.usuario),
        podeModerar: () => false
    });
    renderizarAmigos();
    document.getElementById('amigos-input-mensagem').focus();
}

function subtituloAmigo(a) {
    if (!a.online) return 'Offline';
    return a.emVoz ? '🔊 Em chamada' : 'Online';
}

function linhaPessoa(p, { status, sub, acoes, acoesSempre, aoClicar, ativo, nl }) {
    const linha = document.createElement('div');
    linha.className = 'amigo-linha' + (ativo ? ' ativo' : '');
    linha.innerHTML = `
        <span class="avatar-wrap"><span class="avatar-participante"></span>${status !== undefined ? '<span class="ponto-status"></span>' : ''}</span>
        <span class="amigo-info"><span class="amigo-nome"></span><span class="amigo-sub"></span></span>`;
    aplicarAvatar(linha.querySelector('.avatar-participante'), p.usuario, p.nome, urlAvatarSegura(p.avatar));
    linha.querySelector('.amigo-nome').textContent = p.nome;
    linha.querySelector('.amigo-sub').textContent = (status && status.texto) || sub || '';
    if (status !== undefined) linha.querySelector('.ponto-status').className = 'ponto-status' + (status.classe ? ' ' + status.classe : '');
    if (nl) { const b = document.createElement('span'); b.className = 'badge-nl'; b.textContent = nl > 99 ? '99+' : String(nl); linha.appendChild(b); }
    if (acoes && acoes.length) {
        const div = document.createElement('span');
        div.className = 'amigo-acoes' + (acoesSempre ? ' sempre' : '');
        acoes.forEach(([rotulo, titulo, fn]) => {
            const b = document.createElement('button');
            b.textContent = rotulo; b.title = titulo;
            b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
            div.appendChild(b);
        });
        linha.appendChild(div);
    }
    if (aoClicar) linha.addEventListener('click', aoClicar);
    return linha;
}

async function acaoAmizade(metodo, caminho, corpo, erroTexto) {
    try { await api(metodo, caminho, corpo); } catch (err) { mostrarNotificacao(erroTexto + ' ' + err.message); }
    await carregarAmigos();
}

function renderizarAmigos() {
    const lista = document.getElementById('amigos-lista');
    lista.innerHTML = '';
    document.getElementById('amigos-codigo').textContent = amigosEstado.codigo || '—';
    const pt = document.getElementById('amigos-pt');
    pt.style.display = amigosEstado.recebidos.length ? '' : 'none';
    pt.textContent = String(amigosEstado.recebidos.length);
    document.querySelectorAll('#amigos-abas button').forEach((b) => b.classList.toggle('ativo', b.dataset.aba === abaAmigos));
    document.getElementById('amigos-adicionar').style.display = abaAmigos === 'adicionar' ? 'flex' : 'none';

    const vazio = (texto) => { const d = document.createElement('div'); d.className = 'amigos-vazio'; d.textContent = texto; lista.appendChild(d); };

    if (abaAmigos === 'amigos') {
        if (!amigosEstado.amigos.length) return vazio('Você ainda não tem amigos adicionados. Use a aba Adicionar com o código de um amigo, ou clique numa pessoa da lista de online de um servidor.');
        const ordenados = [...amigosEstado.amigos].sort((a, b) => (b.online - a.online) || a.nome.localeCompare(b.nome, 'pt-BR'));
        ordenados.forEach((a) => {
            lista.appendChild(linhaPessoa(a, {
                status: { texto: subtituloAmigo(a), classe: a.online ? (a.emVoz ? 'voz' : 'on') : '' },
                ativo: dmAtual && dmAtual.usuario === a.usuario,
                nl: dmAtual && dmAtual.usuario === a.usuario && chatDm.ativo() ? 0 : naoLidas(chaveDmLocal(a.usuario)),
                aoClicar: () => abrirDm(a),
                acoes: [['✕', 'Remover amigo', async () => {
                    const r = await pedirTexto({ titulo: `Remover ${a.nome}?`, dica: 'Vocês deixam de ser amigos. O histórico da conversa volta se adicionarem de novo.', semCampo: true, rotuloOk: 'Remover' });
                    if (!r) return;
                    if (dmAtual && dmAtual.usuario === a.usuario) { dmAtual = null; mostrarDmVazio(); }
                    acaoAmizade('DELETE', `/amigos/${encodeURIComponent(a.usuario)}`, undefined, 'Não consegui remover:');
                }]]
            }));
        });
    } else if (abaAmigos === 'pendentes') {
        if (!amigosEstado.recebidos.length && !amigosEstado.enviados.length) return vazio('Nenhum pedido pendente.');
        amigosEstado.recebidos.forEach((p) => lista.appendChild(linhaPessoa(p, {
            sub: 'Quer ser seu amigo', acoesSempre: true,
            acoes: [
                ['✔', 'Aceitar', () => acaoAmizade('POST', '/amigos/aceitar', { usuario: p.usuario }, 'Não consegui aceitar:')],
                ['✕', 'Recusar', () => acaoAmizade('POST', '/amigos/recusar', { usuario: p.usuario }, 'Não consegui recusar:')]
            ]
        })));
        amigosEstado.enviados.forEach((p) => lista.appendChild(linhaPessoa(p, {
            sub: 'Pedido enviado', acoesSempre: true,
            acoes: [['Cancelar', 'Cancelar pedido', () => acaoAmizade('POST', '/amigos/recusar', { usuario: p.usuario }, 'Não consegui cancelar:')]]
        })));
    }
}

async function enviarPedidoAmizade() {
    const campo = document.getElementById('amigos-input-codigo');
    const res = document.getElementById('amigos-resultado');
    const codigo = campo.value.trim();
    if (!codigo) return;
    res.className = 'resultado'; res.textContent = 'Enviando...';
    try {
        const r = await api('POST', '/amigos/pedir', { codigo });
        res.className = 'resultado ok';
        res.textContent = r.resultado === 'amigos' ? `Pronto! Você e ${r.pessoa.nome} agora são amigos.` : `Pedido enviado para ${r.pessoa.nome}. Falta ela aceitar.`;
        campo.value = '';
        carregarAmigos();
    } catch (err) {
        res.className = 'resultado erro';
        res.textContent = err.message;
    }
}
document.getElementById('amigos-enviar-pedido').addEventListener('click', enviarPedidoAmizade);
document.getElementById('amigos-input-codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarPedidoAmizade(); });
document.querySelectorAll('#amigos-abas button').forEach((b) => b.addEventListener('click', () => {
    abaAmigos = b.dataset.aba;
    document.getElementById('amigos-resultado').textContent = '';
    renderizarAmigos();
}));

function copiarTexto(texto, aviso) {
    const ok = () => mostrarNotificacao(aviso || 'Copiado!', 'info');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(ok).catch(() => copiarReserva(texto, ok));
    } else copiarReserva(texto, ok);
}
function copiarReserva(texto, ok) {
    const t = document.createElement('textarea');
    t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (e) { mostrarNotificacao('Não consegui copiar. Selecione e copie à mão: ' + texto); }
    t.remove();
}
document.getElementById('amigos-copiar').addEventListener('click', () => { if (amigosEstado.codigo) copiarTexto(amigosEstado.codigo, 'Código copiado!'); });
document.getElementById('cfg-copiar-codigo').addEventListener('click', () => { if (amigosEstado.codigo) copiarTexto(amigosEstado.codigo, 'Código copiado!'); });
document.getElementById('cfg-trocar-codigo').addEventListener('click', async () => {
    const ok = await pedirTexto({
        titulo: 'Trocar o código de amigo?',
        dica: 'O código atual deixa de funcionar. Quem já é seu amigo continua sendo; só quem ainda não te adicionou vai precisar do código novo.',
        semCampo: true, rotuloOk: 'Trocar',
    });
    if (!ok) return;
    try {
        const d = await api('POST', '/amigos/codigo/trocar', {});
        amigosEstado.codigo = String(d.codigo || '');
        document.getElementById('cfg-codigo-amigo').textContent = amigosEstado.codigo || '—';
        document.getElementById('amigos-codigo').textContent = amigosEstado.codigo || '—';
        mostrarNotificacao('Código trocado!');
    } catch (err) { mostrarNotificacao(err.message || 'Não consegui trocar o código.'); }
});

function abrirAmigos(aba, usuarioParaAbrir) {
    if (!obterIdentidadeUsuario()) return mostrarNotificacao('Entre com a sua conta pra usar a lista de amigos.');
    if (configAberta()) fecharConfig();
    if (aba) abaAmigos = aba;
    document.getElementById('tela-amigos').style.display = 'flex';
    renderizarAmigos();
    renderizarBarraServidores();
    carregarAmigos().then(() => {
        const a = usuarioParaAbrir && amigosEstado.amigos.find((x) => x.usuario === usuarioParaAbrir);
        if (a) abrirDm(a);
    });
}
function fecharAmigos() {
    const tela = document.getElementById('tela-amigos');
    if (tela.style.display !== 'flex') return;
    tela.style.display = 'none';
    mostrarDmVazio();
    dmAtual = null;
    renderizarBarraServidores();
}
document.getElementById('amigos-fechar').addEventListener('click', fecharAmigos);
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !amigosAbertos() || configAberta()) return;
    if (document.getElementById('modal-texto').style.display === 'flex' || menuContextoAberto) return;
    fecharAmigos();
});
window.addEventListener('focus', () => { chatCanal.marcarVisto(); chatDm.marcarVisto(); });

// ---------- Adicionar amigo / mandar mensagem a partir de uma pessoa ----------
async function pedirAmizadePorUsuario(usuario) {
    try {
        const r = await api('POST', '/amigos/pedir', { usuario });
        mostrarNotificacao(r.resultado === 'amigos' ? `Você e ${r.pessoa.nome} agora são amigos!` : `Pedido enviado para ${r.pessoa.nome}.`, 'info');
        carregarAmigos();
    } catch (err) { mostrarNotificacao(err.message); }
}
function itemAmizade(usuario) {
    if (usuario === obterIdentidadeUsuario()) return { id: 'eu', rotulo: 'Você', desabilitado: true, acao: () => {} };
    if (amigosEstado.amigos.some((a) => a.usuario === usuario)) return { id: 'dm', rotulo: '💬 Enviar mensagem', acao: () => abrirAmigos('amigos', usuario) };
    if (amigosEstado.enviados.some((p) => p.usuario === usuario)) return { id: 'pend', rotulo: '⏳ Pedido de amizade enviado', desabilitado: true, acao: () => {} };
    if (amigosEstado.recebidos.some((p) => p.usuario === usuario)) return { id: 'aceitar', rotulo: '✔ Aceitar pedido de amizade', acao: () => acaoAmizade('POST', '/amigos/aceitar', { usuario }, 'Não consegui aceitar:') };
    return { id: 'add', rotulo: '➕ Adicionar amigo', acao: () => pedirAmizadePorUsuario(usuario) };
}
// Menu de uma pessoa (clique ou botão direito no nome, online ou offline). As opções mudam conforme quem você é:
// todo mundo vê perfil, amizade, chamada, copiar e denunciar; o dono do servidor vê "dar o servidor" e "expulsar";
// a administração vê ficha e advertir; o Fundador vê também tornar/tirar moderador.
function abrirMenuPessoa(x, y, usuario, nome) {
    abrirMenu(x, y, () => ({ cabecalho: nome, itens: itensDePessoa(String(usuario), nome) }));
}
// As opções sobre uma pessoa (usadas no menu da lista de membros e no menu de quem está na chamada).
// naChamada = o menu veio da lista da chamada (não mostra "entrar na chamada").
function itensDePessoa(usuario, nome, { naChamada = false } = {}) {
    const eu = obterIdentidadeUsuario();
    const ehEu = usuario === eu;
    const idDiscord = /^discord:(\d+)$/.exec(usuario);
    {
        const itens = [{ id: 'perfil', rotulo: ehEu ? '👤 Ver o meu perfil' : '👤 Ver perfil', acao: () => abrirPerfil(usuario) }];
        if (ehEu) {
            itens.push({ id: 'status', rotulo: '💬 Mudar o meu status', acao: () => editarStatusPersonalizado() });
        } else {
            itens.push(itemAmizade(usuario));
            // Está numa chamada deste servidor? Dá pra entrar direto na mesma.
            const info = presencaParticipantes.get(usuario);
            const canal = !naChamada && info && info.canalVoz ? (servidorAtual.canais || []).find((c) => c.id === info.canalVoz && c.tipo === 'voz') : null;
            if (canal && !(vozConectada() && canalVozAtual && canalVozAtual.id === canal.id)) {
                itens.push({ id: 'chamada', rotulo: `🔊 Entrar na chamada (${String(canal.nome).slice(0, 24)})`, acao: () => entrarCanalVoz(canal) });
            }
        }
        itens.push({ separador: true });
        itens.push({ id: 'copiar-nome', rotulo: '📋 Copiar o nome', acao: () => copiarTexto(String(nome || ''), 'Nome copiado!') });
        if (idDiscord) itens.push({ id: 'copiar-id', rotulo: '🆔 Copiar o ID do Discord', acao: () => copiarTexto(idDiscord[1], 'ID copiado!') });
        const membro = (servidorAtual.membros || []).find((m) => String(m.usuario) === usuario);
        // Dono do servidor: gerenciar o membro.
        if (!ehEu && servidorAtual.souDono && membro && !membro.dono) {
            itens.push({ separador: true });
            itens.push({ id: 'dar-servidor', rotulo: '👑 Dar o servidor pra esta pessoa', acao: () => transferirServidor(membro) });
            itens.push({ id: 'expulsar', rotulo: '🚪 Expulsar do servidor', perigo: true, acao: () => expulsarMembro(membro) });
        }
        // Administração do Estrivisor.
        if (!ehEu && acessoAdmin) {
            const cargos = cargosDe(usuario);
            const ehFundador = cargos.includes('fundador');
            const ehMod = cargos.includes('moderador');
            itens.push({ separador: true });
            itens.push({ id: 'ficha', rotulo: '🗂️ Ficha (administração)', acao: () => abrirFichaAdmin(usuario) });
            if (!ehFundador && (papelAdmin === 'admin' || !ehMod)) itens.push({ id: 'advertir', rotulo: '⚠️ Advertir', acao: () => advertirPessoa({ usuario, nome }) });
            if (papelAdmin === 'admin' && !ehFundador && idDiscord) {
                itens.push({ id: 'moderador', rotulo: ehMod ? '🛡️ Tirar de moderador' : '🛡️ Tornar moderador', acao: () => alternarModeradorPeloMenu(usuario, nome, ehMod) });
            }
        }
        if (!ehEu) { itens.push({ separador: true }); itens.push(itemDenunciar(usuario, nome)); }
        return itens;
    }
}
async function alternarModeradorPeloMenu(usuario, nome, ehMod) {
    const r = await pedirTexto({
        titulo: ehMod ? `Tirar ${nome} de moderador?` : `Tornar ${nome} moderador?`,
        dica: ehMod ? 'A pessoa perde os poderes na hora e recebe um aviso.' : 'Moderadores liberam pedidos de acesso, advertem, escrevem notas e cuidam das denúncias (suspensão de até 7 dias). Não podem banir. A pessoa recebe um aviso.',
        semCampo: true, rotuloOk: ehMod ? 'Tirar' : 'Tornar moderador',
    });
    if (!r) return;
    try {
        if (ehMod) await api('DELETE', `/admin/moderadores/${encodeURIComponent(usuario)}`);
        else await api('POST', '/admin/moderadores', { usuario });
        mostrarNotificacao(ehMod ? `${nome} não é mais moderador.` : `${nome} agora é moderador.`, 'info');
        carregarConquistasMembros();
    } catch (err) { mostrarNotificacao('Não foi possível: ' + err.message); }
}

// ============================================================
// Inicialização
// ============================================================
carregarPreferenciasAudio();
carregarFundo();
carregarPreferenciasVideo();
atualizarBotaoMicrofone();
renderizarListaCanais();
aplicarNomeServidor();
iniciarPerfil();
