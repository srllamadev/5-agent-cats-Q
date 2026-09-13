// ============================================================
//  IPFS.JS — Report upload (simulated CID or Pinata)
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

// ── Simulated IPFS (default) ──────────────────────────────────
/**
 * Generates a deterministic-looking fake IPFS CID from the audit result.
 * No network call. Used when settings.ipfsMode === 'simulated'.
 */
export function simulateIPFSUpload(auditResult) {
  const json   = JSON.stringify(auditResult);
  const hash32 = simpleHash(json);
  // CIDv1 base32 format (Qm... = CIDv0 style)
  const fakeCID = `Qm${hash32}${randomHex(10)}`;
  return {
    simulated: true,
    cid:  fakeCID,
    url: `https://ipfs.io/ipfs/${fakeCID}`,
    sizeBytes: new TextEncoder().encode(json).length,
    uploadedAt: new Date().toISOString(),
  };
}

// ── Pinata upload ─────────────────────────────────────────────
/**
 * Uploads report JSON to IPFS via Pinata API.
 * Requires a Pinata JWT in localStorage as 'apikey_pinata'.
 */
export async function uploadToPinata(auditResult, pinataJwt) {
  if (!pinataJwt) throw new Error('Pinata JWT not configured.');

  const blob     = new Blob([JSON.stringify(auditResult, null, 2)], { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', blob, `audit-${auditResult.audit_id}.json`);
  formData.append('pinataMetadata', JSON.stringify({ name: `Audit ${auditResult.audit_id}` }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Pinata error ${res.status}: ${err?.error || res.statusText}`);
  }

  const data = await res.json();
  return {
    simulated: false,
    cid:  data.IpfsHash,
    url: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
    sizeBytes: data.PinSize,
    uploadedAt: new Date().toISOString(),
  };
}

// ── Dispatch based on settings ────────────────────────────────
export async function uploadReport(auditResult, settings) {
  switch (settings.ipfsMode) {
    case 'pinata': {
      const jwt = localStorage.getItem('apikey_pinata') || '';
      return uploadToPinata(auditResult, jwt);
    }
    default:
      return simulateIPFSUpload(auditResult);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function simpleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0').toUpperCase();
}

function randomHex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
}
