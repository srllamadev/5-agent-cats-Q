from agents.base_agent import BaseAgent
from utils.ledger import AuditLedger


ECONOMIST_SYSTEM_PROMPT = """Eres el Agente Economista de un equipo de auditoría de smart contracts en Avalanche.
Tu tarea es analizar el riesgo ECONÓMICO/FINANCIERO del contrato. Recibes SOLO fragmentos relevantes (funciones payable, transfer, swap, state variables de balances).

Tu micro-reporte JSON debe incluir:
1. Valor en riesgo (TVL potencial, fondos en juego).
2. Funciones que mueven valor y su dirección (entrada/salida).
3. Impacto económico de cada vector de ataque identificado por el Escáner.
4. Estimación de pérdida máxima por cada vulnerabilidad.
5. Análisis de incentivos (game theory, front-running, oracle manipulation).

REGLAS ESTRICTAS:
- Tu salida DEBE ser JSON válido, sin texto adicional.
- No inventes valores. Si no puedes estimar, usa null.
- Sé conciso: máximo 800 tokens de salida.
- NO leas el contrato completo, solo los fragmentos que te pasan.

Formato JSON obligatorio:
{
  "value_at_risk": {"estimated_tvl_usd": "number|null", "max_single_loss_usd": "number|null"},
  "value_flows": [{"function": "string", "direction": "in|out|both", "asset": "string", "line": int}],
  "economic_impact": [{"vector": "string", "impact_level": 1-5, "max_loss_usd": "number|null", "description": "string"}],
  "incentive_analysis": [{"type": "front_running|oracle_manipulation|griefing|other", "description": "string", "severity": 1-5}],
  "financial_risk_score": 1-5
}"""


class EconomistAgent(BaseAgent):
    def __init__(self, ledger: AuditLedger):
        super().__init__("economist", ledger)

    async def analyze(self, contract_fragments: dict, scanner_vectors: list,
                      max_budget_usd: float) -> dict:
        fragments_text = ""
        if "payable_functions_code" in contract_fragments:
            fragments_text += "\nFunciones payable:\n" + contract_fragments["payable_functions_code"]
        if "transfer_functions_code" in contract_fragments:
            fragments_text += "\nFunciones de transferencia:\n" + contract_fragments["transfer_functions_code"]
        if "balance_variables_code" in contract_fragments:
            fragments_text += "\nVariables de balance:\n" + contract_fragments["balance_variables_code"]

        vectors_text = "\nVectores iniciales del Escáner:\n"
        for v in scanner_vectors:
            vectors_text += f"- {v.get('type', 'unknown')}: {v.get('description', '')}\n"

        user_content = f"Analiza el riesgo económico de estos fragmentos del contrato:\n{fragments_text}\n{vectors_text}"
        return await self.invoke(ECONOMIST_SYSTEM_PROMPT, user_content, max_budget_usd)
