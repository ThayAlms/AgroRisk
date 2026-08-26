"""Motor explicavel de score e regras de risco operacional."""

from __future__ import annotations

import pandas as pd


def _pontuar_linha(linha: pd.Series) -> tuple[int, list[str], list[str]]:
    score = 0
    fatores: list[str] = []
    alertas: list[str] = []

    distancia = linha["distance_cm"]
    if distancia <= 30:
        score += 30; fatores.append("obstaculo critico (+30)"); alertas.append("PARAR: obstaculo muito proximo")
    elif distancia <= 75:
        score += 20; fatores.append("obstaculo proximo (+20)"); alertas.append("Reduzir velocidade: obstaculo proximo")
    elif distancia <= 150:
        score += 10; fatores.append("obstaculo em atencao (+10)")

    inclinacao = linha["tilt_deg"]
    if inclinacao >= 15:
        score += 25; fatores.append("inclinacao critica (+25)"); alertas.append("Risco de tombamento: estabilizar equipamento")
    elif inclinacao >= 10:
        score += 15; fatores.append("inclinacao elevada (+15)")
    elif inclinacao >= 7:
        score += 5; fatores.append("inclinacao em atencao (+5)")

    temperatura = linha["temperature_c"]
    if temperatura >= 40 or temperatura <= 5:
        score += 15; fatores.append("temperatura extrema (+15)"); alertas.append("Verificar condicao termica")
    elif temperatura >= 35 or temperatura <= 10:
        score += 8; fatores.append("temperatura em atencao (+8)")

    umidade = linha["humidity_pct"]
    if umidade >= 90 or umidade <= 20:
        score += 10; fatores.append("umidade extrema (+10)")
    elif umidade >= 80 or umidade <= 30:
        score += 5; fatores.append("umidade em atencao (+5)")

    velocidade = linha["speed_kmh"]
    if velocidade >= 15:
        score += 10; fatores.append("velocidade alta (+10)"); alertas.append("Reduzir velocidade operacional")
    elif velocidade >= 10:
        score += 5; fatores.append("velocidade elevada (+5)")

    if not linha["inside_geofence"]:
        score += 10; fatores.append("fora da geofence (+10)"); alertas.append("Retornar a area operacional segura")
    if linha["danger_zone"] == "critical":
        score += 15; fatores.append("zona perigosa critica (+15)"); alertas.append("Afastar-se imediatamente da zona perigosa")
    elif linha["danger_zone"] == "warning":
        score += 8; fatores.append("proximidade de zona perigosa (+8)")
    if linha["buzzer"]:
        score += 10; fatores.append("buzzer acionado (+10)")

    if not fatores:
        fatores.append("nenhum fator de risco relevante")
        alertas.append("Operacao dentro dos parametros seguros")
    elif not alertas:
        alertas.append("ATENCAO: monitorar os fatores de risco identificados")
    return min(score, 100), fatores, alertas


def classificar_risco(score: int) -> str:
    """Classifica 0-29 como baixo, 30-59 como medio e 60-100 como alto."""
    if score < 30:
        return "BAIXO"
    if score < 60:
        return "MEDIO"
    return "ALTO"


def calcular_risco(dados_validos: pd.DataFrame) -> pd.DataFrame:
    """Aplica o motor em cada leitura e devolve informacao analitica."""
    resultado = dados_validos.copy()
    if resultado.empty:
        return resultado.assign(score_risco=pd.Series(dtype=int), classificacao=pd.Series(dtype=str))
    calculos = resultado.apply(_pontuar_linha, axis=1)
    resultado["score_risco"] = calculos.map(lambda item: item[0])
    resultado["classificacao"] = resultado["score_risco"].map(classificar_risco)
    resultado["fatores_risco"] = calculos.map(lambda item: " | ".join(item[1]))
    resultado["alertas"] = calculos.map(lambda item: " | ".join(item[2]))
    return resultado
