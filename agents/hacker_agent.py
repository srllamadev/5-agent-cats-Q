from agents.base_agent import BaseAgent
from utils.ledger import AuditLedger


HACKER_SYSTEM_PROMPT_ROUND1 = """Eres el Agente Hacker de un equipo de auditoría de smart contracts en Avalanche.
Tu tarea es intentar construir PoC (Proof of Concept) de explotabilidad para cada vulnerabilidad reportada por el Escáner.
Recibes SOLO los fragmentos de código marcados como vulnerables, NUNCA el contrato entero.

Tu micro-reporte JSON debe incluir:
1. Para cada vector de ataque: PoC tentativo (paso a paso de la explotación).
2. Probabilidad de éxito (1-5) basada en si el PoC es funcional o teórico.
3. Si no logras confirmar explotabilidad, marca status como "unconfirmed".

REGLAS ESTRICTAS:
- Tu salida DEBE ser JSON válido, sin texto adicional.
- No inventes líneas de código que no estén en los fragmentos.
- Tienes máximo 2 rondas. Esta es la RONDA 1.
- Sé conciso: máximo 1200 tokens de salida.

Formato JSON obligatorio:
{
  "exploits": [
    {
      "vector": "string",
      "target_lines": [int],
      "poc_steps": ["string"],
      "poc_confirmed": true|false,
      "probability": 1-5,
      "status": "confirmed|unconfirmed|theoretical",
      "refinement_needed": true|false,
      "refinement_request": "string|null"
    }
  ],
  "overall_exploitability": 1-5
}"""


HACKER_SYSTEM_PROMPT_ROUND2 = """Eres el Agente Hacker en RONDA 2 (refinamiento).
En la ronda anterior no pudiste confirmar algunos exploits. Recibes el fragmento de código relevante y tu propio análisis previo.
Intenta refinar el PoC o confirma que no es explotable.

REGLAS ESTRICTAS:
- Tu salida DEBE ser JSON válido, sin texto adicional.
- Esta es tu ÚLTIMA ronda. Si no confirmas, el hallazgo queda como "unconfirmed".
- Sé conciso: máximo 1200 tokens de salida.

Formato JSON obligatorio:
{
  "refined_exploits": [
    {
      "vector": "string",
      "poc_steps_refined": ["string"],
      "poc_confirmed": true|false,
      "probability": 1-5,
      "status": "confirmed|unconfirmed",
      "reason_if_unconfirmed": "string"
    }
  ]
}"""


class HackerAgent(BaseAgent):
    def __init__(self, ledger: AuditLedger):
        super().__init__("hacker", ledger)

    async def attempt_exploit(self, vulnerable_fragments: dict,
                              scanner_vectors: list, max_budget_usd: float) -> dict:
        fragments_text = ""
        for key, code in vulnerable_fragments.items():
            fragments_text += f"\n--- {key} ---\n{code}\n"

        vectors_text = "\nVectores a explotar:\n"
        for v in scanner_vectors:
            vectors_text += f"- {v.get('type', 'unknown')}: líneas {v.get('lines', [])} - {v.get('description', '')}\n"

        user_content = f"Intenta construir PoC para estos vectores usando los fragmentos:\n{fragments_text}\n{vectors_text}"
        return await self.invoke(HACKER_SYSTEM_PROMPT_ROUND1, user_content, max_budget_usd)

    async def refine_exploit(self, previous_result: dict, additional_fragments: str,
                             max_budget_usd: float) -> dict:
        prev_text = f"Tu análisis previo:\n{previous_result.get('raw', '')}\n"
        frag_text = f"Fragmentos adicionales:\n{additional_fragments}\n"

        unconfirmed = []
        if previous_result.get("data") and "exploits" in previous_result["data"]:
            for e in previous_result["data"]["exploits"]:
                if e.get("refinement_needed"):
                    unconfirmed.append(e.get("vector", "unknown"))

        user_content = f"{prev_text}\n{frag_text}\nVectores a refinar: {', '.join(unconfirmed)}"
        return await self.invoke(HACKER_SYSTEM_PROMPT_ROUND2, user_content, max_budget_usd)
