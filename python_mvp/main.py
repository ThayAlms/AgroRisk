"""Ponto de entrada do AgroRisk Sprint 3."""

from __future__ import annotations

import argparse
from pathlib import Path

from agrorisk.entrada import ler_csv, ler_json, simular_dados
from agrorisk.pipeline import executar_pipeline


def criar_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MVP de analise de risco operacional Sompo AgroRisk")
    parser.add_argument("--entrada", choices=("simulada", "csv", "json"), default="simulada", help="Origem dos dados")
    parser.add_argument("--arquivo", help="Caminho do CSV/JSON quando aplicavel")
    parser.add_argument("--saida", default="output", help="Pasta dos relatorios")
    return parser


def carregar_entrada(tipo: str, arquivo: str | None):
    if tipo == "simulada":
        return simular_dados()
    if not arquivo:
        raise ValueError("Use --arquivo para informar o arquivo de entrada.")
    if tipo == "csv":
        return ler_csv(arquivo)
    return ler_json(arquivo)


def main() -> int:
    args = criar_parser().parse_args()
    try:
        dados = carregar_entrada(args.entrada, args.arquivo)
        executar_pipeline(dados, Path(args.saida))
        return 0
    except (ValueError, TypeError, FileNotFoundError) as erro:
        print(f"ERRO: {erro}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

