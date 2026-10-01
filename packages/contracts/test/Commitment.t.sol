// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Commitment} from "../src/Commitment.sol";

contract CommitmentTest is Test {
    /// Same vector as packages/shared/test/commitment.test.ts, so the server, the browser
    /// and the contract all agree on the hash.
    function test_matchesTypeScriptVector() public pure {
        bytes32 roundId = bytes32(0x1111111111111111111111111111111111111111111111111111111111111111);
        address judge = address(0xaa);
        bytes32 partnerId = keccak256(bytes("persona-001"));
        bytes32 salt = bytes32(0x2222222222222222222222222222222222222222222222222222222222222222);

        assertEq(
            Commitment.compute(roundId, judge, Commitment.BOT, partnerId, salt),
            0x23b15ac1eaf9a69f502d1f818f78fb8e25a18cf8d05bc0ffdacb308fff408dd1
        );
    }

    function testFuzz_answerChangesHash(bytes32 roundId, address judge, bytes32 partnerId, bytes32 salt)
        public
        pure
    {
        assertTrue(
            Commitment.compute(roundId, judge, Commitment.HUMAN, partnerId, salt)
                != Commitment.compute(roundId, judge, Commitment.BOT, partnerId, salt)
        );
    }
}
