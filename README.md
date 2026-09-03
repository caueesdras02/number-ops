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

## Versão atual

A aplicação é um frontend estático com autenticação e persistência compartilhada no Supabase. O localStorage permanece somente para compatibilidade, recuperação e migração controlada.

## Tecnologias

- HTML5
- CSS3
- JavaScript ES Modules
- Supabase Auth
- Supabase PostgreSQL com Row Level Security
- GitHub Pages

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
