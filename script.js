const DIAS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
const CHAVE_LOCAL_STORAGE = "montador-horarios-dados";

// Estado inicial vazio (sem dados hardcodados)
let estado = {
  professores: [],
  salas: [],
  cursos: [],
  aulas: {},
  atribuicoes: []
};

let chaveAulaAtual = null;
let atribuicaoAtual = null;
let statusDados = "Carregando dados.json...";

function clonar(obj) { return JSON.parse(JSON.stringify(obj)); }

function extrairDados(conteudo) {
  const dados = conteudo?.formato === "montador-horarios" ? conteudo.dados : conteudo;
  const estruturaValida = dados
    && Array.isArray(dados.cursos)
    && Array.isArray(dados.professores)
    && Array.isArray(dados.salas)
    && dados.aulas && typeof dados.aulas === "object" && !Array.isArray(dados.aulas);

  if (!estruturaValida) {
    throw new Error("O arquivo não tem a estrutura esperada.");
  }
  const atribuicoes = dados.atribuicoes ?? [];
  if (!Array.isArray(atribuicoes) || atribuicoes.some(item =>
    !item
    || typeof item.cursoId !== "string"
    || !Number.isInteger(item.semestre)
    || item.semestre < 1
    || typeof item.sigla !== "string"
    || !Number.isInteger(item.aulasPorSemana)
    || item.aulasPorSemana < 1
    || !Array.isArray(item.professores)
    || item.professores.some(nome => typeof nome !== "string")
    || (item.salas !== undefined && (!Array.isArray(item.salas) || item.salas.some(nome => typeof nome !== "string")))
  )) {
    throw new Error("A lista de atribuições no arquivo não tem a estrutura esperada.");
  }
  const atribuicoesNormalizadas = atribuicoes.map((item, indice) => ({
    ...item,
    id: item.id || `atribuicao-legada-${indice}`,
    salas: item.salas || []
  }));
  const gruposAula = new Map();
  Object.entries(dados.aulas).forEach(([chave, aula]) => {
    if (!aula.grupoId) return;
    if (!gruposAula.has(aula.grupoId)) gruposAula.set(aula.grupoId, []);
    gruposAula.get(aula.grupoId).push([chave, aula]);
  });
  atribuicoesNormalizadas.forEach(atribuicao => {
    const jaAlocada = Object.values(dados.aulas).some(aula => aula.atribuicaoId === atribuicao.id);
    if (jaAlocada) return;
    const quantidade = Math.ceil(atribuicao.aulasPorSemana / 2);
    const grupo = [...gruposAula.values()].find(aulas => {
      if (aulas.length !== quantidade || aulas.some(([, aula]) => aula.atribuicaoId)) return false;
      const [chave, primeiraAula] = aulas[0];
      const [cursoId, turma] = chave.split("|");
      return cursoId === atribuicao.cursoId
        && Number(turma) + 1 === atribuicao.semestre
        && primeiraAula.disciplina === atribuicao.sigla
        && JSON.stringify(primeiraAula.professores || []) === JSON.stringify(atribuicao.professores);
    });
    grupo?.forEach(([, aula]) => { aula.atribuicaoId = atribuicao.id; });
  });
  return {
    ...dados,
    atribuicoes: atribuicoesNormalizadas
  };
}

function salvarEstado() {
  try {
    localStorage.setItem(CHAVE_LOCAL_STORAGE, JSON.stringify(estado));
  } catch (erro) {
    console.error("Não foi possível salvar os dados no armazenamento local:", erro);
    alert("As alterações foram aplicadas, mas não foi possível salvá-las neste navegador.");
  }
}

