const DIAS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
const CHAVE_LOCAL_STORAGE = "montador-horarios-dados";

// Estado inicial vazio (sem dados hardcodados)
let estado = {
  professores: [],
  salas: [],
  cursos: [],
  aulas: {}
};

let chaveAulaAtual = null;
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
  return dados;
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
function chaveAula(cursoId, turmaIndice, diaIndice, horarioIndice) { return `${cursoId}|${turmaIndice}|${diaIndice}|${horarioIndice}`; }
function buscarCurso(id) { return estado.cursos.find(c => c.id === id); }
function formatarHorario(h) { return `${h.inicio}–${h.fim}`; }
function minutos(hora) { const [h,m] = hora.split(":").map(Number); return h*60+m; }
function intervalosSobrepoem(a,b) { return minutos(a.inicio) < minutos(b.fim) && minutos(b.inicio) < minutos(a.fim); }

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
      if (!avisos.has(aulaSeguinte.chave)) avisos.set(aulaSeguinte.chave, new Set());
      professoresEmComum.forEach(professor => avisos.get(aulaSeguinte.chave).add(professor));
    }
  }
  return avisos;
}

function renderizarGrade() {
  const container = document.getElementById("gradeGeral");
  const conflitos = obterConflitos();
  const avisosDescanso = obterAvisosDescanso();
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
        let html = `<h4>${escaparHtml(turmaNome(curso, t))}</h4><table><thead><tr><th>Horário</th>${DIAS.map(d => `<th>${escaparHtml(d)}</th>`).join("")}</tr></thead><tbody>`;
      for (let h=0; h<curso.horarios.length; h++) {
        html += `<tr><td class="horario">${escaparHtml(formatarHorario(curso.horarios[h]))}</td>`;
        for (let d=0; d<DIAS.length; d++) {
          const chave = chaveAula(curso.id,t,d,h);
          const aula = estado.aulas[chave] || {};
          const conflito = conflitos.get(chave);
          const professoresSemDescanso = avisosDescanso.get(chave) || new Set();
          const detalhesConflito = conflito ? [
            ...[...conflito.professores].map(nome => `Professor em conflito: ${nome}`),
            ...[...conflito.salas].map(nome => `Sala em conflito: ${nome}`)
          ] : [];
          const detalhesDescanso = [...professoresSemDescanso].map(nome =>
            `${nome}: descanso insuficiente após aula até 22:30; início permitido a partir das 09:30`
          );
          const professores = (aula.professores || []).join(", ");
          const salas = (aula.salas || []).join(", ");
          const continuacao = Boolean(aula.grupoId && aula.indiceSegmento > 0);
          html += `<td><button class="celula-aula ${aula.disciplina || professores || salas ? "preenchida":""} ${conflito?"conflito":""} ${professoresSemDescanso.size?"descanso-insuficiente":""}" data-chave="${escaparHtml(chave)}" title="${escaparHtml([...detalhesConflito, ...detalhesDescanso, "Clique para editar aula"].join(". "))}">
            ${continuacao ? `<span class="detalhe">↳ continuação</span>` : (aula.disciplina?`<span class="disciplina">${escaparHtml(aula.disciplina)}</span>`:`<span class="ajuda">+ Aula</span>`)}
            ${!continuacao && professores?`<span class="detalhe">${escaparHtml(professores)}</span>`:""}
            ${!continuacao && salas?`<span class="detalhe">${escaparHtml(salas)}</span>`:""}
            ${detalhesConflito.map(detalhe => `<span class="detalhe conflito-descricao">${escaparHtml(detalhe)}</span>`).join("")}
            ${detalhesDescanso.map(detalhe => `<span class="detalhe descanso-descricao">${escaparHtml(detalhe)}</span>`).join("")}
          </button></td>`;
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
  container.querySelectorAll("[data-chave]").forEach(btn => btn.addEventListener("click", () => abrirModal(btn.dataset.chave)));
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
  chaveAulaAtual = chave;
  const [cursoId,t,d,h] = chave.split("|");
  const curso = buscarCurso(cursoId);
  let aula = estado.aulas[chave] || {disciplina:"",professores:[],salas:[]};
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
  preencherSelect("professoresAula",estado.professores,aula.professores || []);
  preencherSelect("salasAula",estado.salas,aula.salas || []);
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
  if (!chaveAulaAtual) return;
  const [cursoId, turmaTexto, diaTexto, horarioTexto] = chaveAulaAtual.split("|");
  const curso = buscarCurso(cursoId);
  const turma = Number(turmaTexto), dia = Number(diaTexto), inicio = Number(horarioTexto);
  const disciplina = document.getElementById("disciplinaAula").value.trim();
  const professores = valoresSelecionados("professoresAula");
  const salas = valoresSelecionados("salasAula");
  const duracao = Number(document.getElementById("duracaoAula").value);
  const chavesAntigas = new Set();
  const aulaAntiga = estado.aulas[chaveAulaAtual];
  if (aulaAntiga?.grupoId) {
    Object.entries(estado.aulas).forEach(([k,v]) => { if (v.grupoId === aulaAntiga.grupoId) chavesAntigas.add(k); });
  } else {
    chavesAntigas.add(chaveAulaAtual);
  }
  if (!disciplina && !professores.length && !salas.length) {
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
        document.getElementById("erroAula").textContent = "Um dos períodos seguintes já contém outra aula.";
        return;
      }
    }
    chavesAntigas.forEach(k => delete estado.aulas[k]);
    const grupoId = `aula-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    for (let offset=0; offset<duracao; offset++) {
      estado.aulas[chaveAula(cursoId,turma,dia,inicio+offset)] = {
        disciplina, professores:[...professores], salas:[...salas], grupoId, indiceSegmento:offset
      };
    }
  }
  document.getElementById("modalAula").close(); 
  salvarEstado();
  renderizarGrade();
});

function fecharModal() { document.getElementById("modalAula").close(); }
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