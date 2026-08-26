import tempfile
import unittest
from pathlib import Path

import pandas as pd

from agrorisk.entrada import receber_payload_api, simular_dados
from agrorisk.pipeline import executar_pipeline
from agrorisk.risco import calcular_risco, classificar_risco
from agrorisk.validacao import validar_dados


class TestAgroRiskMVP(unittest.TestCase):
    def test_classificacao_dos_limites(self):
        self.assertEqual(classificar_risco(29), "BAIXO")
        self.assertEqual(classificar_risco(30), "MEDIO")
        self.assertEqual(classificar_risco(59), "MEDIO")
        self.assertEqual(classificar_risco(60), "ALTO")

    def test_simulacao_cobre_tres_niveis(self):
        validos, rejeitados = validar_dados(simular_dados())
        resultado = calcular_risco(validos)
        self.assertTrue(rejeitados.empty)
        self.assertEqual(set(resultado["classificacao"]), {"BAIXO", "MEDIO", "ALTO"})

    def test_validacao_rejeita_inconsistencia(self):
        dados = simular_dados()
        dados.loc[0, "humidity_pct"] = 150
        validos, rejeitados = validar_dados(dados)
        self.assertEqual(len(validos), 2)
        self.assertIn("humidity_pct fora do intervalo", rejeitados.iloc[0]["validation_errors"])

    def test_payload_api_e_pipeline_ponta_a_ponta(self):
        dados = receber_payload_api(simular_dados().to_dict(orient="records"))
        with tempfile.TemporaryDirectory() as pasta:
            resultado, rejeitados, arquivos = executar_pipeline(dados, pasta, exibir=False)
            self.assertEqual(len(resultado), 3)
            self.assertTrue(rejeitados.empty)
            self.assertTrue(all(Path(caminho).exists() for caminho in arquivos.values()))

    def test_campos_ausentes_geram_erro_claro(self):
        with self.assertRaisesRegex(ValueError, "Campos obrigatorios ausentes"):
            validar_dados(pd.DataFrame([{"device_id": "X"}]))


if __name__ == "__main__":
    unittest.main()