function escaparHtml(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function turmaNome(curso, indice) { return curso.id === "CORINGA" ? `Coringa ${indice + 1}` : `${curso.id} ${indice + 1}º`; }
function normalizarTexto(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
}
function chaveAula(cursoId, turmaIndice, diaIndice, horarioIndice) { return `${cursoId}|${turmaIndice}|${diaIndice}|${horarioIndice}`; }
function buscarCurso(id) { return estado.cursos.find(c => c.id === id); }
function formatarHorario(h) { return `${h.inicio}–${h.fim}`; }
function minutos(hora) { const [h,m] = hora.split(":").map(Number); return h*60+m; }
function intervalosSobrepoem(a,b) { return minutos(a.inicio) < minutos(b.fim) && minutos(b.inicio) < minutos(a.fim); }

function professoresEquivalentes(a, b) {
  const normalizar = nomes => (nomes || []).map(normalizarTexto).sort();
  return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}

function obterAtribuicoesAlocadas() {
  const alocadas = new Set();
  const atribuicoesPorId = new Map(estado.atribuicoes.map(item => [item.id, item]));
  const grupos = new Map();
  Object.entries(estado.aulas).forEach(([chave, aula]) => {
    if (aula.bloqueado) return;
    const grupoId = aula.grupoId || chave;
    const atual = grupos.get(grupoId);
    if (!atual || Number(aula.indiceSegmento || 0) < Number(atual.aula.indiceSegmento || 0)) {
      grupos.set(grupoId, {chave, aula});
    }
  });

  const gruposSemAtribuicao = [];
  grupos.forEach(({chave, aula}) => {
    const atribuicao = atribuicoesPorId.get(aula.atribuicaoId);
    if (atribuicao) alocadas.add(atribuicao.id);
    else gruposSemAtribuicao.push({chave, aula});
  });

  gruposSemAtribuicao.forEach(({chave, aula}) => {
    const [cursoId, turmaTexto] = chave.split("|");
    const candidatas = estado.atribuicoes.filter(item =>
      !alocadas.has(item.id)
      && item.cursoId === cursoId
      && item.semestre === Number(turmaTexto) + 1
      && normalizarTexto(item.sigla) === normalizarTexto(aula.disciplina)
    );
    const correspondente = candidatas.find(item =>
      professoresEquivalentes(item.professores, aula.professores)
    ) || candidatas[0];
    if (correspondente) alocadas.add(correspondente.id);
  });
  return alocadas;
}

function obterConflitos() {
  const conflitos = new Map();
  const registrarConflito = (chave, tipo, nomes) => {
    if (!conflitos.has(chave)) conflitos.set(chave, {professores:new Set(), salas:new Set()});
    for (const nome of nomes) conflitos.get(chave)[tipo].add(nome);
  };
  const entradas = [];
  for (const curso of estado.cursos) {
    for (let t = 0; t < curso.quantidade; t++) {
      for (let d = 0; d < DIAS.length; d++) {
        for (let h = 0; h < curso.horarios.length; h++) {
          const chave = chaveAula(curso.id,t,d,h);
          const aula = estado.aulas[chave];
          if (aula && (aula.disciplina || aula.professores?.length || aula.salas?.length)) {
            const horario = curso.horarios[h];
            entradas.push({chave, curso, t, d, h, aula, horario});
          }
        }
      }
    }
  }
  for (let i=0; i<entradas.length; i++) {
    for (let j=i+1; j<entradas.length; j++) {
      const a=entradas[i], b=entradas[j];
      if (a.chave === b.chave || (a.aula.grupoId && a.aula.grupoId === b.aula.grupoId)) continue;
      if (a.d !== b.d || !intervalosSobrepoem(a.horario,b.horario)) continue;
      const professoresA = a.aula.professores || [];
      const professoresB = b.aula.professores || [];
      const salasA = a.aula.salas || [];
      const salasB = b.aula.salas || [];
      const professoresEmConflito = professoresA.filter(p => professoresB.includes(p));
      const salasEmConflito = salasA.filter(s => salasB.includes(s));
      for (const tipo of ["professores", "salas"]) {
        const nomes = tipo === "professores" ? professoresEmConflito : salasEmConflito;
        if (nomes.length) {
          registrarConflito(a.chave, tipo, nomes);
          registrarConflito(b.chave, tipo, nomes);
        }
      }
    }
  }
  return conflitos;
}

function obterAvisosDescanso() {
  const avisos = new Map();
  const aulas = [];
  for (const curso of estado.cursos) {
    for (let turma = 0; turma < curso.quantidade; turma++) {
      for (let dia = 0; dia < DIAS.length; dia++) {
        for (let horario = 0; horario < curso.horarios.length; horario++) {
          const chave = chaveAula(curso.id, turma, dia, horario);
          const aula = estado.aulas[chave];
          if (aula?.professores?.length) {
            aulas.push({chave, dia, aula, horario:curso.horarios[horario]});
          }
        }
      }
    }
  }

  for (const aulaTardia of aulas) {
    if (minutos(aulaTardia.horario.fim) < minutos("22:30")) continue;
    for (const aulaSeguinte of aulas) {
      if (aulaSeguinte.dia !== aulaTardia.dia + 1 || minutos(aulaSeguinte.horario.inicio) >= minutos("09:30")) continue;
      const professoresEmComum = aulaTardia.aula.professores.filter(professor =>
        aulaSeguinte.aula.professores.includes(professor)
      );
      if (!professoresEmComum.length) continue;
      for (const chave of [aulaTardia.chave, aulaSeguinte.chave]) {
        if (!avisos.has(chave)) avisos.set(chave, new Set());
        professoresEmComum.forEach(professor => avisos.get(chave).add(professor));
      }
    }
  }
  return avisos;
}

function renderizarGrade() {
  const container = document.getElementById("gradeGeral");
  const conflitos = obterConflitos();
  const avisosDescanso = obterAvisosDescanso();
  const atribuicoesAlocadas = obterAtribuicoesAlocadas();
  container.innerHTML = "";
  
  if (!estado.cursos.length) {
    container.innerHTML = `<p class="nota">${escaparHtml(statusDados || "Nenhum curso carregado. Importe um arquivo JSON para começar.")}</p>`;
    return;
  }

  for (const curso of estado.cursos) {
    const secao = document.createElement("section");
    secao.className = `grade-curso ${curso.id.toLowerCase()}`;
    secao.innerHTML = `<h3>${escaparHtml(curso.nome)} <small>— ${curso.duracao} min por aula</small></h3>`;
    const turmas = document.createElement("div");
    turmas.className = "turmas-curso";
    for (let t=0; t<curso.quantidade; t++) {
      const bloco = document.createElement("div");
      bloco.className = "turma";
      const atribuicoes = estado.atribuicoes
        .map((item, indice) => ({item, indice}))
        .filter(({item}) => item.cursoId === curso.id && item.semestre === t + 1 && !atribuicoesAlocadas.has(item.id));
      let html = `<h4>${escaparHtml(turmaNome(curso, t))}</h4>`;
      html += `<div class="atribuicoes-turma" aria-label="Atribuições do semestre ${t + 1}">
        <h5>Atribuições do semestre <span>— arraste para o horário; arraste uma aula de volta para devolver</span></h5>`;
      if (atribuicoes.length) {
        html += `<div class="cartoes-atribuicao">${atribuicoes.map(({item}) => `<article class="cartao-atribuicao" draggable="true" tabindex="0" aria-label="Editar ${escaparHtml(item.sigla)}; também é possível arrastar para um horário" data-atribuicao="${escaparHtml(item.id)}" title="Clique para editar ou arraste para um horário">
            <strong>${escaparHtml(item.sigla)}</strong>
            <span>${escaparHtml(item.aulasPorSemana)} aulas por semana</span>
            <span>${escaparHtml((item.professores || []).join(", "))}</span>
            ${item.salas?.length ? `<span>${escaparHtml(item.salas.join(", "))}</span>` : ""}
            <button type="button" class="secundario editar-atribuicao" data-editar-atribuicao="${escaparHtml(item.id)}">Editar</button>
          </article>`).join("")}</div>`;
      } else {
        html += `<p class="zona-devolucao">Arraste uma disciplina da grade para cá para devolvê-la.</p>`;
      }
      html += "</div>";
      html += `<table><thead><tr><th>Horário</th>${DIAS.map(d => `<th>${escaparHtml(d)}</th>`).join("")}</tr></thead><tbody>`;
      for (let h=0; h<curso.horarios.length; h++) {
        html += `<tr><td class="horario">${escaparHtml(formatarHorario(curso.horarios[h]))}</td>`;
        for (let d=0; d<DIAS.length; d++) {
          const chave = chaveAula(curso.id,t,d,h);
          const aula = estado.aulas[chave] || {};
          const indisponivel = Boolean(aula.bloqueado);
          const conflito = conflitos.get(chave);
          const professoresSemDescanso = avisosDescanso.get(chave) || new Set();
          const detalhesConflito = conflito ? [
            ...[...conflito.professores].map(nome => `Professor em conflito: ${nome}`),
            ...[...conflito.salas].map(nome => `Sala em conflito: ${nome}`)
          ] : [];
          const detalhesDescanso = [...professoresSemDescanso].map(nome =>
            `${nome}: intervalo de descanso insuficiente entre aulas (aula até 22:30; próxima antes das 09:30)`
          );
          const professores = (aula.professores || []).join(", ");
          const salas = (aula.salas || []).join(", ");
          const continuacao = Boolean(aula.grupoId && aula.indiceSegmento > 0);
          html += `<td><div class="celula-container"><button class="celula-aula ${indisponivel?"indisponivel":""} ${!indisponivel && (aula.disciplina || professores || salas) ? "preenchida":""} ${conflito?"conflito":""} ${professoresSemDescanso.size?"descanso-insuficiente":""}" data-chave="${escaparHtml(chave)}" title="${escaparHtml([...detalhesConflito, ...detalhesDescanso, indisponivel ? "Horário indisponível" : "Clique para editar aula"].join(". "))}">
            ${indisponivel ? `<span class="disciplina">Indisponível</span>` : (continuacao ? `<span class="detalhe">↳ continuação</span>` : (aula.disciplina?`<span class="disciplina">${escaparHtml(aula.disciplina)}</span>`:`<span class="ajuda">+ Aula</span>`))}
            ${!continuacao && professores?`<span class="detalhe">${escaparHtml(professores)}</span>`:""}
            ${!continuacao && salas?`<span class="detalhe">${escaparHtml(salas)}</span>`:""}
            ${detalhesConflito.map(detalhe => `<span class="detalhe conflito-descricao">${escaparHtml(detalhe)}</span>`).join("")}
            ${detalhesDescanso.map(detalhe => `<span class="detalhe descanso-descricao">${escaparHtml(detalhe)}</span>`).join("")}
          </button><button type="button" class="alternar-indisponibilidade ${indisponivel?"marcado":""}" data-indisponibilidade="${escaparHtml(chave)}" aria-label="${indisponivel?"Liberar este horário":"Marcar este horário como indisponível"}" title="${indisponivel?"Liberar horário":"Marcar horário como indisponível"}">${indisponivel?"↻":"⊘"}</button></div></td>`;
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      bloco.innerHTML = html;
      turmas.appendChild(bloco);
    }
    secao.appendChild(turmas);
    container.appendChild(secao);
  }
  container.querySelectorAll(".cartao-atribuicao").forEach(cartao => {
    cartao.addEventListener("dragstart", evento => {
      evento.dataTransfer.setData("text/plain", JSON.stringify({
        tipo: "atribuicao",
        atribuicaoId: cartao.dataset.atribuicao
      }));
      evento.dataTransfer.effectAllowed = "copy";
      cartao.classList.add("arrastando");
    });
    cartao.addEventListener("dragend", () => cartao.classList.remove("arrastando"));
    cartao.addEventListener("click", evento => {
      if (evento.target.closest(".editar-atribuicao")) return;
      abrirModalAtribuicao(cartao.dataset.atribuicao);
    });
    cartao.addEventListener("keydown", evento => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        abrirModalAtribuicao(cartao.dataset.atribuicao);
      }
    });
  });
  container.querySelectorAll("[data-editar-atribuicao]").forEach(botao => {
    botao.addEventListener("click", evento => {
      evento.stopPropagation();
      abrirModalAtribuicao(botao.dataset.editarAtribuicao);
    });
  });
  container.querySelectorAll(".atribuicoes-turma").forEach(zona => {
    zona.addEventListener("dragover", evento => {
      evento.preventDefault();
      evento.dataTransfer.dropEffect = evento.dataTransfer.effectAllowed === "move" ? "move" : "copy";
      zona.classList.add("recebendo-aula");
    });
    zona.addEventListener("dragleave", () => zona.classList.remove("recebendo-aula"));
    zona.addEventListener("drop", evento => {
      const dados = obterDadosArraste(evento);
      if (dados?.tipo !== "aula") return;
      evento.preventDefault();
      zona.classList.remove("recebendo-aula");
      devolverAulaParaAtribuicao(dados.chave, dados.grupoId);
    });
  });
  container.querySelectorAll("[data-chave]").forEach(btn => {
    btn.addEventListener("click", () => abrirModal(btn.dataset.chave));
    btn.draggable = Boolean(estado.aulas[btn.dataset.chave] && !estado.aulas[btn.dataset.chave].bloqueado);
    btn.addEventListener("dragstart", evento => {
      const aula = estado.aulas[btn.dataset.chave];
      evento.dataTransfer.setData("text/plain", JSON.stringify({
        tipo: "aula",
        chave: btn.dataset.chave,
        grupoId: aula?.grupoId || ""
      }));
      evento.dataTransfer.effectAllowed = "move";
    });
    btn.addEventListener("dragover", evento => {
      evento.preventDefault();
      evento.dataTransfer.dropEffect = evento.dataTransfer.effectAllowed === "move" ? "move" : "copy";
      btn.classList.add("destino-arraste");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("destino-arraste"));
    btn.addEventListener("drop", evento => {
      evento.preventDefault();
      btn.classList.remove("destino-arraste");
      const dados = obterDadosArraste(evento);
      if (dados?.tipo === "atribuicao") {
        colocarAtribuicaoNoHorario(dados.atribuicaoId, btn.dataset.chave);
      } else if (dados?.tipo === "aula") {
        moverAulaNoHorario(dados, btn.dataset.chave);
      }
    });
  });
  container.querySelectorAll("[data-indisponibilidade]").forEach(btn => {
    btn.addEventListener("click", () => alternarIndisponibilidade(btn.dataset.indisponibilidade));
  });
  const resumo = document.getElementById("resumoConflitos");
  const aulasComAvisoDescanso = avisosDescanso.size;
  if (conflitos.size || aulasComAvisoDescanso) {
    const aulasComProfessor = [...conflitos.values()].filter(conflito => conflito.professores.size).length;
    const aulasComSala = [...conflitos.values()].filter(conflito => conflito.salas.size).length;
    const detalhes = [];
    if (aulasComProfessor) detalhes.push(`${aulasComProfessor} por conflito de professor`);
    if (aulasComSala) detalhes.push(`${aulasComSala} por conflito de sala`);
    if (aulasComAvisoDescanso) detalhes.push(`${aulasComAvisoDescanso} com descanso insuficiente para professor`);
    resumo.className = `resumo ${conflitos.size ? "tem-conflito" : "tem-aviso-descanso"}`;
    resumo.textContent = `Atenção: ${detalhes.join("; ")}.`;
  } else {
    resumo.className = "resumo";
    resumo.textContent = estado.cursos.length ? "Nenhum conflito de professor ou sala detectado." : "";
  }
}

function alternarIndisponibilidade(chave) {
  const aula = estado.aulas[chave];
  if (aula?.bloqueado) {
    delete estado.aulas[chave];
  } else if (aula && (aula.disciplina || aula.professores?.length || aula.salas?.length)) {
    alert("Remova a aula antes de marcar este horário como indisponível.");
    return;
  } else {
    estado.aulas[chave] = {bloqueado:true};
  }
  salvarEstado();
  renderizarGrade();
}

function dadosArraste(evento) {
  return evento.dataTransfer.getData("text/plain");
}

function obterDadosArraste(evento) {
  try {
    return JSON.parse(dadosArraste(evento));
  } catch (erro) {
    console.error("Não foi possível ler os dados da operação de arraste:", erro);
    return null;
  }
}

function obterAulasDoGrupo(chave, grupoId) {
  return Object.entries(estado.aulas).filter(([chaveAulaItem, aula]) =>
    grupoId ? aula.grupoId === grupoId : chaveAulaItem === chave
  );
}

function colocarAtribuicaoNoHorario(atribuicaoId, chave) {
  const atribuicao = estado.atribuicoes.find(item => item.id === atribuicaoId);
  if (!atribuicao) {
    alert("Não foi possível encontrar a atribuição arrastada. Tente novamente.");
    return;
  }
  if (Object.values(estado.aulas).some(aula => aula.atribuicaoId === atribuicao.id)) {
    alert("Essa atribuição já está em um horário.");
    return;
  }
  const [cursoId, turmaTexto, diaTexto, inicioTexto] = chave.split("|");
  const turma = Number(turmaTexto);
  const dia = Number(diaTexto);
  const inicio = Number(inicioTexto);
  const curso = buscarCurso(cursoId);
  if (!curso || atribuicao.cursoId !== cursoId || atribuicao.semestre !== turma + 1) {
    alert("A disciplina só pode ser colocada no horário da turma correspondente.");
    return;
  }

  const duracao = Math.ceil(atribuicao.aulasPorSemana / 2);
  if (inicio + duracao > curso.horarios.length) {
    alert(`Não há ${duracao} célula(s) consecutiva(s) disponível(is) a partir deste horário para ${curso.nome}.`);
    return;
  }
  const chavesDestino = Array.from({length: duracao}, (_, offset) =>
    chaveAula(cursoId, turma, dia, inicio + offset)
  );
  if (chavesDestino.some(chaveDestino => estado.aulas[chaveDestino])) {
    const temBloqueio = chavesDestino.some(chaveDestino => estado.aulas[chaveDestino]?.bloqueado);
    alert(temBloqueio
      ? "Um dos períodos necessários está marcado como indisponível."
      : "Um dos períodos necessários já contém uma aula. Escolha um horário livre.");
    return;
  }

  const grupoId = `aula-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  chavesDestino.forEach((chaveDestino, indiceSegmento) => {
    estado.aulas[chaveDestino] = {
      disciplina: atribuicao.sigla,
      professores: [...atribuicao.professores],
      salas: [...(atribuicao.salas || [])],
      grupoId,
      indiceSegmento,
      atribuicaoId: atribuicao.id
    };
  });
  salvarEstado();
  renderizarGrade();
}

function moverAulaNoHorario(dados, chaveDestino) {
  const aulasOrigem = obterAulasDoGrupo(dados.chave, dados.grupoId);
  if (!aulasOrigem.length) {
    alert("Não foi possível encontrar a aula arrastada. Tente novamente.");
    return;
  }
  const [cursoOrigem, turmaOrigem] = dados.chave.split("|");
  const [cursoDestino, turmaDestino, diaDestinoTexto, horarioDestinoTexto] = chaveDestino.split("|");
  if (cursoOrigem !== cursoDestino || turmaOrigem !== turmaDestino) {
    alert("A aula só pode ser movida para outro horário da mesma turma.");
    return;
  }
  const curso = buscarCurso(cursoDestino);
  const indiceOrigem = Number(estado.aulas[dados.chave]?.indiceSegmento || 0);
  const inicioDestino = Number(horarioDestinoTexto) - indiceOrigem;
  const diaDestino = Number(diaDestinoTexto);
  const aulasOrdenadas = [...aulasOrigem].sort((a, b) =>
    Number(a[1].indiceSegmento || 0) - Number(b[1].indiceSegmento || 0)
  );
  const quantidade = aulasOrdenadas.length;
  if (inicioDestino < 0 || inicioDestino + quantidade > curso.horarios.length) {
    alert(`A aula não cabe nesse horário: são necessárias ${quantidade} célula(s) consecutiva(s).`);
    return;
  }

  const chavesOrigem = new Set(aulasOrigem.map(([chave]) => chave));
  const [cursoId, turma] = chaveDestino.split("|");
  const chavesDestino = Array.from({length: quantidade}, (_, indice) =>
    chaveAula(cursoId, Number(turma), diaDestino, inicioDestino + indice)
  );
  if (chavesDestino.some(chave => estado.aulas[chave] && !chavesOrigem.has(chave))) {
    const temBloqueio = chavesDestino.some(chave =>
      estado.aulas[chave]?.bloqueado && !chavesOrigem.has(chave)
    );
    alert(temBloqueio
      ? "Um dos períodos necessários está marcado como indisponível."
      : "Um dos períodos necessários já contém outra aula. Escolha um horário livre.");
    return;
  }

  aulasOrigem.forEach(([chave]) => delete estado.aulas[chave]);
  const grupoId = dados.grupoId || `aula-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  chavesDestino.forEach((chave, indiceSegmento) => {
    estado.aulas[chave] = {
      ...aulasOrdenadas[indiceSegmento][1],
      grupoId,
      indiceSegmento
    };
  });
  salvarEstado();
  renderizarGrade();
}

function devolverAulaParaAtribuicao(chave, grupoId) {
  const aulas = obterAulasDoGrupo(chave, grupoId);
  if (!aulas.length) {
    alert("Não foi possível encontrar a aula arrastada. Tente novamente.");
    return;
  }
  if (!aulas.some(([, aula]) => aula.atribuicaoId)) {
    alert("Somente aulas importadas da atribuição podem ser devolvidas para a lista.");
    return;
  }
  aulas.forEach(([chaveAulaItem]) => delete estado.aulas[chaveAulaItem]);
  salvarEstado();
  renderizarGrade();
}

function renderizarCadastros() {
  renderizarLista("Professores", estado.professores, "listaProfessores");
  renderizarLista("Salas", estado.salas, "listaSalas");
}

function renderizarLista(tipo, itens, id) {
  const ul = document.getElementById(id);
  ul.innerHTML = "";
  if (!itens.length) { ul.innerHTML = '<li class="nota">Nenhum cadastro.</li>'; return; }
  itens.forEach((nome, indice) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escaparHtml(nome)}</span><button class="secundario perigo" type="button">Excluir</button>`;
    li.querySelector("button").addEventListener("click", () => {
      if (!confirm(`Excluir "${nome}" da lista de ${tipo.toLowerCase()}? As aulas existentes não serão alteradas.`)) return;
      itens.splice(indice,1); salvarEstado(); renderizarCadastros(); renderizarGrade();
    });
    ul.appendChild(li);
  });
}

function renderizarConfiguracao() {
  const container = document.getElementById("configCursos");
  container.innerHTML = "";
  if (!estado.cursos.length) {
    container.innerHTML = '<p class="nota">Nenhum curso disponível.</p>';
  }
  estado.cursos.forEach(curso => {
    const card = document.createElement("div");
    card.className = "config-curso";
    card.dataset.curso = curso.id;
    card.innerHTML = `<h3>${escaparHtml(curso.nome)}</h3><p class="duracao">Duração de aula: ${curso.duracao} minutos</p><div class="linhas-horario"></div><button type="button" class="secundario adicionar-horario">+ Adicionar período</button>`;
    const linhas = card.querySelector(".linhas-horario");
    curso.horarios.forEach((h, i) => adicionarLinhaHorario(linhas,h,i));
    card.querySelector(".adicionar-horario").addEventListener("click", () => adicionarLinhaHorario(linhas,{inicio:"",fim:""},linhas.children.length));
    container.appendChild(card);
  });
  
  const turmas = document.getElementById("configTurmas");
  turmas.innerHTML = "";
  estado.cursos.forEach(curso => {
    const label = document.createElement("label");
    label.innerHTML = `${escaparHtml(curso.nome)} <input type="number" min="1" max="10" value="${curso.quantidade}" data-qtd="${curso.id}"> turma(s)`;
    turmas.appendChild(label);
  });
}

function adicionarLinhaHorario(container,h,i) {
  const linha = document.createElement("div");
  linha.className = "linha-horario";
  linha.innerHTML = `<input type="time" aria-label="Início do período ${i+1}" value="${escaparHtml(h.inicio)}" class="inicio" required><input type="time" aria-label="Fim do período ${i+1}" value="${escaparHtml(h.fim)}" class="fim" required><button type="button" class="secundario perigo" title="Remover período">×</button>`;
  linha.querySelector("button").addEventListener("click", () => linha.remove());
  container.appendChild(linha);
}

function abrirModal(chave) {
  atribuicaoAtual = null;
  chaveAulaAtual = chave;
  const [cursoId,t,d,h] = chave.split("|");
  const curso = buscarCurso(cursoId);
  const aulaOriginal = estado.aulas[chave];
  let aula = aulaOriginal?.bloqueado
    ? {disciplina:"",professores:[],salas:[]}
    : aulaOriginal || {disciplina:"",professores:[],salas:[]};
  if (aula.grupoId) {
    const primeira = Object.values(estado.aulas).find(item => item.grupoId === aula.grupoId && item.indiceSegmento === 0);
    if (primeira) aula = primeira;
  }
  const duracao = aula.grupoId
    ? Object.values(estado.aulas).filter(item => item.grupoId === aula.grupoId).length
    : 1;
  document.getElementById("duracaoAula").value = ["1","2","4"].includes(String(duracao)) ? String(duracao) : "1";
  document.getElementById("tituloModal").textContent = `${curso.nome} — ${turmaNome(curso,Number(t))}`;
  document.getElementById("detalheModal").textContent = `${DIAS[Number(d)]}, ${formatarHorario(curso.horarios[Number(h)])}`;
  document.getElementById("disciplinaAula").value = aula.disciplina || "";
  document.getElementById("duracaoAulaCampo").classList.remove("escondido");
  document.getElementById("aulasPorSemanaCampo").classList.add("escondido");
  document.getElementById("bloquearHorarioCampo").classList.remove("escondido");
  document.getElementById("salasAulaCampo").classList.remove("escondido");
  document.getElementById("limparAulaBtn").classList.remove("escondido");
  document.querySelector('#formAula button[type="submit"]').textContent = "Salvar aula";
  preencherSelect("professoresAula",estado.professores,aula.professores || []);
  preencherSelect("salasAula",estado.salas,aula.salas || []);
  const bloqueio = document.getElementById("bloquearHorario");
  const aulaOcupada = Boolean(aulaOriginal && !aulaOriginal.bloqueado && (
    aulaOriginal.disciplina || aulaOriginal.professores?.length || aulaOriginal.salas?.length
  ));
  bloqueio.checked = Boolean(aulaOriginal?.bloqueado);
  bloqueio.disabled = aulaOcupada;
  const ajudaBloqueio = document.getElementById("ajudaBloqueio");
  ajudaBloqueio.textContent = aulaOcupada ? "Remova a aula antes de marcar este horário como indisponível." : "";
  ajudaBloqueio.classList.toggle("escondido", !aulaOcupada);
  document.getElementById("erroAula").textContent = "";
  document.getElementById("modalAula").showModal();
}

function abrirModalAtribuicao(id) {
  const atribuicao = estado.atribuicoes.find(item => item.id === id);
  if (!atribuicao) {
    alert("Não foi possível encontrar a disciplina. Atualize a página e tente novamente.");
    return;
  }
  atribuicaoAtual = id;
  chaveAulaAtual = null;
  const curso = buscarCurso(atribuicao.cursoId);
  document.getElementById("tituloModal").textContent = "Editar disciplina";
  document.getElementById("detalheModal").textContent =
    `${curso?.nome || atribuicao.cursoId} — ${atribuicao.semestre}º semestre`;
  document.getElementById("disciplinaAula").value = atribuicao.sigla;
  document.getElementById("aulasPorSemanaAula").value = atribuicao.aulasPorSemana;
  document.getElementById("duracaoAulaCampo").classList.add("escondido");
  document.getElementById("aulasPorSemanaCampo").classList.remove("escondido");
  document.getElementById("bloquearHorarioCampo").classList.add("escondido");
  document.getElementById("ajudaBloqueio").classList.add("escondido");
  document.getElementById("salasAulaCampo").classList.remove("escondido");
  document.getElementById("limparAulaBtn").classList.add("escondido");
  document.querySelector('#formAula button[type="submit"]').textContent = "Salvar disciplina";
  preencherSelect("professoresAula", estado.professores, atribuicao.professores || []);
  preencherSelect("salasAula", estado.salas, atribuicao.salas || []);
  document.getElementById("erroAula").textContent = "";
  document.getElementById("modalAula").showModal();
}

function preencherSelect(id, itens, selecionados) {
  const select = document.getElementById(id);
  select.innerHTML = "";
  itens.forEach(item => {
    const option = document.createElement("option");
    option.value = item; option.textContent = item; option.selected = selecionados.includes(item);
    select.appendChild(option);
  });
}

function valoresSelecionados(id) {
  return [...document.getElementById(id).selectedOptions].map(o=>o.value);
}

document.querySelectorAll(".aba").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".aba").forEach(b=>b.classList.toggle("ativa",b===btn));
  document.querySelectorAll("main .painel").forEach(p=>p.classList.add("escondido"));
  document.getElementById(`aba-${btn.dataset.aba}`).classList.remove("escondido");
}));

document.getElementById("formProfessor").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("nomeProfessor");
  const nome = input.value.trim();
  if (!nome) return;
  if (estado.professores.some(p=>p.toLocaleLowerCase("pt-BR")===nome.toLocaleLowerCase("pt-BR"))) { alert("Esse professor já está cadastrado."); return; }
  estado.professores.push(nome); estado.professores.sort((a,b)=>a.localeCompare(b,"pt-BR")); input.value="";
  salvarEstado();
  renderizarCadastros();
});

document.getElementById("formSala").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("nomeSala");
  const nome = input.value.trim();
  if (!nome) return;
  if (estado.salas.some(s=>s.toLocaleLowerCase("pt-BR")===nome.toLocaleLowerCase("pt-BR"))) { alert("Essa sala já está cadastrada."); return; }
  estado.salas.push(nome); estado.salas.sort((a,b)=>a.localeCompare(b,"pt-BR")); input.value="";
  salvarEstado();
  renderizarCadastros();
});

document.getElementById("formAula").addEventListener("submit", e => {
  e.preventDefault();
  if (atribuicaoAtual) {
    salvarEdicaoAtribuicao();
    return;
  }
  if (!chaveAulaAtual) return;
  const [cursoId, turmaTexto, diaTexto, horarioTexto] = chaveAulaAtual.split("|");
  const curso = buscarCurso(cursoId);
  const turma = Number(turmaTexto), dia = Number(diaTexto), inicio = Number(horarioTexto);
  const disciplina = document.getElementById("disciplinaAula").value.trim();
  const professores = valoresSelecionados("professoresAula");
  const salas = valoresSelecionados("salasAula");
  const duracao = Number(document.getElementById("duracaoAula").value);
  const bloquear = document.getElementById("bloquearHorario").checked;
  const chavesAntigas = new Set();
  const aulaAntiga = estado.aulas[chaveAulaAtual];
  if (aulaAntiga?.grupoId) {
    Object.entries(estado.aulas).forEach(([k,v]) => { if (v.grupoId === aulaAntiga.grupoId) chavesAntigas.add(k); });
  } else {
    chavesAntigas.add(chaveAulaAtual);
  }
  if (bloquear) {
    if (disciplina || professores.length || salas.length) {
      document.getElementById("erroAula").textContent = "Remova os dados da aula antes de marcar o horário como indisponível.";
      return;
    }
    chavesAntigas.forEach(k => delete estado.aulas[k]);
    estado.aulas[chaveAulaAtual] = {bloqueado:true};
  } else if (!disciplina && !professores.length && !salas.length) {
    chavesAntigas.forEach(k => delete estado.aulas[k]);
  } else {
    if (inicio + duracao > curso.horarios.length) {
      document.getElementById("erroAula").textContent = `Não há ${duracao} períodos consecutivos disponíveis a partir deste horário para ${curso.nome}.`;
      return;
    }
    for (let offset=0; offset<duracao; offset++) {
      const k = chaveAula(cursoId,turma,dia,inicio+offset);
      const existente = estado.aulas[k];
      if (existente && !chavesAntigas.has(k)) {
        document.getElementById("erroAula").textContent = existente.bloqueado
          ? "Um dos períodos necessários está marcado como indisponível."
          : "Um dos períodos seguintes já contém outra aula.";
        return;
      }
    }
    chavesAntigas.forEach(k => delete estado.aulas[k]);
    const grupoId = `aula-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    if (aulaAntiga?.atribuicaoId) {
      const atribuicao = estado.atribuicoes.find(item => item.id === aulaAntiga.atribuicaoId);
      if (atribuicao) {
        atribuicao.sigla = disciplina;
        atribuicao.professores = [...professores];
        atribuicao.salas = [...salas];
      }
    }
    for (let offset=0; offset<duracao; offset++) {
      estado.aulas[chaveAula(cursoId,turma,dia,inicio+offset)] = {
        disciplina, professores:[...professores], salas:[...salas], grupoId, indiceSegmento:offset,
        ...(aulaAntiga?.atribuicaoId ? {atribuicaoId:aulaAntiga.atribuicaoId} : {})
      };
    }
  }
  fecharModal();
  salvarEstado();
  renderizarGrade();
});

