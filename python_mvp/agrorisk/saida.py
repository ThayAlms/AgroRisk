"""Relatorios, resumo textual e dashboard estatico."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


def exibir_resumo(resultados: pd.DataFrame, rejeitados: pd.DataFrame) -> None:
    print("\n=== SOMPO AGRO RISK | RESUMO DO PROCESSAMENTO ===")
    print(f"Leituras processadas: {len(resultados)} | Rejeitadas: {len(rejeitados)}")
    if resultados.empty:
        print("Nenhuma leitura valida para analise.")
        return
    colunas = ["timestamp", "device_id", "score_risco", "classificacao", "alertas"]
    exibicao = resultados[colunas].copy()
    exibicao["timestamp"] = exibicao["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    print(exibicao.to_string(index=False))


def salvar_relatorios(resultados: pd.DataFrame, rejeitados: pd.DataFrame, pasta: str | Path) -> dict[str, Path]:
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    csv_path = pasta / "analise_risco.csv"
    json_path = pasta / "resumo_risco.json"
    rejeitados_path = pasta / "registros_rejeitados.csv"
    dashboard_path = pasta / "dashboard_risco.png"

    resultados.to_csv(csv_path, index=False, sep=";", decimal=",")
    rejeitados.to_csv(rejeitados_path, index=False, sep=";", decimal=",")
    resumo = {
        "total_recebido": int(len(resultados) + len(rejeitados)),
        "total_processado": int(len(resultados)),
        "total_rejeitado": int(len(rejeitados)),
        "score_medio": round(float(resultados["score_risco"].mean()), 2) if not resultados.empty else None,
        "por_classificacao": resultados["classificacao"].value_counts().to_dict() if not resultados.empty else {},
        "maior_risco": resultados.loc[resultados["score_risco"].idxmax(), ["device_id", "score_risco", "classificacao", "fatores_risco"]].to_dict() if not resultados.empty else None,
    }
    with json_path.open("w", encoding="utf-8") as arquivo:
        json.dump(resumo, arquivo, ensure_ascii=False, indent=2, default=str)
    gerar_dashboard(resultados, dashboard_path)
    return {"csv": csv_path, "json": json_path, "rejeitados": rejeitados_path, "dashboard": dashboard_path}


def gerar_dashboard(resultados: pd.DataFrame, caminho: str | Path) -> None:
    """Gera uma visualizacao simples sem exigir servidor web."""
    fig, eixos = plt.subplots(1, 2, figsize=(12, 4.8))
    cores = {"BAIXO": "#2e9d62", "MEDIO": "#f0a128", "ALTO": "#d64545"}
    if resultados.empty:
        for eixo in eixos:
            eixo.text(0.5, 0.5, "Sem dados validos", ha="center", va="center")
            eixo.axis("off")
    else:
        contagem = resultados["classificacao"].value_counts().reindex(["BAIXO", "MEDIO", "ALTO"], fill_value=0)
        eixos[0].bar(contagem.index, contagem.values, color=[cores[x] for x in contagem.index])
        eixos[0].set_title("Leituras por classificacao")
        eixos[0].set_ylabel("Quantidade")
        ordem = resultados.sort_values("timestamp")
        eixos[1].plot(range(1, len(ordem) + 1), ordem["score_risco"], marker="o", color="#005ca9")
        eixos[1].axhspan(0, 30, color=cores["BAIXO"], alpha=0.12)
        eixos[1].axhspan(30, 60, color=cores["MEDIO"], alpha=0.12)
        eixos[1].axhspan(60, 100, color=cores["ALTO"], alpha=0.12)
        eixos[1].set_ylim(0, 100)
        eixos[1].set_xticks(range(1, len(ordem) + 1))
        eixos[1].set_xlabel("Leitura")
        eixos[1].set_ylabel("Score (0-100)")
        eixos[1].set_title("Evolucao do score operacional")
    fig.suptitle("Sompo Seguros - AgroRisk MVP", fontsize=14, fontweight="bold")
    fig.tight_layout()
    fig.savefig(caminho, dpi=150, bbox_inches="tight")
    plt.close(fig)

