import httpx
from config import SNOWTRACE_API_KEY, SNOWTRACE_BASE_URL


async def fetch_verified_source(address: str) -> dict:
    params = {
        "module": "contract",
        "action": "getsourcecode",
        "address": address,
        "apikey": SNOWTRACE_API_KEY,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(SNOWTRACE_BASE_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    if data.get("status") != "1" or not data.get("result"):
        return {
            "success": False,
            "error": f"Source not available for {address}. Contract may not be verified.",
            "source": None,
            "contract_name": None,
        }

    result = data["result"][0]
    source_code = result.get("SourceCode", "")
    contract_name = result.get("ContractName", "Unknown")

    if not source_code:
        return {
            "success": False,
            "error": f"Empty source code for {address}.",
            "source": None,
            "contract_name": contract_name,
        }

    return {
        "success": True,
        "error": None,
        "source": source_code,
        "contract_name": contract_name,
        "compiler_version": result.get("CompilerVersion", ""),
        "optimization_used": result.get("OptimizationUsed", ""),
    }


async def fetch_multiple_sources(addresses: list) -> dict:
    results = {}
    for addr in addresses:
        results[addr] = await fetch_verified_source(addr)
    return results
