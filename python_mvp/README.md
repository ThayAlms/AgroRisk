# Sompo AgroRisk — MVP Python (Sprint 3)

Backend inicial para transformar telemetria de uma colheitadeira em score, classificação e alertas de risco operacional. O projeto usa funções, condicionais e `pandas`, com responsabilidades separadas entre entrada, validação, processamento e saída.

## Arquitetura

```text
CSV / JSON / sensor simulado / payload de API
                    |
                    v
             entrada.py
                    |
                    v
             validacao.py  ---> registros_rejeitados.csv
                    |
                    v
               risco.py
                    |
                    v
               saida.py    ---> CSV + JSON + dashboard PNG
```

## Como executar

No terminal, a partir desta pasta:

```powershell
python -m pip install -r requirements.txt
python main.py
```

O comando padrão usa três leituras simuladas (baixo, médio e alto risco). Para processar o exemplo CSV, incluindo uma linha propositalmente inválida:

```powershell
python main.py --entrada csv --arquivo data/telemetria_exemplo.csv --saida output_csv
```

Para JSON:

```powershell
python main.py --entrada json --arquivo caminho/telemetria.json
```

## Entradas e regras

Campos obrigatórios: `timestamp`, `device_id`, `distance_cm`, `temperature_c`, `humidity_pct`, `tilt_deg` e `speed_kmh`. Os campos opcionais `inside_geofence`, `danger_zone`, `buzzer` e `source` recebem padrões seguros quando não informados.

O score explicável soma pontos por obstáculo próximo, inclinação, temperatura, umidade, velocidade, saída da geofence, zona perigosa e buzzer. O valor final é limitado a 100:

- `0–29`: BAIXO
- `30–59`: MÉDIO
- `60–100`: ALTO

Os limiares estão documentados no código de `agrorisk/risco.py`. Este é um modelo acadêmico inicial e deve ser calibrado com especialistas e dados históricos antes de uso real em seguros ou segurança operacional.

## Saídas

- `analise_risco.csv`: cada leitura, score, classe, fatores e alertas;
- `resumo_risco.json`: indicadores consolidados e maior risco;
- `registros_rejeitados.csv`: dados inconsistentes e seus motivos;
- `dashboard_risco.png`: quantidade por classe e evolução do score.

## Testes

```powershell
python -m unittest discover -s tests -v
```

Os testes validam os limites das classes, os três cenários de risco, a rejeição de inconsistências, campos ausentes e o fluxo completo usando um payload que simula uma futura API.