function salvarEdicaoAtribuicao() {
  const atribuicao = estado.atribuicoes.find(item => item.id === atribuicaoAtual);
  if (!atribuicao) {
    document.getElementById("erroAula").textContent = "Não foi possível encontrar a disciplina. Feche e tente novamente.";
    return;
  }
  const sigla = document.getElementById("disciplinaAula").value.trim();
  const aulasPorSemana = Number(document.getElementById("aulasPorSemanaAula").value);
  const professores = valoresSelecionados("professoresAula");
  const salas = valoresSelecionados("salasAula");
  if (!sigla) {
    document.getElementById("erroAula").textContent = "Informe o nome ou a sigla da disciplina.";
    return;
  }
  if (!Number.isInteger(aulasPorSemana) || aulasPorSemana < 1) {
    document.getElementById("erroAula").textContent = "A quantidade de aulas por semana deve ser um inteiro positivo.";
    return;
  }
  if (!professores.length) {
    document.getElementById("erroAula").textContent = "Selecione ao menos um professor.";
    return;
  }
  atribuicao.sigla = sigla;
  atribuicao.aulasPorSemana = aulasPorSemana;
  atribuicao.professores = [...professores];
  atribuicao.salas = [...salas];
  Object.values(estado.aulas)
    .filter(aula => aula.atribuicaoId === atribuicao.id)
    .forEach(aula => {
      aula.disciplina = sigla;
      aula.professores = [...professores];
      aula.salas = [...salas];
    });
  fecharModal();
  salvarEstado();
  renderizarGrade();
}

