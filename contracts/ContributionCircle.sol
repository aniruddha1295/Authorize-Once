// SPDX-License-Identifier: MIT
pragma solidity >=0.8.20;

// ---------------------------------------------------------------------------
// ContributionCircle.sol
//
// RTD-P9 — "Authorize Once, Then Stop Asking"
//
// This is the committed TARGET of the savings circle. It is never deployed by
// this repository and is never interacted with by an automated wallet hand; it
// exists so the committed policy (policies/contribution-policy.ts) can pin the
// exact `to` address a contribution may be sent to, and so the on-chain record
// is unambiguous (one covered period per member).
//
// The backend's weekly contribution is a plain native-ETH call to
// `contribute()`. The Privy Wallet API policy restricts:
//   - method:        eth_sendTransaction ONLY
//   - destination:   this contract's address (contract allowlist, P9-2)
//   - value:         <= the committed weekly cap (value ceiling, P9-3)
// ---------------------------------------------------------------------------

contract ContributionCircle {
    uint256 public constant WEEK = 7 days;

    /// @notice stored wei contributed per member per weekly period key.
    mapping(address => mapping(uint256 => uint256)) public contributions;

    /// @notice The packed weekly period key of a UNIX timestamp.
    function weeklyPeriod(uint256 timestamp) public pure returns (uint256) {
        return timestamp / WEEK;
    }

    /// @notice Forward a contribution for the current period.
    function contribute() external payable {
        require(msg.value > 0, "ContributionCircle: zero contribution");
        contributions[msg.sender][weeklyPeriod(block.timestamp)] += msg.value;
    }

    /// @notice How much `member` has contributed in `period`.
    function balanceOf(address member, uint256 period) external view returns (uint256) {
        return contributions[member][period];
    }
}