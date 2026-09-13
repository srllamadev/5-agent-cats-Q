import json
import httpx
from typing import Optional
from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, AGENT_BUDGETS
from utils.token_counter import count_tokens, estimate_cost
from utils.ledger import AuditLedger


class BaseAgent:
    def __init__(self, agent_name: str, audit_ledger: AuditLedger):
        self.agent_name = agent_name
        self.ledger = audit_ledger
        self.budget = AGENT_BUDGETS[agent_name]
        self.round_num = 0

    def _build_messages(self, system_prompt: str, user_content: str) -> list:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

    async def invoke(self, system_prompt: str, user_content: str,
                     max_budget_usd: float) -> dict:
        self.round_num += 1

        if self.round_num > self.budget["max_rounds"]:
            return {
                "agent": self.agent_name,
                "success": False,
                "error": f"Max rounds ({self.budget['max_rounds']}) exceeded.",
                "data": None,
            }

        if self.ledger.is_over_budget(max_budget_usd):
            return {
                "agent": self.agent_name,
                "success": False,
                "error": "Circuit breaker: budget exceeded.",
                "data": None,
            }

        tokens_in = count_tokens(system_prompt + user_content)
        max_output = self.budget["max_output_tokens"]

        messages = self._build_messages(system_prompt, user_content)

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{DEEPSEEK_BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": DEEPSEEK_MODEL,
                        "messages": messages,
                        "max_tokens": max_output,
                        "temperature": 0.2,
                    },
                )
                resp.raise_for_status()
                result = resp.json()

            content = result["choices"][0]["message"]["content"]
            tokens_out = count_tokens(content)
            cost = estimate_cost(
                tokens_in, tokens_out,
                self.budget["cost_per_1k_input"],
                self.budget["cost_per_1k_output"],
            )

            self.ledger.record(
                agent=self.agent_name,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=cost,
                round_num=self.round_num,
            )

            parsed = self._parse_response(content)

            return {
                "agent": self.agent_name,
                "success": True,
                "error": None,
                "data": parsed,
                "raw": content,
            }

        except Exception as e:
            tokens_out_est = 0
            cost = estimate_cost(
                tokens_in, tokens_out_est,
                self.budget["cost_per_1k_input"],
                self.budget["cost_per_1k_output"],
            )
            self.ledger.record(
                agent=self.agent_name,
                tokens_in=tokens_in,
                tokens_out=tokens_out_est,
                cost_usd=cost,
                round_num=self.round_num,
                error=str(e),
            )
            return {
                "agent": self.agent_name,
                "success": False,
                "error": str(e),
                "data": None,
            }

    def _parse_response(self, content: str) -> dict:
        content = content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {"raw_text": content}
