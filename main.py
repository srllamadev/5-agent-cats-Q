import asyncio
import sys
import os
import json
import argparse

from orchestrator import Orchestrator
from utils.snowtrace_fetcher import fetch_verified_source


def read_single_contract(filepath: str) -> tuple:
    with open(filepath, "r", encoding="utf-8") as f:
        source = f.read()
    name = os.path.splitext(os.path.basename(filepath))[0]
    return source, name


def read_multiple_contracts(directory: str) -> tuple:
    sources = []
    for root, _, files in os.walk(directory):
        for fname in sorted(files):
            if fname.endswith(".sol"):
                fpath = os.path.join(root, fname)
                with open(fpath, "r", encoding="utf-8") as f:
                    sources.append(f"// === {fname} ===\n{f.read()}")

    combined = "\n\n".join(sources)
    name = os.path.basename(directory)
    return combined, name


async def audit_from_address(address: str) -> dict:
    print(f"Obteniendo source code verificado de {address} en Snowtrace...")
    result = await fetch_verified_source(address)

    if not result["success"]:
        print(f"Error: {result['error']}")
        sys.exit(1)

    source = result["source"]
    name = result.get("contract_name", "Unknown")
    print(f"Contrato: {name} | Compiler: {result.get('compiler_version', '?')}")

    orchestrator = Orchestrator()
    report = await orchestrator.run_audit(source, name)
    return report


async def main_async(args):
    if args.address:
        report = await audit_from_address(args.address)

    elif args.file:
        source, name = read_single_contract(args.file)
        print(f"Auditing single contract: {name} ({len(source)} chars)")
        orchestrator = Orchestrator()
        report = await orchestrator.run_audit(source, name)

    elif args.directory:
        source, name = read_multiple_contracts(args.directory)
        print(f"Auditing directory: {name} ({len(source)} chars, {source.count('.sol')} files)")
        orchestrator = Orchestrator()
        report = await orchestrator.run_audit(source, name)

    else:
        print("Error: Debes proporcionar --file, --directory, o --address")
        sys.exit(1)

    score = report["executive_report"]["security_score"]
    findings_count = len(report["executive_report"]["hallazgos"])
    cost = report["executive_report"]["costo_auditoria_tokens"]["total_usd"]

    print("\n" + "=" * 60)
    print(f"  AUDITORÍA COMPLETADA")
    print(f"  Security Score: {score}/100")
    print(f"  Hallazgos: {findings_count}")
    print(f"  Costo: ${cost:.6f} USD")
    print(f"  Estado: {report['executive_report']['estado_pago']}")
    print("=" * 60)

    return report


def main():
    parser = argparse.ArgumentParser(
        description="Equipo de Auditoría Multi-Agente para Smart Contracts (Avalanche)"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", "-f", help="Ruta a un archivo .sol único")
    group.add_argument("--directory", "-d", help="Directorio con múltiples archivos .sol")
    group.add_argument("--address", "-a", help="Address del contrato en Avalanche (fetch desde Snowtrace)")
    parser.add_argument("--output", "-o", help="Directorio de salida (default: output/)")

    args = parser.parse_args()

    if args.output:
        os.environ["OUTPUT_DIR"] = args.output

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
