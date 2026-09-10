# AgroRisk — Análise de Risco Operacional

Projeto acadêmico desenvolvido para a **Sompo Seguros**, com o objetivo de monitorar uma colheitadeira, receber dados de sensores e transformar a telemetria em informações de risco compreensíveis para o operador.

**Dashboard publicado:** [agrorisk-sompo.vercel.app](https://agrorisk-sompo.vercel.app)

## Integrantes

| Nome | RM |
|---|---:|
| Arthur Lins Ocanha | 570110 |
| Thainá Almeida Santos | 569110 |
| Vitor Barbosa Vitorino | 570475 |
| Silvio Dela Libera Neto | 572632 |

## Entrega — Python Sprint 3

O MVP Python está na pasta [`python_mvp/`](python_mvp/README.md). A solução organiza o fluxo completo em módulos e funções:

1. recebe telemetria simulada, CSV, JSON ou payload em memória;
2. valida campos obrigatórios, tipos e limites aceitáveis;
3. processa as leituras com `pandas`;
4. aplica regras de negócio e calcula um score de risco de 0 a 100;
5. classifica cada leitura como risco **BAIXO**, **MÉDIO** ou **ALTO**;
6. gera alertas, fatores explicativos, relatório CSV, resumo JSON e dashboard PNG;
7. separa registros inconsistentes para consulta e correção.

As regras consideram distância de obstáculos, inclinação, temperatura, umidade, velocidade, geofence, proximidade de zonas perigosas e acionamento do buzzer. O projeto inclui cenários de teste para os três níveis de risco e testes automatizados do pipeline completo.

## Como os dados chegam ao sistema

O ESP32 coleta informações do sensor ultrassônico, DHT11, MPU-6050 e GPS NEO-6M. Existem dois caminhos de transmissão:

```text
Sensores ──> ESP32 ──> Wi-Fi + HTTPS ─────────────> API na Vercel
                    └─> Cabo USB + porta serial ──> Gateway local ──> API
                                                                    |
                                                                    v
Dashboard <── PostgreSQL/Neon <── Regras de risco do backend <──────┘

CSV / JSON / simulação ──> Pipeline pandas ──> Score + alertas + relatórios
```

### Envio direto por Wi-Fi

O ESP32 conecta-se a uma rede Wi-Fi de 2,4 GHz e envia a telemetria em JSON diretamente para a API usando uma requisição `POST` por HTTPS. Cada dispositivo é identificado por `DEVICE_ID` e autenticado com `DEVICE_API_KEY`.

### Envio por cabo USB

Se o Wi-Fi estiver indisponível, a telemetria continua sendo escrita na porta serial USB a 115200 baud. O gateway Node.js detecta a porta COM, interpreta as leituras e publica os dados na mesma API em nuvem. Dessa maneira, o cabo funciona como contingência.

## Processamento e respostas

A API recebe e armazena as leituras no PostgreSQL/Neon. O sistema calcula inclinação e estabilidade, verifica obstáculos, geofence e zonas próximas, atualiza o dashboard e pode devolver um comando de alerta para o buzzer do ESP32.

O painel apresenta:

- distância e alerta de obstáculo;
- temperatura e umidade;
- inclinação, estabilidade e movimento;
- posição GPS e geofence;
- proximidade de rios, áreas de água, pedreiras e escarpas;
- status da conexão e histórico de telemetria;
- exportação de relatório CSV.

### Gestão Kanban da frota

A rota `/frota.html` é a entrada do gestor e organiza automaticamente os equipamentos nas colunas **Risco alto**, **Risco médio**, **Risco baixo** e **Sem sinal**. Dentro de cada coluna, os maiores scores aparecem primeiro. O gestor pode buscar por máquina, operador, fazenda ou motivo, filtrar a frota e cadastrar os dados operacionais de cada equipamento.

O botão **Ver detalhes** abre o dashboard de telemetria com o `deviceId` selecionado. As regras JavaScript geram `risk.score`, `risk.level`, fatores explicáveis e alertas usando os mesmos limites de classificação do MVP Python.

Quando o GPS físico ainda não possui posição válida, o navegador pode fornecer temporariamente a localização do computador. As zonas sugeridas pelo OpenStreetMap precisam ser confirmadas pelo operador antes de participarem dos alertas.

## Executar o MVP Python

Requer Python 3.10 ou superior. No terminal:

```powershell
cd python_mvp
python -m pip install -r requirements.txt
python main.py
```

Para processar o CSV de exemplo, que contém leituras válidas e uma leitura propositalmente inconsistente:

```powershell
python main.py --entrada csv --arquivo data/telemetria_exemplo.csv --saida output_csv
```

Para executar os testes:

```powershell
python -m unittest discover -s tests -v
```

## Executar o dashboard e o gateway

Requer Node.js 18 ou superior. A partir da raiz do projeto:

```powershell
npm install
npm start
```

O modo local fica disponível em `http://localhost:3000`. Para conectar o ESP32 por cabo ao sistema publicado:

```powershell
npm run gateway
```

Antes de iniciar o gateway, feche o Monitor Serial da Arduino IDE para liberar a porta COM. As credenciais devem ser copiadas de `.env.example` para um arquivo `.env` local, que não é enviado ao Git.

## Estrutura do repositório

```text
AgroRisk/
├── api/             APIs implantadas na Vercel
├── db/              estrutura do banco PostgreSQL
├── docs/            documentação de arquitetura e banco
├── firmware/        código do ESP32 e exemplos de configuração
├── gateway/         leitura da porta serial e envio à nuvem
├── lib/             persistência e regras compartilhadas do backend web
├── public/          dashboard e interfaces do operador
├── python_mvp/      backend acadêmico da Sprint 3
└── scripts/         testes de integração do sistema web
```

## Validação realizada

- teste de integração do sistema JavaScript aprovado;
- cinco testes automatizados do MVP Python aprovados;
- cenários simulados de risco baixo, médio e alto;
- validação de dados inválidos e campos obrigatórios;
- geração verificada de CSV, JSON e dashboard.

## Documentação complementar

- [Detalhes do MVP Python](python_mvp/README.md)
- [Arquitetura em nuvem](docs/ARQUITETURA_VERCEL.md)
- [Configuração do banco no DBeaver](docs/DBEAVER.md)
- [Firmware do ESP32](firmware/AgroRiskESP32/README.md)
- [Integração do buzzer](INTEGRACAO_BUZZER_ESP32.md)