function fecharModal() {
  document.getElementById("modalAula").close();
  atribuicaoAtual = null;
  chaveAulaAtual = null;
}
document.getElementById("fecharModal").addEventListener("click",fecharModal);
document.getElementById("cancelarModalBtn").addEventListener("click",fecharModal);
document.getElementById("limparAulaBtn").addEventListener("click", () => {
  if (!chaveAulaAtual) return;
  const aula = estado.aulas[chaveAulaAtual];
  if (aula?.grupoId) {
    Object.entries(estado.aulas).forEach(([k,v]) => { if (v.grupoId === aula.grupoId) delete estado.aulas[k]; });
  } else {
    delete estado.aulas[chaveAulaAtual];
  }
  fecharModal();
  salvarEstado();
  renderizarGrade();
});

document.getElementById("limparHorariosBtn").addEventListener("click", () => {
  if (!Object.keys(estado.aulas).length) {
    alert("A grade já está vazia.");
    return;
  }
  if (!confirm("Limpar todos os horários? As disciplinas, os cadastros e as marcações de indisponibilidade serão removidos da grade.")) return;
  estado.aulas = {};
  salvarEstado();
  renderizarGrade();
});

document.getElementById("aplicarConfigBtn").addEventListener("click", () => {
  for (const curso of estado.cursos) {
    const card = document.querySelector(`[data-curso="${curso.id}"]`);
    if (!card) continue;
    const horarios = [...card.querySelectorAll(".linha-horario")].map(linha => ({
      inicio: linha.querySelector(".inicio").value,
      fim: linha.querySelector(".fim").value
    }));
    if (!horarios.length) { alert(`O curso ${curso.nome} precisa ter pelo menos um período.`); return; }
    for (const h of horarios) {
      if (!h.inicio || !h.fim || minutos(h.inicio)>=minutos(h.fim)) { alert(`Confira os horários do curso ${curso.nome}.`); return; }
    }
    curso.horarios = horarios;
    
    const inputQtd = document.querySelector(`[data-qtd="${curso.id}"]`);
    if (inputQtd) {
      curso.quantidade = Number(inputQtd.value);
    }
  }
  renderizarGrade(); 
  renderizarConfiguracao();
  salvarEstado();
  document.getElementById("mensagemConfig").textContent = "Configurações aplicadas e salvas neste navegador. Você também pode exportar um JSON como backup.";
});

