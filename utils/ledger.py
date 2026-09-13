import json
import os
from config import OUTPUT_DIR


class AuditLedger:
    def __init__(self, audit_id: str):
        self.audit_id = audit_id
        self.entries = []
        self.total_cost_usd = 0.0
        self.circuit_broken = False
        self._filepath = os.path.join(OUTPUT_DIR, f"{audit_id}_ledger.json")

    def record(self, agent: str, tokens_in: int, tokens_out: int,
               cost_usd: float, round_num: int = 1, error: str = None):
        entry = {
            "agent": agent,
            "round": round_num,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": round(cost_usd, 6),
            "error": error,
        }
        self.entries.append(entry)
        self.total_cost_usd += cost_usd

    def is_over_budget(self, max_budget_usd: float) -> bool:
        if self.total_cost_usd >= max_budget_usd:
            self.circuit_broken = True
            return True
        return False

    def get_summary(self) -> dict:
        detail = {}
        for entry in self.entries:
            agent = entry["agent"]
            if agent not in detail:
                detail[agent] = {"tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "rounds": 0}
            detail[agent]["tokens_in"] += entry["tokens_in"]
            detail[agent]["tokens_out"] += entry["tokens_out"]
            detail[agent]["cost_usd"] += entry["cost_usd"]
            detail[agent]["rounds"] = max(detail[agent]["rounds"], entry["round"])

        for agent in detail:
            detail[agent]["cost_usd"] = round(detail[agent]["cost_usd"], 6)

        return {
            "total_usd": round(self.total_cost_usd, 6),
            "circuit_broken": self.circuit_broken,
            "detalle_por_agente": detail,
        }

    def save(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(self._filepath, "w", encoding="utf-8") as f:
            json.dump({
                "audit_id": self.audit_id,
                "entries": self.entries,
                "summary": self.get_summary(),
            }, f, indent=2, ensure_ascii=False)
