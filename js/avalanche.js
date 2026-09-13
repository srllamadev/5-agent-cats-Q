// ============================================================
//  AVALANCHE.JS — Snowtrace source fetch + on-chain completeAudit()
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

// ABI for the AuditRegistry contract (completeAudit function)
const AUDIT_REGISTRY_ABI = [
  {
    inputs: [
      { internalType: 'string',  name: 'auditId',       type: 'string'  },
      { internalType: 'uint256', name: 'securityScore', type: 'uint256' },
      { internalType: 'string',  name: 'ipfsHash',      type: 'string'  },
    ],
    name: 'completeAudit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

// Avalanche C-Chain RPC
export const AVAX_RPC          = 'https://api.avax.network/ext/bc/C/rpc';
export const AVAX_CHAIN_ID     = 43114;
export const AVAX_EXPLORER     = 'https://snowtrace.io/tx/';

// Placeholder registry contract address — set your deployed address here
const REGISTRY_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── Simulated completeAudit (no real tx) ─────────────────────
/**
 * Simulates the completeAudit() call and returns a fake tx receipt.
 * Used when settings.chainMode === 'simulated'.
 */
export function simulateCompleteAudit(auditId, securityScore, ipfsHash) {
  const fakeTxHash = '0x' + Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  return {
    simulated: true,
    txHash:    fakeTxHash,
    auditId,
    securityScore,
    ipfsHash,
    network:   'Avalanche C-Chain (simulated)',
    timestamp: new Date().toISOString(),
    payload: {
      to:       REGISTRY_CONTRACT_ADDRESS,
      chainId:  AVAX_CHAIN_ID,
      function: 'completeAudit(string,uint256,string)',
      args:     [auditId, securityScore, ipfsHash],
    },
  };
}

// ── Live completeAudit via ethers.js + MetaMask ───────────────
/**
 * Calls completeAudit() on-chain using MetaMask (window.ethereum).
 * Requires ethers.js loaded as a global (CDN).
 *
 * @param {string}  auditId
 * @param {number}  securityScore   0–100
 * @param {string}  ipfsHash
 * @param {string}  contractAddress Registry contract address
 * @returns {{ txHash: string, explorerUrl: string }}
 */
export async function liveCompleteAudit(auditId, securityScore, ipfsHash, contractAddress) {
  if (typeof window.ethers === 'undefined') {
    throw new Error('ethers.js not loaded. Ensure CDN script is included in HTML.');
  }

  if (!window.ethereum) {
    throw new Error('No Web3 wallet detected. Please install MetaMask or Core Wallet.');
  }

  // Request accounts
  await window.ethereum.request({ method: 'eth_requestAccounts' });

  // Switch to Avalanche if needed
  await ensureAvalancheNetwork();

  const provider = new window.ethers.BrowserProvider(window.ethereum);
  const signer   = await provider.getSigner();

  const addr = contractAddress || REGISTRY_CONTRACT_ADDRESS;
  if (addr === '0x0000000000000000000000000000000000000000') {
    throw new Error('Registry contract address not configured. Update REGISTRY_CONTRACT_ADDRESS in avalanche.js.');
  }

  const contract = new window.ethers.Contract(addr, AUDIT_REGISTRY_ABI, signer);
  const tx       = await contract.completeAudit(auditId, BigInt(securityScore), ipfsHash);
  const receipt  = await tx.wait();

  return {
    simulated:   false,
    txHash:      receipt.hash,
    explorerUrl: `${AVAX_EXPLORER}${receipt.hash}`,
    auditId,
    securityScore,
    ipfsHash,
    network: 'Avalanche C-Chain (mainnet)',
    blockNumber: receipt.blockNumber,
    timestamp: new Date().toISOString(),
  };
}

// ── Switch to Avalanche C-Chain in MetaMask ───────────────────
async function ensureAvalancheNetwork() {
  const chainIdHex = `0x${AVAX_CHAIN_ID.toString(16)}`; // 0xa86a

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    // 4902 = chain not added yet
    if (err.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chainIdHex,
          chainName:        'Avalanche C-Chain',
          nativeCurrency:   { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
          rpcUrls:          [AVAX_RPC],
          blockExplorerUrls: ['https://snowtrace.io/'],
        }],
      });
    } else {
      throw err;
    }
  }
}

// ── Dispatch completeAudit based on settings ──────────────────
export async function dispatchCompleteAudit(auditId, securityScore, ipfsHash, settings) {
  if (settings.chainMode === 'live') {
    return liveCompleteAudit(auditId, securityScore, ipfsHash, REGISTRY_CONTRACT_ADDRESS);
  }
  return simulateCompleteAudit(auditId, securityScore, ipfsHash);
}
