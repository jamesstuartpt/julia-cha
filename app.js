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
    reservas: {},   // { idDoPresente: nºDeUnidadesReservadas } — nunca por quem
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

    // Presentes já reservados antes de existir base de dados (ficam
    // com todas as unidades tomadas).
    estado.catalogo.forEach((p) => {
      if (p.reservado) {
        estado.reservas[p.id] = p.quantidade > 1 ? p.quantidade : 1;
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
        const locais = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "{}");
        Object.keys(locais).forEach(function (id) {
          const r = locais[id];
          estado.reservas[id] = (r && r.quantidade) ? r.quantidade : 1;
        });
      } catch (e) {
        console.warn("Reservas locais ilegíveis, a começar do zero.");
      }
      return;
    }

    // Lê, por presente, quantas unidades já estão reservadas através de
    // uma função RPC. A função é "security definer", por isso contorna o
    // RLS e devolve apenas presente_id + quantidade (nunca quem reservou).
    const resposta = await fetch(CFG.url + "/rest/v1/rpc/get_reservas_publicas", {
      method: "POST",
      headers: cabecalhos(),
      cache: "no-store"
    });
    if (!resposta.ok) throw new Error("Não foi possível carregar as reservas.");

    const linhas = await resposta.json();
    linhas.forEach(function (linha) {
      estado.reservas[linha.presente_id] = Number(linha.quantidade) || 1;
    });
  }

  // Quantas unidades ainda faltam reservar de um presente.
  function totalDoPresente(presente) {
    return presente.quantidade > 1 ? presente.quantidade : 1;
  }

  function reservadoDe(presente) {
    const total = totalDoPresente(presente);
    return Math.min(estado.reservas[presente.id] || 0, total);
  }

  async function guardarReserva(presenteId, nome, mensagem, quantidade, total) {
    // Cada reserva fica numa linha própria, com a quantidade de unidades
    // escolhida e todos os nomes do grupo juntos (ex: "Ana, João e Maria").
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      throw new Error("Escreve o teu nome, por favor.");
    }

    const qtd = Math.max(1, Math.floor(Number(quantidade) || 1));
    const totalUnid = Math.max(1, Math.floor(Number(total) || 1));
    const jaReservado = estado.reservas[presenteId] || 0;
    const restam = totalUnid - jaReservado;

    if (qtd > restam) {
      throw new Error("Só restam " + restam + (restam === 1 ? " unidade." : " unidades."));
    }

    if (!ONLINE) {
      const locais = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "{}");
      locais[presenteId] = { nome: nomeLimpo, mensagem: mensagem, quantidade: jaReservado + qtd };
      localStorage.setItem(CHAVE_LOCAL, JSON.stringify(locais));
      estado.reservas[presenteId] = jaReservado + qtd;
      return jaReservado + qtd;
    }

    // Reserva atómica: a função RPC no Supabase bloqueia o presente e
    // soma as unidades já reservadas antes de aceitar, evitando que duas
    // pessoas fiquem com as mesmas unidades. Devolve o total de unidades
    // reservadas após a inserção, ou -1 se já não houver unidades.
    const resposta = await fetch(CFG.url + "/rest/v1/rpc/reservar_presente", {
      method: "POST",
      headers: cabecalhos(),
      body: JSON.stringify({
        p_presente_id: presenteId,
        p_nome: nomeLimpo,
        p_mensagem: mensagem || null,
        p_quantidade: qtd,
        p_total: totalUnid
      })
    });
    if (!resposta.ok) throw new Error("Não foi possível guardar a reserva. Tenta novamente.");

    const reservadoAgora = await resposta.json();
    if (!reservadoAgora || reservadoAgora < 0) {
      desenharLista();
      throw new Error("Alguém acabou de reservar as últimas unidades. Escolhe outro da lista.");
    }

    estado.reservas[presenteId] = reservadoAgora;
    return reservadoAgora;
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

  async function guardarPresenca(texto, restricao) {
    const nomes = separarNomes(texto);
    if (!nomes.length) {
      throw new Error("Escreve pelo menos um nome, por favor.");
    }

    if (!ONLINE) {
      const locais = JSON.parse(localStorage.getItem(CHAVE_PRESENCAS) || "[]");
      nomes.forEach(function (n) {
        locais.push({ nome: n, restricao: restricao || null, criado_em: new Date().toISOString() });
      });
      localStorage.setItem(CHAVE_PRESENCAS, JSON.stringify(locais));
      return nomes.length;
    }

    // Insere uma linha por pessoa, num único pedido. A restrição
    // alimentar é a mesma para todas as pessoas do grupo.
    const corpo = nomes.map(function (n) {
      return { nome: n, restricao: restricao || null };
    });
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

  // O campo dataCha pode incluir o dia da semana ("2026-12-12 - Sábado"),
  // por isso extraímos só a parte YYYY-MM-DD antes de a converter.
  function soData(texto) {
    const m = String(texto || "").match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
  }

  function formatarData(iso) {
    const data = soData(iso);
    if (!data) return "";
    const d = new Date(data + "T00:00:00");
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
    const alvo = soData(estado.config.dataCha) || soData(estado.config.dataParto);
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
    const total = totalDoPresente(presente);
    const reservado = reservadoDe(presente);
    const restam = total - reservado;
    // Só fica "esgotado" quando todas as unidades já foram reservadas.
    const esgotado = restam <= 0;

    const cartao = document.createElement("article");
    cartao.className = "card" + (esgotado ? " card--taken" : "");

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

    // Presentes com várias unidades mostram o progresso (ex: "1/10"),
    // para se ver que ainda há unidades livres para reservar.
    if (total > 1) {
      const barra = document.createElement("div");
      barra.className = "card__progress";
      const cheio = document.createElement("span");
      cheio.className = "card__progress-fill";
      cheio.style.width = Math.round((reservado / total) * 100) + "%";
      barra.appendChild(cheio);
      corpo.appendChild(barra);

      const qtd = document.createElement("p");
      qtd.className = "card__qty";
      qtd.textContent = reservado + "/" + total + " unidades" +
        (restam > 0 ? " · restam " + restam : " · esgotado");
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

    if (esgotado) {
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
    porId("blocoNomesReserva").hidden = true;

    // Se o presente tiver várias unidades, mostra o campo de quantidade
    // com o máximo de unidades ainda disponíveis.
    const total = totalDoPresente(presente);
    const restam = total - reservadoDe(presente);
    const bloco = porId("blocoQtd");
    if (total > 1) {
      bloco.hidden = false;
      const campoQtd = porId("campoQtd");
      campoQtd.max = String(Math.max(restam, 1));
      campoQtd.value = "1";
      porId("qtdAjuda").textContent = "Restam " + restam + " de " + total + " unidades disponíveis.";
    } else {
      bloco.hidden = true;
    }

    // Botão de WhatsApp com o nome do presente, para resolver enganos.
    const numero = String(estado.config.whatsapp || "").replace(/\D/g, "");
    const botaoWpp = porId("btnWhatsappReserva");
    if (numero) {
      const mensagem = "Olá! Reservei por engano o seguinte presente no site do baby shower: " +
        presente.nome + ". Podem, por favor, cancelar? Obrigado.";
      botaoWpp.href = "https://wa.me/" + numero + "?text=" + encodeURIComponent(mensagem);
      botaoWpp.hidden = false;
    } else {
      botaoWpp.hidden = true;
    }

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
    porId("campoRestricao").hidden = true;
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

    // Mostra o campo de nomes só quando a pessoa indica que vem ao baby shower.
    porId("formReserva").querySelectorAll('input[name="vem"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        porId("blocoNomesReserva").hidden = (radio.value !== "sim");
        if (radio.value === "sim") porId("campoNomesReserva").focus();
      });
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

      // Quantidade de unidades a reservar (1 unidade nos presentes únicos).
      const total = totalDoPresente(presenteEmCurso);
      const restam = total - reservadoDe(presenteEmCurso);
      const qtd = porId("blocoQtd").hidden ? 1 : Math.floor(Number(porId("campoQtd").value));

      if (!(qtd >= 1)) {
        erro.textContent = "Escolhe quantas unidades queres oferecer.";
        porId("campoQtd").focus();
        return;
      }
      if (qtd > restam) {
        erro.textContent = "Só restam " + restam + (restam === 1 ? " unidade." : " unidades.");
        porId("campoQtd").focus();
        return;
      }

      // Vem ao baby shower? Se sim, os nomes de quem vem são obrigatórios.
      // Quem escolhe "Já confirmei" já registou a presença antes, por isso
      // não lhe voltamos a pedir os nomes nem a registar de novo.
      const escolha = porId("formReserva").querySelector('input[name="vem"]:checked').value;
      const vem = escolha === "sim";
      const jaConfirmou = escolha === "ja";
      const nomes = vem ? porId("campoNomesReserva").value.trim() : "";
      if (vem && !nomes) {
        erro.textContent = "Escreve o teu nome, ou os nomes de quem vem contigo.";
        porId("campoNomesReserva").focus();
        return;
      }

      erro.textContent = "";
      botao.disabled = true;
      botao.textContent = "A reservar...";

      try {
        await guardarReserva(presenteEmCurso.id, nome, mensagem, qtd, total);
        const nomeGuardado = nome;

        // A presença é registada a seguir à reserva; se falhar, não
        // invalidamos a reserva (a pessoa pode confirmar pelo botão próprio).
        let confirmados = 0;
        let falhaPresenca = false;
        if (vem) {
          try {
            confirmados = await guardarPresenca(nomes, "");
          } catch (e) {
            falhaPresenca = true;
            console.warn(e);
          }
        }

        let textoToast = "Obrigado, " + nomeGuardado + "! O presente está reservado.";
        if (total > 1) {
          textoToast += " Reservaste " + qtd + (qtd === 1 ? " unidade." : " unidades.");
        }
        if (vem) {
          textoToast += falhaPresenca
            ? " (Confirma a tua presença no botão próprio, por favor.)"
            : " Já sabemos que vêm " + confirmados + (confirmados === 1 ? " pessoa." : " pessoas.");
        } else if (jaConfirmou) {
          textoToast += " Já tínhamos a tua confirmação de presença.";
        }

        fecharModal();
        desenharLista();
        mostrarToast(textoToast);
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

    // Mostra o campo de restrição alimentar só quando a pessoa escolhe "Sim".
    form.querySelectorAll('input[name="restricao"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        porId("campoRestricao").hidden = (radio.value !== "sim");
        if (radio.value === "sim") {
          porId("campoRestricao").focus();
        }
      });
    });

    form.addEventListener("submit", async function (evento) {
      evento.preventDefault();

      const campo = porId("campoNomes");
      const nomes = campo.value.trim();
      const erro = porId("presencaErro");
      const botao = porId("btnPresenca");

      // Restrição alimentar: só envia se a pessoa tiver escolhido "Sim"
      // e preenchido o campo.
      const temRestricao = form.querySelector('input[name="restricao"]:checked').value === "sim";
      const restricaoTexto = temRestricao ? porId("campoRestricao").value.trim() : "";

      if (!nomes) {
        erro.textContent = "Escreve o teu nome, ou os nomes de quem vem contigo.";
        campo.focus();
        return;
      }

      erro.textContent = "";
      botao.disabled = true;
      botao.textContent = "A confirmar...";

      try {
        const total = await guardarPresenca(nomes, restricaoTexto);
        form.reset();
        porId("campoRestricao").hidden = true;
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
