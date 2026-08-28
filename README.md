# Number Ops

Sistema web para gerenciamento operacional de números utilizados em operações de WhatsApp.

## Sobre o projeto

O Number Ops foi criado para centralizar o controle dos números utilizados pela operação.

A aplicação permite acompanhar informações como:

- Status do número;
- Localização;
- Responsável;
- Clientes relacionados;
- Grupos relacionados;
- Ocorrências;
- Histórico de alterações.

O objetivo é facilitar a administração dos números e permitir uma visão rápida da situação operacional de cada um.

## Objetivo

Criar uma ferramenta simples e centralizada para controlar os números utilizados pela empresa, reduzindo a necessidade de controles manuais e informações espalhadas.

## V1

A primeira versão será desenvolvida como uma aplicação web frontend-first.

Inicialmente:

- Não haverá backend;
- Não haverá banco de dados externo;
- Não haverá integração com SendFlow;
- Não haverá integração com UniChat;
- Os dados serão armazenados localmente no navegador.

A arquitetura será preparada para permitir a evolução futura para backend e integrações externas.

## Tecnologias

### V1

- HTML5
- CSS3
- JavaScript
- LocalStorage / IndexedDB

### Futuro

- Node.js
- Express
- MySQL
- API REST
- Autenticação
- Integrações externas

## Estrutura

```text
number-ops/
│
├── docs/
│
├── src/
│   ├── css/
│   ├── js/
│   └── data/
│
├── .gitignore
├── PROJECT.md
├── REQUIREMENTS.md
├── ROADMAP.md
└── README.md