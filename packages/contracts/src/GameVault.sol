// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GameVault
/// @notice Holds players' USDC for BOT or NOT. Players deposit once and stakes are drawn from
///         their balance, so nothing round-specific touches the chain before a chat ends.
/// @dev M0: deposits and withdrawals only. Round settlement and payout epochs arrive in M3.
contract GameVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    /// @notice Spendable balance per player.
    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed player, uint256 amount);
    event Withdrawn(address indexed player, uint256 amount);

    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);

    constructor(IERC20 usdc_, address owner_) Ownable(owner_) {
        usdc = usdc_;
    }

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdrawals stay open while paused so players can always leave.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        balanceOf[msg.sender] = available - amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
