# Governança da camada analítica

## Fronteira de decisão

O AgroRisk mantém duas camadas independentes:

1. **Regra determinística (`operational-risk-v1`)**: calcula o score auditável de 0 a 100, classifica BAIXO/MEDIO/ALTO, ordena a frota e aciona alertas. É a fonte de verdade operacional.
2. **Modelo preditivo**: estima a probabilidade de uma leitura atingir risco ALTO nas próximas cinco leituras. O resultado é consultivo e não pode alterar score, alarmes, cobertura, aceitação, preço ou conclusão de causalidade.

A narrativa em linguagem natural é gerada por templates versionados. Ela cita fatores, pontos, snapshot da telemetria, lacunas de dados e, quando disponível, a previsão de um modelo ativo.

## Treinamento e validação

O comando `npm run train:model` lê o histórico cronológico da tabela `telemetry`. O rótulo é derivado exclusivamente da ocorrência futura de `risk.level = ALTO`. O conjunto é dividido temporalmente em 80% para treino e 20% para validação, evitando usar leituras futuras no treinamento de exemplos anteriores.

O modelo inicial é uma regressão logística interpretável, treinada com descida de gradiente e regularização L2. A ativação automática exige no mínimo 20 exemplos de validação, recall de 0,50 e precisão de 0,30. Modelos abaixo desses critérios permanecem como `candidate` ou `rejected` e não aparecem nas explicações.

## Registro e rastreabilidade

Cada versão registra em `model_registry`:

- algoritmo, alvo e nomes das variáveis;
- hash SHA-256 do dataset;
- quantidade e janela temporal dos dados;
- métricas de validação e matriz de confusão;
- coeficientes e parâmetros de normalização;
- status `active`, `candidate`, `rejected` ou `archived`.

O treinamento registra um evento `model-validation` em `safety_logs`. Cada explicação registra um evento idempotente `ai-explanation` contendo versão da fórmula, versão do modelo, hash do dataset, horário da telemetria, campos utilizados, score, nível e completude.

## Limites regulatórios

Esta implementação é um controle técnico de rastreabilidade, não uma certificação de conformidade. A Resolução CNSP nº 416/2021 trata de controles internos, gestão de riscos e auditoria interna das entidades supervisionadas. A Política de Governança de Dados divulgada pela SUSEP enfatiza integridade, qualidade, segurança, transparência e conformidade. A validação jurídica e atuarial continua obrigatória antes do uso em decisões reais.

- https://www.gov.br/susep/pt-br/assuntos/informacoes-ao-mercado/solvencia-supervisao-prudencial/supervisao-consolidada-cgcon
- https://www.gov.br/susep/pt-br/central-de-conteudos/noticias/2025/abril/susep-estabelece-politica-de-governanca-de-dados
