pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DeSciPeerReviewFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Paper {
        euint32 encryptedScore;
        bool exists;
    }
    mapping(uint256 => mapping(uint256 => Paper)) public papers; // batchId => paperId => Paper

    struct Batch {
        bool isOpen;
        bool isClosed;
        uint256 paperCount;
    }
    mapping(uint256 => Batch) public batches;
    uint256 public currentBatchId;

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
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event PaperSubmitted(address indexed provider, uint256 indexed batchId, uint256 indexed paperId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 aggregatedScore);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchNotOpen();
    error PaperAlreadyExists();
    error PaperDoesNotExist();
    error BatchNotClosed();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default 1 minute cooldown
        currentBatchId = 1; // Start with batch 1
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) public onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) public onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() public onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        require(paused, "Contract not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) public onlyOwner {
        require(newCooldownSeconds > 0, "Cooldown must be positive");
        emit CooldownSecondsSet(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function openBatch() public onlyOwner whenNotPaused {
        if (batches[currentBatchId].isOpen) revert BatchNotClosed();
        batches[currentBatchId] = Batch({isOpen: true, isClosed: false, paperCount: 0});
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() public onlyOwner whenNotPaused {
        if (!batches[currentBatchId].isOpen) revert BatchNotOpen();
        batches[currentBatchId].isOpen = false;
        batches[currentBatchId].isClosed = true;
        emit BatchClosed(currentBatchId);
        currentBatchId++; // Prepare for next batch
    }

    function submitReview(uint256 batchId, uint256 paperId, euint32 encryptedScore) public onlyProvider whenNotPaused respectCooldown {
        if (!batches[batchId].isOpen) revert BatchNotOpen();
        if (papers[batchId][paperId].exists) revert PaperAlreadyExists();

        _initIfNeeded(encryptedScore);

        papers[batchId][paperId] = Paper({encryptedScore: encryptedScore, exists: true});
        batches[batchId].paperCount++;
        lastSubmissionTime[msg.sender] = block.timestamp;

        emit PaperSubmitted(msg.sender, batchId, paperId);
    }

    function requestAggregatedScore(uint256 batchId) public onlyOwner whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (!batches[batchId].isClosed) revert BatchNotClosed();
        if (batches[batchId].paperCount == 0) revert InvalidBatch();

        euint32 encryptedAggregatedScore = FHE.asEuint32(0);
        uint256 count = 0;

        for (uint256 i = 0; i < batches[batchId].paperCount; i++) {
            Paper storage paper = papers[batchId][i];
            if (paper.exists) {
                encryptedAggregatedScore = encryptedAggregatedScore.add(paper.encryptedScore);
                count++;
            }
        }
        _initIfNeeded(encryptedAggregatedScore);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedAggregatedScore.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection prevents processing the same decryption request multiple times.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        euint32 encryptedAggregatedScore = FHE.asEuint32(abi.decode(FHE.toBytes32(papers[ctx.batchId][0].encryptedScore), (bytes))); // Rebuild one ciphertext for state hash
        _initIfNeeded(encryptedAggregatedScore);

        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = encryptedAggregatedScore.toBytes32();
        bytes32 currentHash = _hashCiphertexts(currentCts);

        if (currentHash != ctx.stateHash) revert StateMismatch();
        // Security: State hash verification ensures that the contract state relevant to the decryption request
        // has not changed since the request was made, preventing inconsistencies.

        try FHE.checkSignatures(requestId, cleartexts, proof) {
            // Decode cleartexts
            uint32 aggregatedScore = abi.decode(cleartexts, (uint32));

            decryptionContexts[requestId].processed = true;
            emit DecryptionCompleted(requestId, ctx.batchId, aggregatedScore);
        } catch {
            revert DecryptionFailed();
        }
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 v) internal {
        if (!FHE.isInitialized(v)) {
            v.add(FHE.asEuint32(0)); // Dummy operation to initialize if needed
        }
    }

    function _initIfNeeded(ebool b) internal {
        if (!FHE.isInitialized(b)) {
            b.eq(FHE.asEbool(false)); // Dummy operation to initialize if needed
        }
    }
}