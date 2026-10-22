# Montador de horários

Aplicação web para montar manualmente horários de cursos e turmas, atribuindo disciplinas, professores e salas. A grade verifica conflitos de uso e sinaliza situações que precisam de atenção.

> **Projeto piloto:** este é um projeto de experimentações com o uso de inteligência artificial. Foi desenvolvido **100% com IA** e tem caráter experimental; não deve ser considerado um sistema de produção sem validação e revisão adequadas.

## Funcionalidades

- Exibe a grade semanal das turmas e dos períodos de cada curso.
- Permite cadastrar e remover professores e salas.
- Permite inserir ou editar disciplinas, professores e salas em cada aula.
- Oferece aulas com duração de um, dois ou quatro períodos consecutivos.
- Detecta conflitos de professor e de sala em aulas que se sobrepõem.
- Sinaliza em amarelo o descanso insuficiente de um professor: se ele der aula até 22:30, uma aula no dia útil seguinte antes das 09:30 recebe um aviso.
- Permite ajustar os períodos e as quantidades de turmas.
- Salva as alterações automaticamente no armazenamento local do navegador (`localStorage`).
- Permite importar e exportar os dados em JSON. Uma importação válida substitui os dados atuais e os salvos no navegador.

## Como executar

A aplicação não tem etapa de compilação nem dependências externas. Como o carregamento inicial de `dados.json` usa `fetch`, abra o projeto por um servidor HTTP local, em vez de abrir `index.html` diretamente pelo sistema de arquivos.

Na pasta do projeto, execute:

```bash
python3 -m http.server 8000
```

Depois, acesse <http://localhost:8000>.

O arquivo `dados.json` fornece os dados iniciais quando ainda não há dados salvos para a aplicação nesse navegador. Depois do primeiro salvamento, os dados do `localStorage` têm prioridade sobre o arquivo. Para voltar a usar outro conjunto de dados, importe um arquivo JSON válido pela própria aplicação.

## Importação e exportação

A importação aceita o formato de backup exportado pela aplicação (`formato: "montador-horarios"`, com os dados dentro de `dados`) ou um objeto que contenha diretamente `professores`, `salas`, `cursos` e `aulas`.

Exportar JSON cria um arquivo de backup que pode ser importado posteriormente. O `localStorage` é específico do navegador e da origem usada para acessar a aplicação; ele não substitui um backup e não sincroniza dados entre dispositivos.

## Limitações do piloto

- A montagem e a validação do horário são manuais; o sistema não gera uma grade automaticamente.
- Os dados ficam no navegador e podem ser removidos se o armazenamento local for apagado.
- Os avisos ajudam a identificar conflitos e descanso insuficiente, mas as regras e os horários precisam ser conferidos pelos responsáveis.
- O aviso de descanso considera os dias úteis exibidos na grade (segunda a sexta).
