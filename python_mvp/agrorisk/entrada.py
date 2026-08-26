"""Entradas simuladas e adaptadores para CSV/JSON (futura API/sensores)."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


def simular_dados() -> pd.DataFrame:
    """Retorna leituras deterministicas que cobrem baixo, medio e alto risco."""
    leituras = [
        {
            "timestamp": "2026-08-26T09:00:00-03:00",
            "device_id": "COLHEITADEIRA-01",
            "distance_cm": 240,
            "temperature_c": 27,
            "humidity_pct": 55,
            "tilt_deg": 3,
            "speed_kmh": 6,
            "inside_geofence": True,
            "danger_zone": "safe",
            "buzzer": False,
            "source": "sensor_simulado",
        },
        {
            "timestamp": "2026-08-26T09:01:00-03:00",
            "device_id": "COLHEITADEIRA-01",
            "distance_cm": 110,
            "temperature_c": 36,
            "humidity_pct": 83,
            "tilt_deg": 11,
            "speed_kmh": 11,
            "inside_geofence": True,
            "danger_zone": "warning",
            "buzzer": False,
            "source": "sensor_simulado",
        },
        {
            "timestamp": "2026-08-26T09:02:00-03:00",
            "device_id": "COLHEITADEIRA-01",
            "distance_cm": 22,
            "temperature_c": 43,
            "humidity_pct": 94,
            "tilt_deg": 18,
            "speed_kmh": 17,
            "inside_geofence": False,
            "danger_zone": "critical",
            "buzzer": True,
            "source": "sensor_simulado",
        },
    ]
    return pd.DataFrame(leituras)


def ler_csv(caminho: str | Path) -> pd.DataFrame:
    """Le um lote de telemetria CSV, aceitando virgula ou ponto e virgula."""
    caminho = Path(caminho)
    if not caminho.exists():
        raise FileNotFoundError(f"Arquivo de entrada nao encontrado: {caminho}")
    return pd.read_csv(caminho, sep=None, engine="python")


def ler_json(caminho: str | Path) -> pd.DataFrame:
    """Le uma leitura ou uma lista de leituras de um arquivo JSON."""
    caminho = Path(caminho)
    if not caminho.exists():
        raise FileNotFoundError(f"Arquivo de entrada nao encontrado: {caminho}")
    with caminho.open(encoding="utf-8") as arquivo:
        dados = json.load(arquivo)
    if isinstance(dados, dict):
        dados = dados.get("telemetry", dados.get("leituras", [dados]))
    if not isinstance(dados, list):
        raise ValueError("JSON deve conter um objeto, uma lista ou a chave 'telemetry'.")
    return pd.DataFrame(dados)


def receber_payload_api(payload: dict | list[dict]) -> pd.DataFrame:
    """Adaptador em memoria que simula o corpo recebido por uma futura API."""
    registros = [payload] if isinstance(payload, dict) else payload
    if not isinstance(registros, list):
        raise ValueError("Payload da API deve ser objeto ou lista de objetos.")
    return pd.DataFrame(registros)

