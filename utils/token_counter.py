import tiktoken


_enc = None


def _get_encoder():
    global _enc
    if _enc is None:
        try:
            _enc = tiktoken.encoding_for_model("gpt-4")
        except Exception:
            _enc = tiktoken.get_encoding("cl100k_base")
    return _enc


def count_tokens(text: str) -> int:
    if not text:
        return 0
    enc = _get_encoder()
    return len(enc.encode(text))


def estimate_cost(tokens_in: int, tokens_out: int,
                  cost_per_1k_in: float = 0.00014,
                  cost_per_1k_out: float = 0.00028) -> float:
    cost_in = (tokens_in / 1000) * cost_per_1k_in
    cost_out = (tokens_out / 1000) * cost_per_1k_out
    return round(cost_in + cost_out, 6)
