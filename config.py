import os

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

SNOWTRACE_API_KEY = os.getenv("SNOWTRACE_API_KEY", "")
SNOWTRACE_BASE_URL = "https://api.snowtrace.io/api"

AVALANCHE_RPC_URL = os.getenv("AVALANCHE_RPC_URL", "https://api.avax.network/ext/bc/C/rpc")
AVALANCHE_CHAIN_ID = 43114
AUDIT_SETTLEMENT_ADDRESS = os.getenv("AUDIT_SETTLEMENT_ADDRESS", "")
AUDITOR_PRIVATE_KEY = os.getenv("AUDITOR_PRIVATE_KEY", "")

MAX_AUDIT_BUDGET_USD = float(os.getenv("MAX_AUDIT_BUDGET_USD", "0.10"))

AGENT_BUDGETS = {
    "scanner": {
        "max_output_tokens": 600,
        "max_input_tokens": None,
        "max_rounds": 1,
        "cost_per_1k_input": 0.00014,
        "cost_per_1k_output": 0.00028,
    },
    "economist": {
        "max_output_tokens": 800,
        "max_input_tokens": None,
        "max_rounds": 1,
        "cost_per_1k_input": 0.00014,
        "cost_per_1k_output": 0.00028,
    },
    "compliance": {
        "max_output_tokens": 700,
        "max_input_tokens": None,
        "max_rounds": 1,
        "cost_per_1k_input": 0.00014,
        "cost_per_1k_output": 0.00028,
    },
    "hacker": {
        "max_output_tokens": 1200,
        "max_input_tokens": None,
        "max_rounds": 2,
        "cost_per_1k_input": 0.00014,
        "cost_per_1k_output": 0.00028,
    },
    "manager": {
        "max_output_tokens": 1500,
        "max_input_tokens": None,
        "max_rounds": 2,
        "cost_per_1k_input": 0.00014,
        "cost_per_1k_output": 0.00028,
    },
}

SEVERITY_DEDUCTIONS = {
    "critico": 25,
    "alto": 15,
    "medio": 7,
    "bajo": 2,
    "informativo": 0,
}

RISK_LEVELS = {
    (1, 4): "bajo",
    (5, 9): "medio",
    (10, 15): "alto",
    (16, 25): "critico",
}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
DASHBOARD_DIR = os.path.join(os.path.dirname(__file__), "dashboard")
PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")
