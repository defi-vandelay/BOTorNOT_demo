// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GameVault} from "../src/GameVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract GameVaultTest is Test {
    MockUSDC usdc;
    GameVault vault;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new GameVault(usdc, owner);
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_depositAndWithdraw() public {
        vm.startPrank(alice);
        vault.deposit(10e6);
        assertEq(vault.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(address(vault)), 10e6);

        vault.withdraw(4e6);
        assertEq(vault.balanceOf(alice), 6e6);
        assertEq(usdc.balanceOf(alice), 94e6);
        vm.stopPrank();
    }

    function test_cannotWithdrawMoreThanBalance() public {
        vm.startPrank(alice);
        vault.deposit(1e6);
        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientBalance.selector, 1e6, 2e6));
        vault.withdraw(2e6);
        vm.stopPrank();
    }

    function test_rejectsZeroAmounts() public {
        vm.startPrank(alice);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.deposit(0);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.withdraw(0);
        vm.stopPrank();
    }

    function test_pauseBlocksDepositsButNotWithdrawals() public {
        vm.prank(alice);
        vault.deposit(5e6);

        vm.prank(owner);
        vault.pause();

        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(1e6);
        vault.withdraw(5e6);
        vm.stopPrank();
        assertEq(vault.balanceOf(alice), 0);
    }

    function testFuzz_balanceTracksDeposits(uint96 a, uint96 b) public {
        uint256 total = uint256(a) + uint256(b);
        vm.assume(a > 0 && b > 0 && total <= 100e6);
        vm.startPrank(alice);
        vault.deposit(a);
        vault.deposit(b);
        vm.stopPrank();
        assertEq(vault.balanceOf(alice), total);
    }
}
