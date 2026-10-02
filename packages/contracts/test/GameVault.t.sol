// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GameVault} from "../src/GameVault.sol";
import {GameToken} from "../src/GameToken.sol";
import {Commitment} from "../src/Commitment.sol";

contract GameVaultTest is Test {
    uint256 constant STAKE = 100e18;
    uint256 constant EPOCH = 600;
    uint8 constant HUMAN = 0;
    uint8 constant BOT = 1;
    uint8 constant NONE = 255;

    GameToken token;
    GameVault vault;
    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    bytes32 salt = bytes32(uint256(7));
    bytes32 transcript = keccak256("transcript");
    bytes32 persona = keccak256(bytes("persona-001"));
    uint256 nextRound = 1;

    function setUp() public {
        vm.warp(1_000_000);
        token = new GameToken();
        vault = new GameVault(token, STAKE, EPOCH, owner, operator);
        for (uint256 i; i < 3; i++) {
            address p = [alice, bob, carol][i];
            vm.startPrank(p);
            token.faucet();
            token.approve(address(vault), type(uint256).max);
            vault.deposit(1_000e18);
            vault.startSession(block.timestamp + 1 days);
            vm.stopPrank();
        }
    }

    // ---------- helpers ----------

    function _id(address p) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(p)));
    }

    function _bot(address player, uint8 call) internal returns (bytes32 roundId) {
        roundId = bytes32(nextRound++);
        GameVault.Judge[] memory js = new GameVault.Judge[](1);
        js[0] = GameVault.Judge(player, BOT, persona, salt, call);
        vm.prank(operator);
        vault.settleRound(roundId, transcript, js);
    }

    function _pair(address a, uint8 callA, address b, uint8 callB) internal returns (bytes32 roundId) {
        roundId = bytes32(nextRound++);
        GameVault.Judge[] memory js = new GameVault.Judge[](2);
        js[0] = GameVault.Judge(a, HUMAN, _id(b), salt, callA);
        js[1] = GameVault.Judge(b, HUMAN, _id(a), salt, callB);
        vm.prank(operator);
        vault.settleRound(roundId, transcript, js);
    }

    function _closeAndClaim(uint256 epoch) internal {
        vm.warp(vault.epochEndsAt(epoch));
        vault.closeEpoch(epoch);
        address[] memory ps = new address[](3);
        ps[0] = alice;
        ps[1] = bob;
        ps[2] = carol;
        vault.claim(epoch, ps);
    }

    // ---------- deposits and sessions ----------

    function test_depositAndWithdraw() public {
        vm.startPrank(alice);
        vault.withdraw(400e18);
        assertEq(vault.balanceOf(alice), 600e18);
        assertEq(token.balanceOf(alice), 400e18);
        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientBalance.selector, 600e18, 700e18));
        vault.withdraw(700e18);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.deposit(0);
        vm.stopPrank();
    }

    function test_pauseBlocksDepositsButNotWithdrawals() public {
        vm.prank(owner);
        vault.pause();
        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(1e18);
        vault.withdraw(1_000e18);
        vm.stopPrank();
        assertEq(vault.balanceOf(alice), 0);
    }

    function test_faucetCooldown() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GameToken.FaucetCooldown.selector, block.timestamp + 1 days));
        token.faucet();
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 1_000e18);
    }

    function test_sessionExpiryBounds() public {
        vm.startPrank(alice);
        vm.expectRevert(GameVault.BadSessionExpiry.selector);
        vault.startSession(block.timestamp);
        vm.expectRevert(GameVault.BadSessionExpiry.selector);
        vault.startSession(block.timestamp + 31 days);
        vm.stopPrank();
    }

    // ---------- settlement ----------

    function test_onlyOperatorSettles() public {
        GameVault.Judge[] memory js = new GameVault.Judge[](1);
        js[0] = GameVault.Judge(alice, BOT, persona, salt, BOT);
        vm.expectRevert(GameVault.NotOperator.selector);
        vault.settleRound(bytes32(uint256(1)), transcript, js);
    }

    function test_emitsTheCommitmentFromTheReveal() public {
        bytes32 roundId = bytes32(uint256(99));
        GameVault.Judge[] memory js = new GameVault.Judge[](1);
        js[0] = GameVault.Judge(alice, BOT, persona, salt, HUMAN);
        bytes32 commit = Commitment.compute(roundId, alice, BOT, persona, salt);
        vm.expectEmit(address(vault));
        emit GameVault.RoundSettled(roundId, alice, 0, commit, transcript, HUMAN, false, true);
        vm.prank(operator);
        vault.settleRound(roundId, transcript, js);
    }

    function test_cannotSettleTwice() public {
        bytes32 roundId = _bot(alice, BOT);
        GameVault.Judge[] memory js = new GameVault.Judge[](1);
        js[0] = GameVault.Judge(alice, BOT, persona, salt, BOT);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(GameVault.AlreadySettled.selector, roundId, alice));
        vault.settleRound(roundId, transcript, js);
    }

    function test_pairMustReferenceEachOther() public {
        GameVault.Judge[] memory js = new GameVault.Judge[](2);
        js[0] = GameVault.Judge(alice, HUMAN, _id(carol), salt, HUMAN);
        js[1] = GameVault.Judge(bob, HUMAN, _id(alice), salt, HUMAN);
        vm.prank(operator);
        vm.expectRevert(GameVault.BadJudges.selector);
        vault.settleRound(bytes32(uint256(1)), transcript, js);
    }

    function test_noCallStakesNothing() public {
        _bot(alice, NONE);
        assertEq(vault.balanceOf(alice), 1_000e18);
    }

    function test_noSessionStakesNothing() public {
        vm.prank(alice);
        vault.endSession();
        _bot(alice, HUMAN);
        assertEq(vault.balanceOf(alice), 1_000e18);
    }

    /// One right and one wrong call against bots: the wrong stake splits 5 fee, 25 daily pool
    /// (no human deceiver), 70 to the right caller.
    function test_botRoundsSettleInTheEpochPool() public {
        _bot(alice, BOT);
        _bot(bob, HUMAN);
        assertEq(vault.balanceOf(alice), 900e18);
        assertEq(vault.balanceOf(bob), 900e18);

        _closeAndClaim(0);
        assertEq(vault.balanceOf(alice), 1_070e18);
        assertEq(vault.balanceOf(bob), 900e18);
        assertEq(vault.fees(), 5e18);
        assertEq(vault.dailyPool(), 25e18);
    }

    /// Alice fools Bob (he calls BOT) and calls right herself: she gets the 25 deception share at
    /// once, and as the only right caller the 70 at epoch close.
    function test_deceptionShareGoesToTheHumanWhoFooledYou() public {
        _pair(alice, HUMAN, bob, BOT);
        assertEq(vault.balanceOf(alice), 925e18);
        (,, uint256 deception,) = vault.playerEpochs(0, alice);
        assertEq(deception, 25e18);

        _closeAndClaim(0);
        assertEq(vault.balanceOf(alice), 1_095e18);
        assertEq(vault.balanceOf(bob), 900e18);
        assertEq(vault.dailyPool(), 0);
    }

    function test_bothHumansWrongFeedsTheDailyPool() public {
        _pair(alice, BOT, bob, BOT);
        _closeAndClaim(0);
        assertEq(vault.balanceOf(alice), 900e18);
        assertEq(vault.balanceOf(bob), 900e18);
        assertEq(vault.fees(), 10e18);
        assertEq(vault.dailyPool(), 190e18);
    }

    function test_partnerWithoutACallSendsDeceptionToTheDailyPool() public {
        _pair(alice, NONE, bob, BOT);
        _closeAndClaim(0);
        assertEq(vault.balanceOf(alice), 1_000e18);
        // No right callers: the 70 goes to the daily pool as well.
        assertEq(vault.dailyPool(), 95e18);
    }

    /// Two right callers split one forfeit's 70; rounding dust goes to the daily pool.
    function test_rightCallersShareEquallyWithDustToTheDailyPool() public {
        _bot(alice, BOT);
        _bot(bob, BOT);
        _bot(carol, HUMAN);
        _bot(carol, HUMAN);
        _bot(carol, BOT);
        // forRight = 140; three right calls → 46.666… each.
        _closeAndClaim(0);
        uint256 profit = uint256(140e18) / 3;
        assertEq(vault.balanceOf(alice), 1_000e18 + profit);
        assertEq(vault.balanceOf(carol), 800e18 + profit);
        assertEq(vault.dailyPool(), 50e18 + (140e18 - profit * 3));
    }

    function test_closeOnlyAfterTheEpochAndOnce() public {
        _bot(alice, BOT);
        vm.expectRevert(abi.encodeWithSelector(GameVault.EpochNotOver.selector, 0));
        vault.closeEpoch(0);
        _closeAndClaim(0);
        vm.expectRevert(abi.encodeWithSelector(GameVault.EpochAlreadyClosed.selector, 0));
        vault.closeEpoch(0);
        // Claiming again pays nothing more.
        address[] memory ps = new address[](1);
        ps[0] = alice;
        vault.claim(0, ps);
        assertEq(vault.balanceOf(alice), 1_000e18);
    }

    function test_claimNeedsAClosedEpoch() public {
        address[] memory ps = new address[](1);
        ps[0] = alice;
        vm.expectRevert(abi.encodeWithSelector(GameVault.EpochNotClosed.selector, 0));
        vault.claim(0, ps);
    }

    function test_awardDailyPoolAndFees() public {
        _pair(alice, BOT, bob, BOT);
        _closeAndClaim(0);
        address[] memory ps = new address[](1);
        ps[0] = carol;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 190e18;
        vm.startPrank(owner);
        vault.awardDailyPool(ps, amounts);
        vault.withdrawFees(owner);
        vm.stopPrank();
        assertEq(vault.balanceOf(carol), 1_190e18);
        assertEq(token.balanceOf(owner), 10e18);
    }

    /// Whatever happens, the vault holds exactly what it owes.
    function testFuzz_vaultStaysSolvent(uint256 seed) public {
        for (uint256 i; i < 12; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint8 c1 = uint8(r % 3 == 2 ? NONE : r % 2);
            uint8 c2 = uint8((r >> 8) % 3 == 2 ? NONE : (r >> 8) % 2);
            if ((r >> 16) % 2 == 0) _bot([alice, bob, carol][(r >> 24) % 3], c1);
            else _pair(alice, c1, bob, c2);
        }
        _closeAndClaim(0);
        uint256 owed = vault.balanceOf(alice) + vault.balanceOf(bob) + vault.balanceOf(carol)
            + vault.fees() + vault.dailyPool();
        assertEq(token.balanceOf(address(vault)), owed);
    }
}
