// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The commit-reveal hash shared with packages/shared/src/commitment.ts.
library Commitment {
    uint8 internal constant HUMAN = 0;
    uint8 internal constant BOT = 1;

    /// @dev keccak256(abi.encode(roundId, judge, partnerType, partnerId, salt))
    function compute(
        bytes32 roundId,
        address judge,
        uint8 partnerType,
        bytes32 partnerId,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(roundId, judge, partnerType, partnerId, salt));
    }
}
