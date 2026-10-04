// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Commitment} from "./Commitment.sol";

/// @notice The test token's faucet (GameToken.faucetFor).
interface IFaucet {
    function faucetFor(address account) external returns (uint256);
}

/// @title GameVault
/// @notice Holds players' tokens for BOT or NOT and settles rounds into payout pools (plan doc 06 v2).
///
///         Players deposit once and open a session that lets the operator stake for them, so
///         nothing round-specific touches the chain before a chat ends. After each round the
///         operator reveals the answer: the contract recomputes the commitment the player was given
///         before the chat, decides whether the call was right, and moves the stake.
///
///         A player whose wallet only signs needs no transaction of their own: they sign a message
///         and anyone (the game server) relays it and pays the gas (startSessionFor,
///         withdrawAllFor, and on testnet claimFaucetFor).
///
///         Every staked call in an epoch settles in one pool, the same way whether the partner was a
///         human or a bot. A wrong call forfeits the stake, split into a fee, a deception share
///         (to a human partner who fooled the caller and called right, otherwise the daily pool)
///         and a share for right callers. Right callers get their stake back plus an equal share,
///         claimable once the epoch closes. If both humans in a round are wrong, both forfeits
///         (less the fee) go to the daily pool. Mirrors packages/shared/src/settlement.ts.
contract GameVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice `call` value for a judge who didn't call: nothing is staked.
    uint8 public constant NO_CALL = 255;
    uint256 public constant FEE_BPS = 500;
    uint256 public constant DECEPTION_BPS = 2_500;
    uint256 public constant MAX_SESSION = 30 days;

    IERC20 public immutable token;
    /// @notice Fixed stake per call.
    uint256 public immutable stake;
    uint256 public immutable genesis;
    uint256 public immutable epochLength;

    address public operator;
    uint256 public fees;
    /// @notice Funds the daily leaderboard (paid by the owner with awardDailyPool).
    uint256 public dailyPool;

    /// @notice Spendable balance per player.
    mapping(address => uint256) public balanceOf;
    /// @notice Until when the operator may stake for a player.
    mapping(address => uint256) public sessionExpiry;
    /// @notice keccak256(abi.encode(roundId, judge)) => settled, so a call can't be settled twice.
    mapping(bytes32 => bool) public settled;
    /// @notice Each signed message carries the player's next nonce, so it can be used only once.
    mapping(address => uint256) public nonces;

    struct Epoch {
        uint32 rightCalls;
        uint32 wrongCalls;
        /// @dev Forfeit shares owed to this epoch's right callers.
        uint256 forRight;
        /// @dev Profit per right call, on top of the stake; set when the epoch closes.
        uint256 profitPerRight;
        bool closed;
    }

    struct PlayerEpoch {
        uint32 right;
        uint32 wrong;
        uint256 deception;
        bool claimed;
    }

    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(address => PlayerEpoch)) public playerEpochs;

    /// @notice One judge's reveal and call. partnerType and call use Commitment.HUMAN / BOT.
    struct Judge {
        address player;
        uint8 partnerType;
        bytes32 partnerId;
        bytes32 salt;
        uint8 call;
    }

    event Deposited(address indexed player, uint256 amount);
    event Withdrawn(address indexed player, uint256 amount);
    event SessionStarted(address indexed player, uint256 expiry);
    event SessionEnded(address indexed player);
    event RoundSettled(
        bytes32 indexed roundId,
        address indexed judge,
        uint256 indexed epoch,
        bytes32 commit,
        bytes32 transcriptHash,
        uint8 call,
        bool correct,
        bool staked
    );
    event DeceptionPaid(uint256 indexed epoch, address indexed deceiver, uint256 amount);
    event EpochClosed(uint256 indexed epoch, uint32 rightCalls, uint32 wrongCalls, uint256 profitPerRight);
    event Claimed(uint256 indexed epoch, address indexed player, uint256 amount);
    event DailyPoolAwarded(address indexed player, uint256 amount);
    event OperatorChanged(address operator);

    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error NotOperator();
    error BadSessionExpiry();
    error BadJudges();
    error InvalidCall();
    error AlreadySettled(bytes32 roundId, address judge);
    error EpochNotOver(uint256 epoch);
    error EpochAlreadyClosed(uint256 epoch);
    error EpochNotClosed(uint256 epoch);
    error BadSignature();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IERC20 token_, uint256 stake_, uint256 epochLength_, address owner_, address operator_)
        Ownable(owner_)
    {
        token = token_;
        stake = stake_;
        epochLength = epochLength_;
        genesis = block.timestamp;
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    // ---------- views ----------

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesis) / epochLength;
    }

    function epochEndsAt(uint256 epoch) public view returns (uint256) {
        return genesis + (epoch + 1) * epochLength;
    }

    // ---------- players ----------

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdrawals stay open while paused so players can always leave.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        balanceOf[msg.sender] = available - amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Lets the operator stake `stake` per call for the caller until `expiry`.
    function startSession(uint256 expiry) external {
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_SESSION) {
            revert BadSessionExpiry();
        }
        sessionExpiry[msg.sender] = expiry;
        emit SessionStarted(msg.sender, expiry);
    }

    function endSession() external {
        sessionExpiry[msg.sender] = 0;
        emit SessionEnded(msg.sender);
    }

    // ---------- players, by signature (anyone relays and pays the gas) ----------

    /// @notice Tops `player` up from the test token's faucet, straight into the game. Anyone can
    ///         call it; the tokens only ever go to `player`, at most once a day.
    function claimFaucetFor(address player) external whenNotPaused nonReentrant {
        uint256 amount = IFaucet(address(token)).faucetFor(player);
        balanceOf[player] += amount;
        emit Deposited(player, amount);
    }

    /// @notice startSession for `player`, who signed sessionMessage(days_, nonces[player]).
    function startSessionFor(address player, uint256 days_, bytes calldata signature) external {
        if (days_ == 0 || days_ * 1 days > MAX_SESSION) revert BadSessionExpiry();
        _useSignature(player, sessionMessage(days_, nonces[player]), signature);
        uint256 expiry = block.timestamp + days_ * 1 days;
        sessionExpiry[player] = expiry;
        emit SessionStarted(player, expiry);
    }

    /// @notice Sends `player` their whole balance; they signed withdrawAllMessage(nonces[player]).
    ///         Open while paused, like withdraw.
    function withdrawAllFor(address player, bytes calldata signature) external nonReentrant {
        _useSignature(player, withdrawAllMessage(nonces[player]), signature);
        uint256 amount = balanceOf[player];
        if (amount == 0) revert ZeroAmount();
        balanceOf[player] = 0;
        token.safeTransfer(player, amount);
        emit Withdrawn(player, amount);
    }

    /// @notice What a player signs (as a personal message) to start a session of `days_` days.
    function sessionMessage(uint256 days_, uint256 nonce) public view returns (string memory) {
        return string.concat(
            "BOT or NOT: start a ",
            Strings.toString(days_),
            "-day session.\n\nThe game may stake ",
            Strings.toString(stake / 1e18),
            " tBON on each call I make until it ends.\n\n",
            _signedFooter(nonce)
        );
    }

    /// @notice What a player signs to withdraw their whole balance to their wallet.
    function withdrawAllMessage(uint256 nonce) public view returns (string memory) {
        return string.concat("BOT or NOT: withdraw all my tBON to my wallet.\n\n", _signedFooter(nonce));
    }

    function _signedFooter(uint256 nonce) private view returns (string memory) {
        return string.concat(
            "Vault: ",
            Strings.toChecksumHexString(address(this)),
            "\nChain: ",
            Strings.toString(block.chainid),
            "\nNonce: ",
            Strings.toString(nonce)
        );
    }

    /// @dev Accepts an EOA signature or a deployed smart wallet's (ERC-1271). A wallet that isn't
    ///      deployed yet (ERC-6492) has to be deployed first; the game server does that.
    function _useSignature(address player, string memory message, bytes calldata signature) private {
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(bytes(message));
        if (!SignatureChecker.isValidSignatureNow(player, hash, signature)) revert BadSignature();
        nonces[player]++;
    }

    // ---------- settlement ----------

    /// @notice Settles one round: one judge (a bot round, or a human round where only one side is
    ///         staked) or both judges of a human round. A judge whose session has lapsed or whose
    ///         balance can't cover the stake is recorded but not staked.
    function settleRound(bytes32 roundId, bytes32 transcriptHash, Judge[] calldata judges)
        external
        onlyOperator
        whenNotPaused
    {
        uint256 n = judges.length;
        if (n == 0 || n > 2) revert BadJudges();
        if (n == 2) {
            Judge calldata a = judges[0];
            Judge calldata b = judges[1];
            if (
                a.partnerType != Commitment.HUMAN || b.partnerType != Commitment.HUMAN
                    || a.partnerId != _humanId(b.player) || b.partnerId != _humanId(a.player)
            ) revert BadJudges();
        }

        uint256 e = currentEpoch();
        bool[2] memory staked;
        bool[2] memory correct;
        for (uint256 i; i < n; i++) {
            (staked[i], correct[i]) = _open(roundId, transcriptHash, e, judges[i]);
        }
        for (uint256 i; i < n; i++) {
            if (!staked[i] || correct[i]) continue;
            bool hasPartner = n == 2 && staked[1 - i];
            _forfeit(e, hasPartner, hasPartner && correct[1 - i], hasPartner ? judges[1 - i].player : address(0));
        }
    }

    /// @notice Closes an epoch once it is over; anyone can call it.
    function closeEpoch(uint256 epoch) external {
        if (epoch >= currentEpoch()) revert EpochNotOver(epoch);
        Epoch storage ep = epochs[epoch];
        if (ep.closed) revert EpochAlreadyClosed(epoch);
        ep.closed = true;
        if (ep.rightCalls == 0) {
            dailyPool += ep.forRight;
        } else {
            uint256 profit = ep.forRight / ep.rightCalls;
            ep.profitPerRight = profit;
            dailyPool += ep.forRight - profit * ep.rightCalls;
        }
        emit EpochClosed(epoch, ep.rightCalls, ep.wrongCalls, ep.profitPerRight);
    }

    /// @notice Credits right callers of a closed epoch; anyone can call it, funds only go to players.
    function claim(uint256 epoch, address[] calldata players) external {
        Epoch storage ep = epochs[epoch];
        if (!ep.closed) revert EpochNotClosed(epoch);
        uint256 perRight = stake + ep.profitPerRight;
        for (uint256 i; i < players.length; i++) {
            PlayerEpoch storage pe = playerEpochs[epoch][players[i]];
            if (pe.claimed || pe.right == 0) continue;
            pe.claimed = true;
            uint256 amount = perRight * pe.right;
            balanceOf[players[i]] += amount;
            emit Claimed(epoch, players[i], amount);
        }
    }

    function _open(bytes32 roundId, bytes32 transcriptHash, uint256 e, Judge calldata j)
        private
        returns (bool staked, bool correct)
    {
        if (j.partnerType > Commitment.BOT || (j.call > Commitment.BOT && j.call != NO_CALL)) {
            revert InvalidCall();
        }
        bytes32 key = keccak256(abi.encode(roundId, j.player));
        if (settled[key]) revert AlreadySettled(roundId, j.player);
        settled[key] = true;

        bytes32 commit = Commitment.compute(roundId, j.player, j.partnerType, j.partnerId, j.salt);
        correct = j.call == j.partnerType;
        staked = j.call != NO_CALL && sessionExpiry[j.player] >= block.timestamp
            && balanceOf[j.player] >= stake;
        if (staked) {
            balanceOf[j.player] -= stake;
            PlayerEpoch storage pe = playerEpochs[e][j.player];
            if (correct) {
                epochs[e].rightCalls++;
                pe.right++;
            } else {
                epochs[e].wrongCalls++;
                pe.wrong++;
            }
        }
        emit RoundSettled(roundId, j.player, e, commit, transcriptHash, j.call, correct, staked);
    }

    function _forfeit(uint256 e, bool hasPartner, bool partnerCorrect, address partner) private {
        uint256 feeEach = stake * FEE_BPS / 10_000;
        uint256 deceptionEach = stake * DECEPTION_BPS / 10_000;
        fees += feeEach;
        if (hasPartner && !partnerCorrect) {
            // Both humans fooled each other: the whole forfeit, less the fee, feeds the daily pool.
            dailyPool += stake - feeEach;
            return;
        }
        if (partnerCorrect) {
            balanceOf[partner] += deceptionEach;
            playerEpochs[e][partner].deception += deceptionEach;
            emit DeceptionPaid(e, partner, deceptionEach);
        } else {
            dailyPool += deceptionEach;
        }
        epochs[e].forRight += stake - feeEach - deceptionEach;
    }

    function _humanId(address player) private pure returns (bytes32) {
        return bytes32(uint256(uint160(player)));
    }

    // ---------- owner ----------

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function withdrawFees(address to) external onlyOwner {
        uint256 amount = fees;
        fees = 0;
        token.safeTransfer(to, amount);
    }

    /// @notice Pays daily leaderboard winners from the daily pool.
    function awardDailyPool(address[] calldata players, uint256[] calldata amounts) external onlyOwner {
        if (players.length != amounts.length) revert BadJudges();
        for (uint256 i; i < players.length; i++) {
            if (amounts[i] > dailyPool) revert InsufficientBalance(dailyPool, amounts[i]);
            dailyPool -= amounts[i];
            balanceOf[players[i]] += amounts[i];
            emit DailyPoolAwarded(players[i], amounts[i]);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
