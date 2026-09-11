# Modelo de IA real e gratuito

## Fronteira entre regra e IA

A primeira camada continua sendo o score determinístico `operational-risk-v1`. Ela usa limites explícitos, produz BAIXO/MÉDIO/ALTO e pode ser auditada leitura por leitura. Nenhum modelo de IA altera esse score, confirma sinistro, define cobertura ou autoriza indenização.

A segunda camada possui dois modelos independentes:

1. **Detector de anomalias por equipamento.** Aprende medianas e dispersões robustas (MAD) do histórico real de cada máquina. Sinaliza mudança de comportamento e indica quais variáveis mais se afastaram da rotina. Pode funcionar sem rótulos, mas sua saída é apenas consultiva.
2. **Preditor supervisionado de evento confirmado.** Regressão logística que usa telemetria e clima para estimar um evento humano confirmado nos 30 minutos seguintes. Só pode ser ativado depois que produtores registrarem ocorrências e a SOMPO as verificar.

## Proteções contra um modelo fictício

- Todo payload com `demo: true` é excluído do treinamento.
- Ocorrências ligadas a uma máquina demonstrativa recebem `source: demo` e nunca viram rótulos de treino.
- Apenas `source: human` com `verification_status: verified` entra no modelo supervisionado.
- O treinamento supervisionado exige pelo menos 30 positivos, 30 negativos e 5 máquinas.
- A validação separa máquinas inteiras do treino, reduzindo o risco de memorizar um único equipamento.
- Ativação exige precisão mínima de 0,50, recall de 0,60 e Brier score de no máximo 0,25.
- Versão, algoritmo, período, hash e quantidade da base, métricas e decisão de ativação são registrados em `model_registry` e `safety_logs`.

## Clima sem custo

O enriquecimento usa a API diária do NASA POWER, gratuita e sem chave. Se ela estiver indisponível, o protótipo acadêmico usa a Open-Meteo Historical API, também sem chave para uso não comercial. São armazenados temperatura, umidade, precipitação e vento por equipamento e dia em `weather_context`, junto da origem exata. O dado climático contextualiza a leitura; não substitui o sensor local. Antes de uso comercial pela seguradora, os termos do provedor de fallback devem ser revistos; a gratuidade não deve ser presumida para produção comercial.

## Fluxo operacional

```text
telemetria real -> detector de anomalias -> sinal consultivo
       |                                      |
       +-> produtor relata ocorrência --------+
                              |
                         SOMPO verifica
                              |
                   base supervisionada elegível
                              |
                  treino + validação por máquina
                              |
                    ativa somente se aprovada
```

## Comandos

Com `DATABASE_URL` configurada em `.env.local`:

```powershell
npm run enrich:weather
npm run train:anomaly
npm run train:event
```

`train:event` termina sem ativar o modelo enquanto a base não cumprir os mínimos. Isso é comportamento esperado, não uma falha do sistema.
