// ============================================================
//  PARSER.JS — Input Handler for all 3 contract input modes
//  Mode 1: Single .sol  |  Mode 2: Multiple .sol  |  Mode 3: Address
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

// ── Mode 1 & 2: File reading ──────────────────────────────────

/**
 * Read a single File object as text.
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file, 'utf-8');
  });
}

/**
 * Read multiple .sol files and merge them with boundary comments.
 * Returns a single string representing the full contract context.
 */
export async function readMultipleFiles(files) {
  const contents = [];
  for (const file of files) {
    if (!file.name.endsWith('.sol')) continue;
    const text = await readFileAsText(file);
    contents.push(`// ===== FILE: ${file.name} =====\n${text}\n`);
  }
  if (contents.length === 0) {
    throw new Error('No valid .sol files found in the selection.');
  }
  return contents.join('\n');
}

/**
 * Read a single .sol file.
 */
export async function readSingleFile(file) {
  if (!file.name.endsWith('.sol')) {
    throw new Error(`File "${file.name}" is not a .sol Solidity file.`);
  }
  return readFileAsText(file);
}

// ── Mode 3: Contract address → Snowtrace API ──────────────────

const SNOWTRACE_API = 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';
const SNOWTRACE_TESTNET = 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api';

/**
 * Fetch verified Solidity source for a deployed contract on Avalanche C-Chain.
 *
 * @param {string} address    - Contract address (0x...)
 * @param {string} [apiKey]   - Optional Snowtrace API key; uses free endpoint if omitted
 * @param {boolean} [testnet] - Use testnet (Fuji) instead of mainnet
 * @returns {{ source: string, contractName: string, compilerVersion: string, abi: object }}
 */
export async function fetchContractSource(address, apiKey = '', testnet = false) {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }

  const base = testnet ? SNOWTRACE_TESTNET : SNOWTRACE_API;
  const key  = apiKey || 'YourApiKeyToken'; // free-tier placeholder

  const url = `${base}?module=contract&action=getsourcecode&address=${address}&apikey=${key}`;

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    throw new Error(`Failed to reach Snowtrace API: ${err.message}`);
  }

  if (data.status !== '1' || !data.result?.[0]) {
    throw new Error(
      data.message === 'NOTOK'
        ? 'Contract not verified or not found on Snowtrace.'
        : `Snowtrace error: ${data.message}`
    );
  }

  const result = data.result[0];

  // Handle Vyper / unverified
  if (!result.SourceCode) {
    throw new Error('Contract source code is not verified on Snowtrace.');
  }

  // Snowtrace returns JSON-encoded multi-file sources for flattened contracts
  let source = result.SourceCode;

  // Some verified contracts wrap source in double-braces {{ ... }}
  if (source.startsWith('{{')) {
    try {
      const inner = JSON.parse(source.slice(1, -1));
      // inner.sources is a map of filename → { content }
      const parts = Object.entries(inner.sources || {}).map(
        ([fname, { content }]) => `// ===== FILE: ${fname} =====\n${content}\n`
      );
      source = parts.join('\n');
    } catch {
      // Fallback: use raw source as-is
    }
  }

  let abi = [];
  try { abi = JSON.parse(result.ABI); } catch { /* ABI parse failure is non-fatal */ }

  return {
    source,
    contractName:    result.ContractName    || 'Unknown',
    compilerVersion: result.CompilerVersion || 'Unknown',
    abi,
    address,
    network: testnet ? 'Avalanche Fuji (Testnet)' : 'Avalanche C-Chain (Mainnet)',
  };
}

// ── Solidity pre-processing helpers ──────────────────────────

/**
 * Extract only payable/transfer/swap function bodies from source.
 * Returns a trimmed string containing just those functions.
 */
export function extractPayableFunctions(source) {
  const lines     = source.split('\n');
  const results   = [];
  let   depth     = 0;
  let   capturing = false;
  let   buffer    = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const isFunc  = /^function\s+/.test(trimmed);
    const isPayableOrTransfer =
      /\bpayable\b/.test(trimmed) ||
      /\btransfer\b|\bsend\b|\bcall\b|\bswap\b|\bdeposit\b|\bwithdraw\b/i.test(trimmed);

    if (isFunc && isPayableOrTransfer) {
      capturing = true;
      buffer    = [];
      depth     = 0;
    }

    if (capturing) {
      buffer.push(line);
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0 && buffer.length > 1) {
        results.push(buffer.join('\n'));
        capturing = false;
      }
    }
  }

  return results.join('\n\n') || '// No payable/transfer/swap functions found';
}

/**
 * Extract constructor + all modifiers + all state variable declarations.
 */
export function extractConstructorAndModifiers(source) {
  const lines   = source.split('\n');
  const results = [];
  let capturing = false;
  let depth     = 0;
  let buffer    = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const isTarget =
      /^constructor\s*\(/.test(trimmed) ||
      /^modifier\s+/.test(trimmed)      ||
      /^(public|private|internal|external)?\s*(immutable|constant)?\s+\w+/.test(trimmed) && !/^function/.test(trimmed);

    if ((isTarget && !capturing) || (trimmed.startsWith('constructor') && !capturing)) {
      capturing = true;
      buffer    = [];
      depth     = 0;
    }

    if (capturing) {
      buffer.push(line);
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;

      // State vars are single-line (no braces or depth hits 0 quickly)
      if (depth <= 0 && buffer.length >= 1) {
        results.push(buffer.join('\n'));
        capturing = false;
      }
    } else if (
      /^\s*(address|uint|int|bool|bytes|string|mapping|struct|enum)\b/.test(line) &&
      !line.includes('function')
    ) {
      // State variable declarations — always single line capture
      results.push(line.trim());
    }
  }

  return results.join('\n') || '// No constructor/modifiers/state vars found';
}

/**
 * Validate 0x Ethereum address format.
 */
export function isValidAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Generates a UUID-like audit ID.
 */
export function generateAuditId() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AUDIT-${ts}-${rnd}`;
}
