// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AuditSettlement {
    struct Audit {
        address auditor;
        address client;
        string contractAddress;
        uint256 securityScore;
        string ipfsHash;
        bool isPartial;
        bool isCompleted;
        uint256 fee;
        uint256 timestamp;
    }

    address public owner;
    uint256 public auditCount;
    mapping(bytes32 => Audit) public audits;
    mapping(address => bool) public authorizedAuditors;

    uint256 public constant PLATFORM_FEE_BPS = 500;
    uint256 public constant MAX_SCORE = 100;

    event AuditCreated(bytes32 indexed auditId, address indexed auditor, address indexed client);
    event AuditCompleted(bytes32 indexed auditId, uint256 securityScore, bool isPartial);
    event AuditorAuthorized(address indexed auditor, bool authorized);
    event FeeDistributed(bytes32 indexed auditId, uint256 auditorShare, uint256 platformShare);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAuthorizedAuditor() {
        require(authorizedAuditors[msg.sender], "Not authorized auditor");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedAuditors[msg.sender] = true;
    }

    function authorizeAuditor(address auditor, bool authorized) external onlyOwner {
        authorizedAuditors[auditor] = authorized;
        emit AuditorAuthorized(auditor, authorized);
    }

    function createAudit(
        address client,
        string calldata contractAddr,
        uint256 fee
    ) external onlyAuthorizedAuditor returns (bytes32) {
        auditCount++;
        bytes32 auditId = keccak256(abi.encodePacked(auditCount, msg.sender, block.timestamp));

        audits[auditId] = Audit({
            auditor: msg.sender,
            client: client,
            contractAddress: contractAddr,
            securityScore: 0,
            ipfsHash: "",
            isPartial: false,
            isCompleted: false,
            fee: fee,
            timestamp: block.timestamp
        });

        emit AuditCreated(auditId, msg.sender, client);
        return auditId;
    }

    function completeAudit(
        bytes32 auditId,
        uint256 securityScore,
        string calldata ipfsHash,
        bool isPartial
    ) external {
        Audit storage audit = audits[auditId];
        require(audit.auditor != address(0), "Audit does not exist");
        require(audit.auditor == msg.sender, "Not audit author");
        require(!audit.isCompleted, "Already completed");
        require(securityScore <= MAX_SCORE, "Score out of range");

        audit.securityScore = securityScore;
        audit.ipfsHash = ipfsHash;
        audit.isPartial = isPartial;
        audit.isCompleted = true;

        emit AuditCompleted(auditId, securityScore, isPartial);

        if (audit.fee > 0) {
            _distributeFee(auditId);
        }
    }

    function _distributeFee(bytes32 auditId) internal {
        Audit storage audit = audits[auditId];
        uint256 fee = audit.fee;

        uint256 platformShare = (fee * PLATFORM_FEE_BPS) / 10000;
        uint256 auditorShare = fee - platformShare;

        if (audit.isPartial) {
            auditorShare = (auditorShare * 70) / 100;
            platformShare = fee - auditorShare;
        }

        (bool ok1, ) = payable(audit.auditor).call{value: auditorShare}("");
        require(ok1, "Auditor payment failed");

        (bool ok2, ) = payable(owner).call{value: platformShare}("");
        require(ok2, "Platform payment failed");

        emit FeeDistributed(auditId, auditorShare, platformShare);
    }

    function getAudit(bytes32 auditId) external view returns (
        address auditor,
        address client,
        string memory contractAddress,
        uint256 securityScore,
        string memory ipfsHash,
        bool isPartial,
        bool isCompleted,
        uint256 fee,
        uint256 timestamp
    ) {
        Audit storage a = audits[auditId];
        return (
            a.auditor,
            a.client,
            a.contractAddress,
            a.securityScore,
            a.ipfsHash,
            a.isPartial,
            a.isCompleted,
            a.fee,
            a.timestamp
        );
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    receive() external payable {}
}
