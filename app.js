/* ------------------------------------------------------------------
   Julia — Baby Shower
   Carrega o catálogo (presentes.json), cruza-o com as reservas e
   desenha a página. Sem frameworks.

   Modo online ......... Supabase configurado em config.js
   Modo pré-visualização . config.js vazio (reservas só neste dispositivo)
------------------------------------------------------------------ */

(function () {
  "use strict";

  const CFG = window.SUPABASE_CONFIG || { url: "", anonKey: "" };
  const ONLINE = Boolean(CFG.url && CFG.anonKey);
  const CHAVE_LOCAL = "julia_reservas";
  const CHAVE_PRESENCAS = "julia_presencas";
  const CHAVE_SUGESTOES = "julia_sugestoes";

  const estado = {
    config: {},
    catalogo: [],
    reservas: {},   // { idDoPresente: true } — só saber se está reservado, nunca por quem
    filtro: "Todas"
  };

  const porId = (id) => document.getElementById(id);

  /* ============================ DADOS ============================ */

  async function carregarCatalogo() {
    const resposta = await fetch("presentes.json", { cache: "no-store" });
    if (!resposta.ok) throw new Error("Não foi possível ler o ficheiro presentes.json.");

    const dados = await resposta.json();
    estado.config = dados.config || {};
    estado.catalogo = dados.presentes || [];

    // Presentes já reservados antes de existir base de dados
    estado.catalogo.forEach((p) => {
      if (p.reservado && p.reservadoPor) {
        estado.reservas[p.id] = true;
      }
    });
  }

  function cabecalhos(extra) {
    return Object.assign({
      apikey: CFG.anonKey,
      Authorization: "Bearer " + CFG.anonKey,
      "Content-Type": "application/json"
    }, extra || {});
  }

  async function carregarReservas() {
    if (!ONLINE) {
      try {
        Object.assign(estado.reservas, JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "{}"));
      } catch (e) {
        console.warn("Reservas locais ilegíveis, a começar do zero.");
      }
      return;
    }

    // Lê a vista pública: devolve apenas que presentes estão reservados,
    // nunca os nomes de quem reservou.
    const url = CFG.url + "/rest/v1/reservas_publicas?select=presente_id";
    const resposta = await fetch(url, { headers: cabecalhos() });
    if (!resposta.ok) throw new Error("Não foi possível carregar as reservas.");

    const linhas = await resposta.json();
    linhas.forEach(function (linha) {
      estado.reservas[linha.presente_id] = true;
    });
  }

  async function guardarReserva(presenteId, nome, mensagem) {
    // Separa os nomes (ex: "Ana, João e Maria") para cada pessoa ficar
    // numa linha própria no Supabase, igual às presenças.
    const nomes = separarNomes(nome);
    if (!nomes.length) {
      throw new Error("Escreve o teu nome, por favor.");
    }

    if (!ONLINE) {
      const locais = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "{}");
      locais[presenteId] = { nomes: nomes, mensagem: mensagem };
      localStorage.setItem(CHAVE_LOCAL, JSON.stringify(locais));
      estado.reservas[presenteId] = true;
      return;
    }

    // Reserva atómica: a função RPC no Supabase bloqueia o presente e
    // verifica se já está reservado, evitando duplicados mesmo que duas
    // pessoas cliquem ao mesmo tempo. Devolve true se reservou, false
    // se o presente já estava reservado.
    const resposta = await fetch(CFG.url + "/rest/v1/rpc/reservar_presente", {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify({ p_presente_id: presenteId, p_nomes: nomes, p_mensagem: mensagem || null })
    });
    if (!resposta.ok) throw new Error("Não foi possível guardar a reserva. Tenta novamente.");

    estado.reservas[presenteId] = true;
    if (!(await resposta.json())) {
      desenharLista();
      throw new Error("Alguém acabou de reservar este presente. Escolhe outro da lista.");
    }
  }

  // Separa o texto escrito no formulário em nomes individuais, para
  // que cada pessoa fique numa linha própria no Supabase e seja fácil
  // contar quantas pessoas vêm.
  function separarNomes(texto) {
    return texto
      .split(/[\n,;]|\s+e\s+/i)
      .map(function (n) { return n.trim().replace(/\s+/g, " "); })
      .filter(function (n) { return n.length > 0 && n.length <= 120; });
  }

  async function guardarPresenca(texto) {
    const nomes = separarNomes(texto);
    if (!nomes.length) {
      throw new Error("Escreve pelo menos um nome, por favor.");
    }

    if (!ONLINE) {
      const locais = JSON.parse(localStorage.getItem(CHAVE_PRESENCAS) || "[]");
      nomes.forEach(function (n) {
        locais.push({ nome: n, criado_em: new Date().toISOString() });
      });
      localStorage.setItem(CHAVE_PRESENCAS, JSON.stringify(locais));
      return nomes.length;
    }

    // Insere uma linha por pessoa, num único pedido.
    const corpo = nomes.map(function (n) { return { nome: n }; });
    const resposta = await fetch(CFG.url + "/rest/v1/presencas", {
      method: "POST",
      headers: cabecalhos({ Prefer: "return=minimal" }),
      body: JSON.stringify(corpo)
    });

    if (!resposta.ok) {
      throw new Error("Não foi possível guardar a confirmação. Tenta novamente.");
    }

    return nomes.length;
  }

  async function guardarSugestao(sugestao, nome) {
    if (!ONLINE) {
      const locais = JSON.parse(localStorage.getItem(CHAVE_SUGESTOES) || "[]");
      locais.push({
        sugestao: sugestao,
        nome: nome || null,
        criado_em: new Date().toISOString()
      });
      localStorage.setItem(CHAVE_SUGESTOES, JSON.stringify(locais));
      return;
    }

    const resposta = await fetch(CFG.url + "/rest/v1/sugestoes_presentes", {
      method: "POST",
      headers: cabecalhos({ Prefer: "return=minimal" }),
      body: JSON.stringify({ sugestao: sugestao, nome: nome || null })
    });

    if (!resposta.ok) {
      throw new Error("Não foi possível enviar a sugestão. Tenta novamente.");
    }
  }

  /* =========================== UTILIDADES =========================== */

  function formatarData(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
  }

  function mostrarToast(texto) {
    const toast = porId("toast");
    toast.textContent = texto;
    toast.hidden = false;
    clearTimeout(mostrarToast.timer);
    mostrarToast.timer = setTimeout(function () {
      toast.hidden = true;
    }, 4000);
  }

  /* ======================== CABEÇALHO E TEXTOS ======================== */

  function preencherTextos() {
    const c = estado.config;

    if (c.nomeBebe) {
      document.title = c.nomeBebe + " — Baby Shower";
      porId("nomeBebe").textContent = c.nomeBebe;
      porId("heroSub").textContent = "Estamos à espera da nossa menina.";
    }

    const meta = porId("heroMeta");
    meta.innerHTML = "";
    [
      c.dataCha ? formatarData(c.dataCha) : "",
      c.horaCha || "",
      c.localCha || ""
    ].filter(Boolean).forEach(function (texto) {
      const span = document.createElement("span");
      span.textContent = texto;
      meta.appendChild(span);
    });

    porId("textoIntro").textContent = c.textoIntro || "";
    porId("textoPais").textContent = c.nomePais ? "Com carinho, " + c.nomePais + "." : "";
    porId("textoRsvp").textContent = c.textoRsvp || "";
    porId("footerAgradecimento").textContent = c.agradecimento || "";

    const botao = porId("btnWhatsapp");
    const numero = String(c.whatsapp || "").replace(/\D/g, "");
    if (numero) {
      botao.href = "https://wa.me/" + numero + "?text=" +
        encodeURIComponent(c.mensagemWhatsapp || "Olá!");
    } else {
      botao.hidden = true;
    }

  }

  function iniciarContagem() {
    const alvo = estado.config.dataCha || estado.config.dataParto;
    const caixa = porId("countdown");
    if (!alvo) { caixa.hidden = true; return; }

    const fim = new Date(alvo + "T00:00:00");
    if (isNaN(fim)) { caixa.hidden = true; return; }

    function desenhar() {
      const restante = fim - new Date();

      if (restante <= -86400000) { caixa.hidden = true; clearInterval(relogio); return; }

      if (restante <= 0) {
        caixa.innerHTML = "";
        const p = document.createElement("p");
        p.className = "countdown__done";
        p.textContent = "Chegou o grande dia!";
        caixa.appendChild(p);
        clearInterval(relogio);
        return;
      }

      const dias = Math.floor(restante / 86400000);
      const horas = Math.floor((restante % 86400000) / 3600000);
      const minutos = Math.floor((restante % 3600000) / 60000);

      caixa.innerHTML = "";
      [
        { num: dias, rotulo: dias === 1 ? "dia" : "dias" },
        { num: horas, rotulo: horas === 1 ? "hora" : "horas" },
        { num: minutos, rotulo: "min" }
      ].forEach(function (bloco) {
        const celula = document.createElement("div");
        celula.className = "countdown__cell";

        const num = document.createElement("span");
        num.className = "countdown__num";
        num.textContent = bloco.num;

        const rotulo = document.createElement("span");
        rotulo.className = "countdown__label";
        rotulo.textContent = bloco.rotulo;

        celula.appendChild(num);
        celula.appendChild(rotulo);
        caixa.appendChild(celula);
      });
    }

    const relogio = setInterval(desenhar, 30000);
    desenhar();
  }

  /* ========================== LISTA DE PRESENTES ========================== */

  function categorias() {
    const lista = [];
    estado.catalogo.forEach(function (p) {
      const cat = p.categoria || "Outros";
      if (lista.indexOf(cat) === -1) lista.push(cat);
    });
    return lista;
  }

  function desenharFiltros() {
    const caixa = porId("filters");
    caixa.innerHTML = "";

    ["Todas"].concat(categorias()).forEach(function (cat) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "chip";
      botao.setAttribute("role", "tab");
      botao.setAttribute("aria-selected", String(estado.filtro === cat));
      botao.textContent = cat;
      botao.addEventListener("click", function () {
        estado.filtro = cat;
        desenharFiltros();
        desenharLista();
      });
      caixa.appendChild(botao);
    });
  }

  // Descobre a foto do presente. Se o JSON tiver "imagem", usa essa.
  // Caso contrário, procura imagens/<id>.jpg (e depois .jpeg/.png/.webp).
  function candidatosImagem(presente) {
    if (presente.imagem) return [presente.imagem];
    const base = "imagens/" + presente.id;
    return [base + ".jpg", base + ".jpeg", base + ".png", base + ".webp"];
  }

  function criarCartao(presente) {
    const reserva = estado.reservas[presente.id];

    const cartao = document.createElement("article");
    cartao.className = "card" + (reserva ? " card--taken" : "");

    const arte = document.createElement("div");
    arte.className = "card__art card__art--foto";

    const fontes = candidatosImagem(presente);
    const foto = document.createElement("img");
    foto.className = "card__photo";
    foto.alt = presente.nome;
    foto.loading = "lazy";

    let tentativa = 0;

    foto.addEventListener("load", function () {
      foto.classList.add("card__photo--pronta");
    });

    // Se uma extensão falhar, tenta a seguinte; se todas falharem, mostra o emoji.
    foto.addEventListener("error", function () {
      tentativa += 1;
      if (tentativa < fontes.length) {
        foto.src = fontes[tentativa];
        return;
      }
      arte.classList.remove("card__art--foto");
      foto.remove();
      arte.textContent = presente.emoji || "🎁";
    });

    arte.appendChild(foto);
    foto.src = fontes[0];

    const corpo = document.createElement("div");
    corpo.className = "card__body";

    const cat = document.createElement("span");
    cat.className = "card__cat";
    cat.textContent = presente.categoria || "Presente";

    const titulo = document.createElement("h3");
    titulo.className = "card__title";
    titulo.textContent = presente.nome;

    corpo.appendChild(cat);
    corpo.appendChild(titulo);

    if (presente.descricao) {
      const desc = document.createElement("p");
      desc.className = "card__desc";
      desc.textContent = presente.descricao;
      corpo.appendChild(desc);
    }

    if (presente.quantidade > 1) {
      const qtd = document.createElement("p");
      qtd.className = "card__qty";
      qtd.textContent = "Sugestão: " + presente.quantidade + " unidades";
      corpo.appendChild(qtd);
    }

    if (presente.preco) {
      const preco = document.createElement("p");
      preco.className = "card__price";
      preco.textContent = presente.preco;
      corpo.appendChild(preco);
    }

    if (presente.link) {
      const link = document.createElement("a");
      link.className = "card__link";
      link.href = presente.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Ver sugestão de loja →";
      corpo.appendChild(link);
    }

    const pe = document.createElement("div");
    pe.className = "card__foot";

    if (reserva) {
      const estadoTxt = document.createElement("span");
      estadoTxt.className = "card__status";
      // Nunca mostramos quem reservou: o site é público.
      estadoTxt.textContent = "Reservado";
      pe.appendChild(estadoTxt);
    } else {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "btn btn--primary btn--sm";
      botao.textContent = "Reservar";
      botao.addEventListener("click", function () { abrirModal(presente); });
      pe.appendChild(botao);
    }

    cartao.appendChild(arte);
    cartao.appendChild(corpo);
    cartao.appendChild(pe);
    return cartao;
  }

  function desenharLista() {
    const grelha = porId("grid");
    grelha.innerHTML = "";

    // Os presentes reservados continuam na lista, mas com o selo "Reservado".
    const visiveis = estado.catalogo.filter(function (p) {
      return estado.filtro === "Todas" || (p.categoria || "Outros") === estado.filtro;
    });

    if (!visiveis.length) {
      const vazio = document.createElement("p");
      vazio.className = "empty";
      vazio.textContent = "Não há presentes disponíveis nesta categoria.";
      grelha.appendChild(vazio);
      return;
    }

    const fragmento = document.createDocumentFragment();
    visiveis.forEach(function (p) { fragmento.appendChild(criarCartao(p)); });
    grelha.appendChild(fragmento);
  }

  /* ============================== MODAL ============================== */

  let presenteEmCurso = null;

  function abrirModal(presente) {
    presenteEmCurso = presente;
    porId("modalPresente").textContent = presente.nome + (presente.preco ? " · " + presente.preco : "");
    porId("formReserva").reset();
    porId("formErro").textContent = "";
    porId("modal").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { porId("campoNome").focus(); }, 60);
  }

  function fecharModal() {
    porId("modal").hidden = true;
    document.body.style.overflow = "";
    presenteEmCurso = null;
  }

  function abrirModalSugestao() {
    porId("formSugestao").reset();
    porId("sugestaoErro").textContent = "";
    porId("modalSugestao").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { porId("sugestaoPresente").focus(); }, 60);
  }

  function fecharModalSugestao() {
    porId("modalSugestao").hidden = true;
    document.body.style.overflow = "";
  }

  function abrirModalPresenca() {
    porId("formPresenca").reset();
    porId("presencaErro").textContent = "";
    porId("modalPresenca").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { porId("campoNomes").focus(); }, 60);
  }

  function fecharModalPresenca() {
    porId("modalPresenca").hidden = true;
    document.body.style.overflow = "";
  }

  function ligarModal() {
    porId("modal").addEventListener("click", function (evento) {
      if (evento.target.hasAttribute("data-fechar")) fecharModal();
    });

    porId("modalSugestao").addEventListener("click", function (evento) {
      if (evento.target.hasAttribute("data-fechar-sugestao")) fecharModalSugestao();
    });

    porId("btnAbrirSugestao").addEventListener("click", abrirModalSugestao);

    porId("modalPresenca").addEventListener("click", function (evento) {
      if (evento.target.hasAttribute("data-fechar-presenca")) fecharModalPresenca();
    });

    porId("btnAbrirPresenca").addEventListener("click", abrirModalPresenca);

    document.addEventListener("keydown", function (evento) {
      if (evento.key !== "Escape") return;
      if (!porId("modal").hidden) fecharModal();
      if (!porId("modalSugestao").hidden) fecharModalSugestao();
      if (!porId("modalPresenca").hidden) fecharModalPresenca();
    });

    porId("formReserva").addEventListener("submit", async function (evento) {
      evento.preventDefault();

      const nome = porId("campoNome").value.trim();
      const mensagem = porId("campoMensagem").value.trim();
      const erro = porId("formErro");
      const botao = porId("btnConfirmar");

      // O formulário só pode ser submetido com um presente escolhido.
      if (!presenteEmCurso) return;

      if (!nome) {
        erro.textContent = "Escreve o teu nome, por favor.";
        porId("campoNome").focus();
        return;
      }

      erro.textContent = "";
      botao.disabled = true;
      botao.textContent = "A reservar...";

      try {
        await guardarReserva(presenteEmCurso.id, nome, mensagem);
        const nomeGuardado = nome;
        fecharModal();
        desenharLista();
        mostrarToast("Obrigado, " + nomeGuardado + "! O presente está reservado.");
      } catch (falha) {
        erro.textContent = falha.message;
      } finally {
        botao.disabled = false;
        botao.textContent = "Confirmar reserva";
      }
    });
  }

  /* ============================ PRESENÇAS ============================ */

  function ligarPresenca() {
    const form = porId("formPresenca");
    if (!form) return;

    form.addEventListener("submit", async function (evento) {
      evento.preventDefault();

      const campo = porId("campoNomes");
      const nomes = campo.value.trim();
      const erro = porId("presencaErro");
      const botao = porId("btnPresenca");

      if (!nomes) {
        erro.textContent = "Escreve o teu nome, ou os nomes de quem vem contigo.";
        campo.focus();
        return;
      }

      erro.textContent = "";
      botao.disabled = true;
      botao.textContent = "A confirmar...";

      try {
        const total = await guardarPresenca(nomes);
        form.reset();
        fecharModalPresenca();
        mostrarToast("Obrigado! Já sabemos que vêm " + total + " " + (total === 1 ? "pessoa." : "pessoas."));
      } catch (falha) {
        erro.textContent = falha.message;
      } finally {
        botao.disabled = false;
        botao.textContent = "Confirmar presença";
      }
    });
  }

  function ligarSugestao() {
    const form = porId("formSugestao");
    if (!form) return;

    form.addEventListener("submit", async function (evento) {
      evento.preventDefault();

      const campo = porId("sugestaoPresente");
      const sugestao = campo.value.trim();
      const nome = porId("sugestaoNome").value.trim();
      const erro = porId("sugestaoErro");
      const botao = porId("btnSugestao");

      if (!sugestao) {
        erro.textContent = "Escreve a tua sugestão, por favor.";
        campo.focus();
        return;
      }

      erro.textContent = "";
      botao.disabled = true;
      botao.textContent = "A enviar...";

      try {
        await guardarSugestao(sugestao, nome);
        form.reset();
        fecharModalSugestao();
        mostrarToast("Obrigado pela sugestão!");
      } catch (falha) {
        erro.textContent = falha.message;
      } finally {
        botao.disabled = false;
        botao.textContent = "Enviar sugestão";
      }
    });
  }

  /* ============================== ARRANQUE ============================== */

  async function iniciar() {
    try {
      await carregarCatalogo();
    } catch (falha) {
      porId("grid").innerHTML = "";
      const aviso = document.createElement("p");
      aviso.className = "empty";
      aviso.textContent = "Não foi possível carregar a lista de presentes.";
      porId("grid").appendChild(aviso);
      console.error(falha);
      return;
    }

    preencherTextos();
    iniciarContagem();
    ligarModal();
    ligarPresenca();
    ligarSugestao();

    try {
      await carregarReservas();
    } catch (falha) {
      console.warn(falha.message);
      if (ONLINE) {
        const grelha = porId("grid");
        grelha.innerHTML = "";
        const aviso = document.createElement("p");
        aviso.className = "empty";
        aviso.textContent = "De momento não conseguimos ver as reservas. Volta a tentar daqui a pouco, ou fala connosco por WhatsApp.";
        grelha.appendChild(aviso);
        desenharFiltros();
        return;
      }
    }

    desenharFiltros();
    desenharLista();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
