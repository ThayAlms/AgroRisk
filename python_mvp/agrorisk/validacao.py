"""Validacao e saneamento dos dados antes do motor de risco."""

from __future__ import annotations

import pandas as pd

from .config import CAMPOS_NUMERICOS, CAMPOS_OBRIGATORIOS, COLUNAS_OPCIONAIS, LIMITES_VALIDOS


def _normalizar_booleano(valor: object) -> object:
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)) and valor in (0, 1):
        return bool(valor)
    if isinstance(valor, str):
        texto = valor.strip().lower()
        if texto in {"true", "sim", "yes", "1"}:
            return True
        if texto in {"false", "nao", "não", "no", "0"}:
            return False
    return pd.NA


def validar_dados(dados: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Separa registros validos e rejeitados, registrando todos os motivos."""
    if not isinstance(dados, pd.DataFrame):
        raise TypeError("A entrada do pipeline deve ser um DataFrame pandas.")
    if dados.empty:
        raise ValueError("Nenhuma leitura foi recebida.")

    ausentes = [campo for campo in CAMPOS_OBRIGATORIOS if campo not in dados.columns]
    if ausentes:
        raise ValueError("Campos obrigatorios ausentes: " + ", ".join(ausentes))

    frame = dados.copy()
    for coluna, padrao in COLUNAS_OPCIONAIS.items():
        if coluna not in frame.columns:
            frame[coluna] = padrao

    for campo in CAMPOS_NUMERICOS:
        frame[campo] = pd.to_numeric(frame[campo], errors="coerce")
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="coerce", utc=True)
    frame["device_id"] = frame["device_id"].astype("string").str.strip()
    frame["inside_geofence"] = frame["inside_geofence"].map(_normalizar_booleano)
    frame["buzzer"] = frame["buzzer"].map(_normalizar_booleano)
    frame["danger_zone"] = frame["danger_zone"].astype("string").str.lower().str.strip()

    motivos: list[str] = []
    for _, linha in frame.iterrows():
        erros: list[str] = []
        if pd.isna(linha["timestamp"]):
            erros.append("timestamp invalido")
        if pd.isna(linha["device_id"]) or not str(linha["device_id"]).strip():
            erros.append("device_id obrigatorio")
        for campo, (minimo, maximo) in LIMITES_VALIDOS.items():
            valor = linha[campo]
            if pd.isna(valor):
                erros.append(f"{campo} nao numerico")
            elif not minimo <= valor <= maximo:
                erros.append(f"{campo} fora do intervalo [{minimo}, {maximo}]")
        if pd.isna(linha["inside_geofence"]):
            erros.append("inside_geofence invalido")
        if pd.isna(linha["buzzer"]):
            erros.append("buzzer invalido")
        if linha["danger_zone"] not in {"safe", "warning", "critical"}:
            erros.append("danger_zone deve ser safe, warning ou critical")
        motivos.append("; ".join(erros))

    frame["validation_errors"] = motivos
    invalidos = frame[frame["validation_errors"] != ""].copy()
    validos = frame[frame["validation_errors"] == ""].drop(columns="validation_errors").copy()
    if not validos.empty:
        validos["inside_geofence"] = validos["inside_geofence"].astype(bool)
        validos["buzzer"] = validos["buzzer"].astype(bool)
    return validos.reset_index(drop=True), invalidos.reset_index(drop=True)

