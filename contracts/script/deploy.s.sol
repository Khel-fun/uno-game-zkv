// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/UnoGame.sol";

/**
 * @title DeployAll
 * @notice Deploy all verifiers + UnoGame
 * @dev Verifiers must be deployed individually with forge create first, since
 *      each verifier file contains identical library names (FrLib, Honk, etc.)
 *      and cannot be imported together.
 *
 * Deployment steps:
 *   1. Deploy each verifier separately:
 *      forge create --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
 *        src/verifiers/shuffle_circuitVerifier.sol:ShuffleVerifier
 *      forge create --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
 *        src/verifiers/deal_circuitVerifier.sol:DealVerifier
 *      forge create --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
 *        src/verifiers/draw_circuitVerifier.sol:DrawVerifier
 *      forge create --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
 *        src/verifiers/play_circuitVerifier.sol:PlayVerifier
 *
 *   2. Update the constants below with deployed addresses
 *
 *   3. Deploy UnoGame:
 *      forge script script/deploy.s.sol:DeployUnoGame --rpc-url $RPC_URL --broadcast
 */
contract DeployUnoGame is Script {
    // UPDATE THESE with addresses from forge create output
    address constant SHUFFLE_VERIFIER = address(0);
    address constant DEAL_VERIFIER = address(0);
    address constant DRAW_VERIFIER = address(0);
    address constant PLAY_VERIFIER = address(0);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        require(deployerPrivateKey != 0, "PRIVATE_KEY not set");
        require(SHUFFLE_VERIFIER != address(0), "Update verifier addresses first");

        vm.startBroadcast(deployerPrivateKey);

        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deploying with account:", deployer);

        console.log("\nVerifier addresses:");
        console.log("ShuffleVerifier:", SHUFFLE_VERIFIER);
        console.log("DealVerifier:   ", DEAL_VERIFIER);
        console.log("DrawVerifier:   ", DRAW_VERIFIER);
        console.log("PlayVerifier:   ", PLAY_VERIFIER);

        UnoGame unoGame = new UnoGame(
            SHUFFLE_VERIFIER,
            DEAL_VERIFIER,
            DRAW_VERIFIER,
            PLAY_VERIFIER
        );

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("DEPLOYMENT SUMMARY (bb 0.84.0 / Noir 1.0.0-beta.6)");
        console.log("========================================");
        console.log("ShuffleVerifier:", SHUFFLE_VERIFIER);
        console.log("DealVerifier:   ", DEAL_VERIFIER);
        console.log("DrawVerifier:   ", DRAW_VERIFIER);
        console.log("PlayVerifier:   ", PLAY_VERIFIER);
        console.log("UnoGame:        ", address(unoGame));
        console.log("Owner:          ", deployer);
        console.log("========================================");
    }
}

/**
 * @title DeployUnoGameWithMock
 * @notice Deploy UnoGame with MockVerifier (for testing)
 */
contract DeployUnoGameWithMock is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        require(deployerPrivateKey != 0, "PRIVATE_KEY not set");

        vm.startBroadcast(deployerPrivateKey);

        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deploying with account:", deployer);

        MockVerifier mockVerifier = new MockVerifier();
        console.log("MockVerifier:", address(mockVerifier));

        UnoGame unoGame = new UnoGame(
            address(mockVerifier),
            address(mockVerifier),
            address(mockVerifier),
            address(mockVerifier)
        );
        console.log("UnoGame:", address(unoGame));

        vm.stopBroadcast();
    }
}

/**
 * @title MockVerifier
 * @notice Simple mock verifier for testing
 */
contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
