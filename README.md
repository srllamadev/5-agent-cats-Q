# Equipo de Auditoría Multi-Agente para Smart Contracts (Avalanche)

Sistema de auditoría de smart contracts compuesto por 5 agentes de IA especializados, con presupuesto de tokens controlado, circuit breaker, y liquidación on-chain en Avalanche.

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│                  ORCHESTRATOR                    │
│         (Manager - síntesis + score)            │
├──────────┬──────────┬──────────┬────────────────┤
│ Scanner  │Economist │Compliance│    Hacker      │
│ (Agente1)│ (Agente2)│ (Agente3)│   (Agente4)   │
│ AST+     │ Riesgo   │ ISO/NIST │  PoC Exploits  │
│ líneas   │ financiero│compliance│  2 rondas max  │
└──────────┴──────────┴──────────┴────────────────┘
         │                │
    audit_ledger    Dashboard (HTML/CSS/JS)
    (cost tracking)  + AuditSettlement.sol
```

## Agentes

| Agente | Max Output | Rondas | Función |
|--------|-----------|--------|---------|
| Scanner | 600 tokens | 1 | AST, líneas sospechosas, vectores iniciales |
| Economist | 800 tokens | 1 | Riesgo económico, valor en juego |
| Compliance | 700 tokens | 1 | ISO 27001, NIST CSF, ISO 27002 |
| Hacker | 1200 tokens | 2 | PoC de explotabilidad |
| Manager | 1500 tokens | 2 | Síntesis, score, conflictos |

## Marcos Normativos

- **ISO/IEC 27001** — Anexo A: controles de acceso, segregación
- **ISO/IEC 27002** — Guía de implementación
- **ISO/IEC 27004** — Métricas (securityScore 0-100)
- **ISO/IEC 27005** — Gestión de riesgo
- **ISO 31000** — Matriz Probabilidad x Impacto
- **NIST CSF** — Identify / Protect / Detect / Respond / Recover

## Instalación

```bash
pip install -r requirements.txt
cp .env.example .env
# Editar .env con tus API keys
```

## Uso

### 1. Archivo único .sol
```bash
python main.py --file contrato.sol
```

### 2. Múltiples archivos .sol
```bash
python main.py --directory ./contratos/
```

### 3. Address en Avalanche (fetch desde Snowtrace)
```bash
python main.py --address 0x1234...abcd
```

## Salida

- `output/{audit_id}_report.json` — Informe ejecutivo completo
- `output/{audit_id}_dashboard.json` — Payload para el dashboard
- `output/{audit_id}_ledger.json` — Ledger de costos por agente
- `dashboard/index.html` — Dashboard visual (abrir en navegador)

## Dashboard

Abrir `dashboard/index.html?audit_id=XXXX` para ver resultados visuales.

## Contrato de Liquidación

`contracts/AuditSettlement.sol` — Contrato en Avalanche para liquidar pagos de auditoría.

## Presupuesto

- Budget máximo por auditoría: $0.10 USD (configurable en `.env`)
- Circuit breaker automático si se excede el budget
- Reportes parciales si algún agente no completa
