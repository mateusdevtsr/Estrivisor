'use strict';
// Tela da janela flutuante. Só desenha o estado que chega e manda os três comandos.
// Tudo é montado com textContent/createElement (nunca com HTML em texto).
(function () {
    const api = window.flutuanteAPI;
    const el = (id) => document.getElementById(id);

    function corDoAvatar(chave) {
        let h = 0;
        for (const c of String(chave || '?')) h = (h * 31 + c.codePointAt(0)) % 360;
        return `hsl(${h}, 55%, 42%)`;
    }

    function criarLinha(p) {
        const linha = document.createElement('div');
        linha.className = 'linha' + (p.falando ? ' falando' : '');

        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        if (p.avatar) {
            const img = document.createElement('img');
            img.alt = '';
            img.draggable = false;
            img.referrerPolicy = 'no-referrer';
            img.src = p.avatar;
            avatar.appendChild(img);
        } else {
            avatar.textContent = (p.nome || '?').charAt(0).toUpperCase();
            avatar.style.backgroundColor = corDoAvatar(p.id || p.nome);
        }
        linha.appendChild(avatar);

        const nome = document.createElement('span');
        nome.className = 'nome';
        nome.textContent = p.nome;
        linha.appendChild(nome);

        if (p.transmitindo) {
            const tela = document.createElement('span');
            tela.className = 'marca tela';
            tela.textContent = 'tela';
            tela.title = 'Transmitindo a tela';
            linha.appendChild(tela);
        }
        if (!p.mic) {
            const mudo = document.createElement('span');
            mudo.className = 'marca mudo';
            mudo.textContent = 'mudo';
            mudo.title = 'Microfone desligado';
            linha.appendChild(mudo);
        }
        return linha;
    }

    let ultimoAviso = 0, timerAviso = null;
    function mostrarAviso(a) {
        const caixa = el('aviso');
        if (!a || a.id === ultimoAviso) return;
        ultimoAviso = a.id;
        caixa.textContent = a.texto;
        caixa.classList.toggle('saiu', /saiu\b/.test(a.texto));
        caixa.hidden = false;
        clearTimeout(timerAviso);
        timerAviso = setTimeout(() => { caixa.hidden = true; }, 4500);
    }

    function desenhar(estado) {
        if (!estado || typeof estado !== 'object') return;
        const msg = el('msg');
        if (estado.mensagem) {
            el('msg-autor').textContent = estado.mensagem.autor + ':';
            el('msg-texto').textContent = estado.mensagem.texto;
            msg.hidden = false;
        } else {
            msg.hidden = true;
        }
        mostrarAviso(estado.aviso);
        el('titulo').textContent = estado.canal ? `${estado.canal} · ${estado.total}` : 'Sala de voz';

        const lista = el('lista');
        lista.textContent = '';
        const pessoas = Array.isArray(estado.participantes) ? estado.participantes : [];
        if (!pessoas.length) {
            const vazio = document.createElement('div');
            vazio.className = 'vazio';
            vazio.textContent = 'Ninguém na sala.';
            lista.appendChild(vazio);
        }
        pessoas.forEach((p) => lista.appendChild(criarLinha(p)));

        const mic = el('btn-mic');
        mic.classList.toggle('mudo', !estado.microfone);
        mic.title = estado.microfone ? 'Microfone ligado (clique para desligar)' : 'Microfone desligado (clique para ligar)';
        const surdo = el('btn-surdo');
        surdo.classList.toggle('mudo', Boolean(estado.surdo));
        surdo.textContent = estado.surdo ? '🔇' : '🔊';
        surdo.title = estado.surdo ? 'Reativar o áudio recebido' : 'Silenciar o áudio recebido';
    }

    if (!api) return;
    api.aoEstado(desenhar);
    el('btn-mic').addEventListener('click', () => api.comando('mic'));
    el('btn-surdo').addEventListener('click', () => api.comando('surdo'));
    el('btn-sair').addEventListener('click', () => api.comando('sair'));
    el('btn-esconder').addEventListener('click', () => api.esconder());
})();
