"""Orquestracao das etapas de entrada, processamento e saida."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .risco import calcular_risco
from .saida import exibir_resumo, salvar_relatorios
from .validacao import validar_dados


def executar_pipeline(dados: pd.DataFrame, pasta_saida: str | Path = "output", exibir: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Executa o MVP completo e retorna resultados, rejeitados e artefatos."""
    validos, rejeitados = validar_dados(dados)
    resultados = calcular_risco(validos)
    caminhos = salvar_relatorios(resultados, rejeitados, pasta_saida)
    if exibir:
        exibir_resumo(resultados, rejeitados)
        print("\nArquivos gerados:")
        for nome, caminho in caminhos.items():
            print(f"- {nome}: {caminho.resolve()}")
    return resultados, rejeitados, caminhos

