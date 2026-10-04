// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title GameToken
/// @notice Testnet stand-in for the platform's native token (plan doc 06). It has no value: anyone
///         can claim a fixed amount from the faucet once a day, into their wallet or (through the
///         game vault) straight into the game. A mainnet token would have no faucet and a fixed,
///         documented supply.
contract GameToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e18;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    address private immutable deployer;
    /// @notice The game vault, which may claim the faucet on a player's behalf. Set once.
    address public vault;

    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);
    error NotVault();
    error VaultAlreadySet();

    constructor() ERC20("BOT or NOT Test Token", "tBON") {
        deployer = msg.sender;
    }

    function setVault(address vault_) external {
        if (msg.sender != deployer || vault != address(0)) revert VaultAlreadySet();
        vault = vault_;
    }

    /// @notice Sends FAUCET_AMOUNT to the caller, at most once per FAUCET_COOLDOWN.
    function faucet() external {
        _claim(msg.sender, msg.sender);
    }

    /// @notice The vault claims `account`'s faucet into itself and credits it to them there, so a
    ///         player can be topped up without sending a transaction. Shares faucet()'s cooldown.
    function faucetFor(address account) external returns (uint256) {
        if (msg.sender != vault) revert NotVault();
        _claim(account, msg.sender);
        return FAUCET_AMOUNT;
    }

    function _claim(address account, address to) private {
        uint256 last = lastClaim[account];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastClaim[account] = block.timestamp;
        _mint(to, FAUCET_AMOUNT);
        emit FaucetClaimed(account, FAUCET_AMOUNT);
    }
}
