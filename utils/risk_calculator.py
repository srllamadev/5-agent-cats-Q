def calculate_risk_level(probability: int, impact: int) -> dict:
    if probability is None or impact is None:
        return {
            "probability": probability,
            "impact": impact,
            "score": None,
            "level": "no_cuantificable",
        }

    score = probability * impact

    if score <= 4:
        level = "bajo"
    elif score <= 9:
        level = "medio"
    elif score <= 15:
        level = "alto"
    else:
        level = "critico"

    return {
        "probability": probability,
        "impact": impact,
        "score": score,
        "level": level,
    }


def calculate_security_score(findings: list) -> int:
    from config import SEVERITY_DEDUCTIONS

    score = 100
    for f in findings:
        severity = f.get("severidad", "informativo")
        deduction = SEVERITY_DEDUCTIONS.get(severity, 0)
        score -= deduction

    return max(0, min(100, score))
