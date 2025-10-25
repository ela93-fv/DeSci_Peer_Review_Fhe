pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract NftKeyFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error AlreadyInitialized();
    error NotInitialized();

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;
    mapping(uint256 => mapping(address => euint32)) public encryptedData;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 decryptedSum);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _initIfNeeded();
    }

    function _initIfNeeded() internal {
        if (FHE.isInitialized()) {
            return;
        }
        FHE.init();
    }

    function _requireInitialized() internal view {
        if (!FHE.isInitialized()) {
            revert NotInitialized();
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            paused = true;
            emit Paused(msg.sender);
        } else {
            paused = false;
            emit Unpaused(msg.sender);
        }
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == cooldownSeconds) revert InvalidCooldown();
        emit CooldownSet(cooldownSeconds, _cooldownSeconds);
        cooldownSeconds = _cooldownSeconds;
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (!batchClosed[currentBatchId]) revert BatchNotClosed();
        currentBatchId++;
        batchClosed[currentBatchId] = false;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (batchClosed[currentBatchId]) revert BatchClosed();
        batchClosed[currentBatchId] = true;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedData(euint32 encryptedValue) external onlyProvider whenNotPaused checkSubmissionCooldown {
        _requireInitialized();
        if (batchClosed[currentBatchId]) revert BatchClosed();

        encryptedData[currentBatchId][msg.sender] = encryptedValue;
        hasSubmitted[currentBatchId][msg.sender] = true;
        lastSubmissionTime[msg.sender] = block.timestamp;

        emit DataSubmitted(msg.sender, currentBatchId);
    }

    function requestBatchSumDecryption() external whenNotPaused checkDecryptionCooldown {
        _requireInitialized();
        if (!batchClosed[currentBatchId]) revert BatchNotClosed();

        euint32 memory encryptedSum = FHE.asEuint32(0);
        bool foundSubmission = false;
        for (uint256 i = 0; i < currentBatchId; i++) {
            if (batchClosed[i]) {
                for (address providerAddress = FHE.firstProvider(); providerAddress != address(0); providerAddress = FHE.nextProvider()) {
                    if (hasSubmitted[i][providerAddress]) {
                        encryptedSum = encryptedSum.add(encryptedData[i][providerAddress]);
                        foundSubmission = true;
                    }
                }
            }
        }

        if (!foundSubmission) revert NotInitialized(); 

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedSum.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        
        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal view returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        bytes32[] memory cts = new bytes32[](1);
        euint32 memory currentEncryptedSum = FHE.asEuint32(0);
        bool foundSubmission = false;

        for (uint256 i = 0; i < decryptionContexts[requestId].batchId; i++) {
            if (batchClosed[i]) {
                for (address providerAddress = FHE.firstProvider(); providerAddress != address(0); providerAddress = FHE.nextProvider()) {
                    if (hasSubmitted[i][providerAddress]) {
                        currentEncryptedSum = currentEncryptedSum.add(encryptedData[i][providerAddress]);
                        foundSubmission = true;
                    }
                }
            }
        }

        if (!foundSubmission) revert NotInitialized();
        cts[0] = currentEncryptedSum.toBytes32();
        
        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        uint256 sum = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, sum);
    }
}