document.getElementById("exportarBtn").addEventListener("click", () => {
  const backup = {
    formato: "montador-horarios",
    versao: 1,
    exportadoEm: new Date().toISOString(),
    dados: estado
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `horarios-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function contarSeparadoresCsv(linha, separador) {
  let emAspas = false;
  let quantidade = 0;
  for (let i = 0; i < linha.length; i++) {
    if (linha[i] === '"') {
      if (emAspas && linha[i + 1] === '"') i++;
      else emAspas = !emAspas;
    } else if (linha[i] === separador && !emAspas) {
      quantidade++;
    }
  }
  return quantidade;
}

function analisarCsv(texto) {
  const primeiraLinha = texto.replace(/^\uFEFF/, "").split(/\r?\n/).find(linha => linha.trim());
  if (!primeiraLinha) throw new Error("O arquivo está vazio.");
  const separador = [",", ";", "\t"].sort((a, b) =>
    contarSeparadoresCsv(primeiraLinha, b) - contarSeparadoresCsv(primeiraLinha, a)
  )[0];
  const linhas = [];
  let linha = [];
  let campo = "";
  let emAspas = false;
  const conteudo = texto.replace(/^\uFEFF/, "");

  for (let i = 0; i < conteudo.length; i++) {
    const caractere = conteudo[i];
    if (caractere === '"') {
      if (emAspas && conteudo[i + 1] === '"') {
        campo += '"';
        i++;
      } else {
        emAspas = !emAspas;
      }
    } else if (caractere === separador && !emAspas) {
      linha.push(campo.trim());
      campo = "";
    } else if ((caractere === "\n" || caractere === "\r") && !emAspas) {
      if (caractere === "\r" && conteudo[i + 1] === "\n") i++;
      linha.push(campo.trim());
      if (linha.some(valor => valor)) linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += caractere;
    }
  }
  if (emAspas) throw new Error("Há um campo com aspas sem fechamento.");
  linha.push(campo.trim());
  if (linha.some(valor => valor)) linhas.push(linha);
  return linhas;
}

function importarAtribuicoes(texto) {
  const linhas = analisarCsv(texto);
  const cabecalhos = linhas[0].map(normalizarTexto);
  const indices = {
    curso: cabecalhos.indexOf("curso"),
    semestre: cabecalhos.indexOf("semestre"),
    sigla: cabecalhos.indexOf("sigla"),
    aulasPorSemana: cabecalhos.indexOf("aulasporsemana"),
    docente: cabecalhos.indexOf("docente"),
    docente2: cabecalhos.indexOf("docente2")
  };
  const obrigatorios = ["curso", "semestre", "sigla", "aulasPorSemana", "docente"];
  const ausentes = obrigatorios.filter(campo => indices[campo] === -1);
  if (ausentes.length) {
    throw new Error(`Colunas obrigatórias ausentes: ${ausentes.map(campo => ({
      curso: "Curso",
      semestre: "Semestre",
      sigla: "Sigla",
      aulasPorSemana: "Aulas por semana",
      docente: "Docente"
    }[campo])).join(", ")}.`);
  }

  const novasAtribuicoes = linhas.slice(1).map((linha, indice) => {
    const linhaCsv = indice + 2;
    const cursoInformado = linha[indices.curso] || "";
    const curso = estado.cursos.find(item =>
      normalizarTexto(item.id) === normalizarTexto(cursoInformado)
      || normalizarTexto(item.nome) === normalizarTexto(cursoInformado)
    );
    const semestreTexto = linha[indices.semestre] || "";
    const semestre = Number(semestreTexto.match(/\d+/)?.[0]);
    const sigla = linha[indices.sigla] || "";
    const aulasPorSemanaTexto = linha[indices.aulasPorSemana] || "";
    const aulasPorSemana = Number(aulasPorSemanaTexto);
    const professores = [linha[indices.docente], indices.docente2 === -1 ? "" : linha[indices.docente2]]
      .map(nome => (nome || "").trim())
      .filter(Boolean);

    if (!cursoInformado || !curso) throw new Error(`Linha ${linhaCsv}: curso "${cursoInformado}" não encontrado.`);
    if (!Number.isInteger(semestre) || semestre < 1) throw new Error(`Linha ${linhaCsv}: semestre inválido.`);
    if (!sigla) throw new Error(`Linha ${linhaCsv}: sigla não informada.`);
    if (!/^\d+$/.test(aulasPorSemanaTexto) || !Number.isInteger(aulasPorSemana) || aulasPorSemana < 1) {
      throw new Error(`Linha ${linhaCsv}: "Aulas por semana" deve ser um número inteiro positivo.`);
    }
    if (!professores.length) throw new Error(`Linha ${linhaCsv}: informe ao menos um docente.`);

    return {
      id: `atribuicao-${Date.now()}-${indice}-${Math.random().toString(36).slice(2, 8)}`,
      cursoId: curso.id,
      semestre,
      sigla,
      aulasPorSemana,
      professores,
      salas: []
    };
  });
  if (!novasAtribuicoes.length) throw new Error("O arquivo não contém linhas de atribuição.");

  const nomesProfessores = new Map(estado.professores.map(nome => [normalizarTexto(nome), nome]));
  novasAtribuicoes.flatMap(item => item.professores).forEach(nome => {
    if (!nomesProfessores.has(normalizarTexto(nome))) nomesProfessores.set(normalizarTexto(nome), nome);
  });
  estado.professores = [...nomesProfessores.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  estado.atribuicoes = novasAtribuicoes;
}

document.getElementById("importarAtribuicao").addEventListener("change", async e => {
  const arquivo = e.target.files[0];
  if (!arquivo) return;

  try {
    importarAtribuicoes(await arquivo.text());
    salvarEstado();
    renderizarTudo();
    alert(`Atribuição importada com sucesso. Professores cadastrados e ${estado.atribuicoes.length} disciplina(s) adicionada(s).`);
  } catch (erro) {
    console.error("Não foi possível importar a atribuição:", erro);
    alert(`Não foi possível importar a atribuição: ${erro.message}`);
  } finally {
    e.target.value = "";
  }
});

document.getElementById("importarArquivo").addEventListener("change", async e => {
  const arquivo = e.target.files[0];
  if (!arquivo) return;

  try {
    const conteudo = JSON.parse(await arquivo.text());
    estado = extrairDados(conteudo);
    statusDados = "";
    salvarEstado();
    renderizarTudo();
    alert("Horário importado com sucesso!");
  } catch (erro) {
    console.error(erro);
    alert("Não foi possível importar o arquivo. Selecione um JSON válido.");
  } finally {
    e.target.value = "";
  }
});

function renderizarTudo() { 
  renderizarGrade(); 
  renderizarCadastros(); 
  renderizarConfiguracao(); 
}

async function carregarDadosIniciais() {
  try {
    const dadosSalvos = localStorage.getItem(CHAVE_LOCAL_STORAGE);
    if (dadosSalvos !== null) {
      estado = extrairDados(JSON.parse(dadosSalvos));
      statusDados = "";
      renderizarTudo();
      return;
    }
  } catch (erro) {
    console.error("Não foi possível ler os dados salvos neste navegador:", erro);
    statusDados = `Não foi possível ler os dados salvos neste navegador: ${erro.message}`;
    renderizarTudo();
    return;
  }

  try {
    const resposta = await fetch("./dados.json");
    if (!resposta.ok) {
      throw new Error(`Falha ao carregar dados.json (HTTP ${resposta.status}).`);
    }
    estado = extrairDados(await resposta.json());
    statusDados = "";
    salvarEstado();
  } catch (erro) {
    console.error("Não foi possível carregar dados.json:", erro);
    statusDados = `Não foi possível carregar dados.json: ${erro.message} Abra o sistema por um servidor local para carregar o arquivo.`;
  }
  renderizarTudo();
}

carregarDadosIniciais();