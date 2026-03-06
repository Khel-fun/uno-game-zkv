// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/UnoGame.sol";
import "../src/interfaces/IUltraVerifier.sol";

/**
 * @title MockVerifier
 * @notice Mock verifier for testing - always returns true or configurable response
 */
contract MockVerifier is IUltraVerifier {
    bool public shouldPass = true;

    function setVerificationResult(bool _shouldPass) external {
        shouldPass = _shouldPass;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }
}

/**
 * @title UnoGameTest
 * @notice Comprehensive test suite for UnoGame contract with onlyOwner access control
 * @dev All state-changing functions require onlyOwner (backend is the owner)
 */
contract UnoGameTest is Test {
    UnoGame public unoGame;
    MockVerifier public mockShuffleVerifier;
    MockVerifier public mockDealVerifier;
    MockVerifier public mockDrawVerifier;
    MockVerifier public mockPlayVerifier;

    address public deployer;
    address public player1;
    address public player2;
    address public player3;
    address public player4;
    address public player5;

    string constant GAME_CODE = "A3K9F2B7";
    bytes32 constant GAME_CODE_HASH = keccak256(abi.encodePacked(GAME_CODE));

    event GameCreated(uint256 indexed gameId, address indexed creator, bool isPrivate);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event GameStarted(uint256 indexed gameId, bytes32 deckCommitment);
    event MoveCommitted(uint256 indexed gameId, address indexed player, bytes32 moveHash);
    event ProofVerified(uint256 indexed gameId, address indexed player, UnoGame.CircuitType circuitType);
    event GameEnded(uint256 indexed gameId, address indexed winner);
    event GameDeleted(uint256 indexed gameId, address indexed creator);

    function setUp() public {
        deployer = makeAddr("deployer");

        // Deploy mock verifiers
        mockShuffleVerifier = new MockVerifier();
        mockDealVerifier = new MockVerifier();
        mockDrawVerifier = new MockVerifier();
        mockPlayVerifier = new MockVerifier();

        // Deploy UnoGame as deployer (owner)
        vm.prank(deployer);
        unoGame = new UnoGame(
            address(mockShuffleVerifier),
            address(mockDealVerifier),
            address(mockDrawVerifier),
            address(mockPlayVerifier)
        );

        // Setup test players
        player1 = makeAddr("player1");
        player2 = makeAddr("player2");
        player3 = makeAddr("player3");
        player4 = makeAddr("player4");
        player5 = makeAddr("player5");
    }

    // ========================================
    // Helper: all state-changing calls from deployer
    // ========================================

    function _createPublicGame(address creator, uint256 maxPlayers) internal returns (uint256) {
        vm.prank(deployer);
        return unoGame.createGame(creator, false, false, bytes32(0), maxPlayers);
    }

    function _createPrivateGame(address creator, uint256 maxPlayers) internal returns (uint256) {
        vm.prank(deployer);
        return unoGame.createGame(creator, false, true, GAME_CODE_HASH, maxPlayers);
    }

    function _createBotGame(address creator) internal returns (uint256) {
        vm.prank(deployer);
        return unoGame.createGame(creator, true, false, bytes32(0), 2);
    }

    function _joinGame(uint256 gameId, address joinee) internal {
        vm.prank(deployer);
        unoGame.joinGame(gameId, joinee);
    }

    function _joinGameWithCode(uint256 gameId, address joinee, string memory code) internal {
        vm.prank(deployer);
        unoGame.joinGameWithCode(gameId, joinee, code);
    }

    function _startGame(uint256 gameId) internal {
        vm.prank(deployer);
        unoGame.startGame(gameId);
    }

    function _startGameWithProof(uint256 gameId, bytes32 deck, bytes memory proof, bytes32[] memory inputs) internal {
        vm.prank(deployer);
        unoGame.startGame(gameId, deck, proof, inputs);
    }

    function _commitMove(uint256 gameId, bytes32 moveHash) internal {
        vm.prank(deployer);
        unoGame.commitMove(gameId, moveHash);
    }

    function _commitMoveWithProof(uint256 gameId, address player, bytes32 moveHash, bytes memory proof, bytes32[] memory inputs, UnoGame.CircuitType ct) internal {
        vm.prank(deployer);
        unoGame.commitMove(gameId, player, moveHash, proof, inputs, ct);
    }

    function _endGame(uint256 gameId, bytes32 gameHash) internal {
        vm.prank(deployer);
        unoGame.endGame(gameId, gameHash);
    }

    function _deleteGame(uint256 gameId) internal {
        vm.prank(deployer);
        unoGame.deleteGame(gameId);
    }

    // ========================================
    // CONSTRUCTOR TESTS
    // ========================================

    function test_ConstructorSetsVerifiers() public view {
        assertEq(address(unoGame.shuffleVerifier()), address(mockShuffleVerifier));
        assertEq(address(unoGame.dealVerifier()), address(mockDealVerifier));
        assertEq(address(unoGame.drawVerifier()), address(mockDrawVerifier));
        assertEq(address(unoGame.playVerifier()), address(mockPlayVerifier));
    }

    function test_ConstructorSetsOwner() public view {
        assertEq(unoGame.owner(), deployer);
    }

    function test_RevertWhenZeroAddressVerifier() public {
        vm.expectRevert(UnoGame.InvalidVerifierAddress.selector);
        new UnoGame(address(0), address(mockDealVerifier), address(mockDrawVerifier), address(mockPlayVerifier));
    }

    function test_MaxPlayersConstant() public view {
        assertEq(unoGame.MAX_PLAYERS(), 4);
    }

    // ========================================
    // ONLY OWNER ACCESS CONTROL TESTS
    // ========================================

    function test_RevertCreateGameNotOwner() public {
        vm.prank(player1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player1));
        unoGame.createGame(player1, false, false, bytes32(0), 4);
    }

    function test_RevertJoinGameNotOwner() public {
        uint256 gameId = _createPublicGame(player1, 4);

        vm.prank(player2);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player2));
        unoGame.joinGame(gameId, player2);
    }

    function test_RevertStartGameNotOwner() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);

        vm.prank(player1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player1));
        unoGame.startGame(gameId);
    }

    function test_RevertCommitMoveNotOwner() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        vm.prank(player1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player1));
        unoGame.commitMove(gameId, keccak256("move"));
    }

    function test_RevertEndGameNotOwner() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        vm.prank(player1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player1));
        unoGame.endGame(gameId, keccak256("final"));
    }

    function test_RevertDeleteGameNotOwner() public {
        uint256 gameId = _createPublicGame(player1, 4);

        vm.prank(player1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player1));
        unoGame.deleteGame(gameId);
    }

    // ========================================
    // CREATE GAME TESTS - PUBLIC
    // ========================================

    function test_CreatePublicGame() public {
        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit GameCreated(1, player1, false);
        uint256 gameId = unoGame.createGame(player1, false, false, bytes32(0), 4);

        assertEq(gameId, 1);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.id, gameId);
        assertEq(game.creator, player1);
        assertEq(game.players.length, 1);
        assertEq(game.players[0], player1);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.NotStarted));
        assertFalse(game.isPrivate);
        assertEq(game.gameCodeHash, bytes32(0));
        assertEq(game.maxPlayers, 4);
        assertGt(game.startTime, 0);
    }

    function test_CreatePublicGame_BackwardCompat() public {
        vm.prank(deployer);
        uint256 gameId = unoGame.createGame(player1, false);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.creator, player1);
        assertFalse(game.isPrivate);
        assertEq(game.maxPlayers, 4);
    }

    function test_CreateGameWith2Players() public {
        uint256 gameId = _createPublicGame(player1, 2);
        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.maxPlayers, 2);
    }

    function test_CreateGameWith3Players() public {
        uint256 gameId = _createPublicGame(player1, 3);
        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.maxPlayers, 3);
    }

    function test_RevertCreateGameInvalidMaxPlayers_TooLow() public {
        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidMaxPlayers.selector);
        unoGame.createGame(player1, false, false, bytes32(0), 1);
    }

    function test_RevertCreateGameInvalidMaxPlayers_TooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidMaxPlayers.selector);
        unoGame.createGame(player1, false, false, bytes32(0), 5);
    }

    function test_CreateBotGame() public {
        uint256 gameId = _createBotGame(player1);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.players.length, 2);
        assertEq(game.players[0], player1);
        assertEq(game.players[1], address(0xB07));
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Started));
    }

    function test_CreateMultipleGames() public {
        vm.startPrank(deployer);
        uint256 gameId1 = unoGame.createGame(player1, false, false, bytes32(0), 4);
        uint256 gameId2 = unoGame.createGame(player1, false, false, bytes32(0), 3);
        vm.stopPrank();

        assertEq(gameId1, 1);
        assertEq(gameId2, 2);
    }

    // ========================================
    // CREATE GAME TESTS - PRIVATE
    // ========================================

    function test_CreatePrivateGame() public {
        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit GameCreated(1, player1, true);
        uint256 gameId = unoGame.createGame(player1, false, true, GAME_CODE_HASH, 3);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.creator, player1);
        assertTrue(game.isPrivate);
        assertEq(game.gameCodeHash, GAME_CODE_HASH);
        assertEq(game.maxPlayers, 3);
    }

    function test_IsGamePrivate() public {
        uint256 publicId = _createPublicGame(player1, 4);
        uint256 privateId = _createPrivateGame(player1, 3);

        assertFalse(unoGame.isGamePrivate(publicId));
        assertTrue(unoGame.isGamePrivate(privateId));
    }

    function test_RevertIsGamePrivateInvalidId() public {
        vm.expectRevert(UnoGame.InvalidGameId.selector);
        unoGame.isGamePrivate(999);
    }

    // ========================================
    // JOIN GAME TESTS - PUBLIC
    // ========================================

    function test_JoinPublicGame() public {
        uint256 gameId = _createPublicGame(player1, 4);

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit PlayerJoined(gameId, player2);
        unoGame.joinGame(gameId, player2);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.players.length, 2);
        assertEq(game.players[1], player2);
    }

    function test_JoinPublicGame_4Players() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _joinGame(gameId, player3);
        _joinGame(gameId, player4);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.players.length, 4);
    }

    function test_RevertJoinAlreadyJoined() public {
        uint256 gameId = _createPublicGame(player1, 4);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.AlreadyJoined.selector);
        unoGame.joinGame(gameId, player1);
    }

    function test_RevertJoinGameFull_2Players() public {
        uint256 gameId = _createPublicGame(player1, 2);
        _joinGame(gameId, player2);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.GameFull.selector);
        unoGame.joinGame(gameId, player3);
    }

    function test_RevertJoinGameFull_3Players() public {
        uint256 gameId = _createPublicGame(player1, 3);
        _joinGame(gameId, player2);
        _joinGame(gameId, player3);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.GameFull.selector);
        unoGame.joinGame(gameId, player4);
    }

    function test_RevertJoinGameFull_4Players() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _joinGame(gameId, player3);
        _joinGame(gameId, player4);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.GameFull.selector);
        unoGame.joinGame(gameId, player5);
    }

    function test_RevertJoinInvalidGame() public {
        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameId.selector);
        unoGame.joinGame(999, player1);
    }

    function test_RevertJoinStartedGame() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameStatus.selector);
        unoGame.joinGame(gameId, player3);
    }

    function test_RevertJoinPrivateGameWithoutCode() public {
        uint256 gameId = _createPrivateGame(player1, 3);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameCode.selector);
        unoGame.joinGame(gameId, player2);
    }

    // ========================================
    // JOIN GAME TESTS - PRIVATE (WITH CODE)
    // ========================================

    function test_JoinPrivateGameWithCorrectCode() public {
        uint256 gameId = _createPrivateGame(player1, 3);

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit PlayerJoined(gameId, player2);
        unoGame.joinGameWithCode(gameId, player2, GAME_CODE);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.players.length, 2);
        assertEq(game.players[1], player2);
    }

    function test_RevertJoinPrivateGameWithWrongCode() public {
        uint256 gameId = _createPrivateGame(player1, 3);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameCode.selector);
        unoGame.joinGameWithCode(gameId, player2, "WRONGCODE");
    }

    function test_JoinPublicGameWithCode() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGameWithCode(gameId, player2, "anything");

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.players.length, 2);
    }

    function test_RevertJoinPrivateGameAlreadyJoined() public {
        uint256 gameId = _createPrivateGame(player1, 3);
        _joinGameWithCode(gameId, player2, GAME_CODE);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.AlreadyJoined.selector);
        unoGame.joinGameWithCode(gameId, player2, GAME_CODE);
    }

    function test_RevertJoinPrivateGameFull() public {
        uint256 gameId = _createPrivateGame(player1, 3);
        _joinGameWithCode(gameId, player2, GAME_CODE);
        _joinGameWithCode(gameId, player3, GAME_CODE);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.GameFull.selector);
        unoGame.joinGameWithCode(gameId, player4, GAME_CODE);
    }

    // ========================================
    // DELETE GAME TESTS
    // ========================================

    function test_DeleteGame() public {
        uint256 gameId = _createPublicGame(player1, 4);

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit GameDeleted(gameId, player1);
        unoGame.deleteGame(gameId);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Ended));
        assertGt(game.endTime, 0);
    }

    function test_DeleteRemovesFromActiveGames() public {
        uint256 gameId = _createPublicGame(player1, 4);

        uint256[] memory activeBefore = unoGame.getActiveGames();
        assertEq(activeBefore.length, 1);

        _deleteGame(gameId);

        uint256[] memory activeAfter = unoGame.getActiveGames();
        assertEq(activeAfter.length, 0);
    }

    function test_RevertDeleteStartedGame() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameStatus.selector);
        unoGame.deleteGame(gameId);
    }

    function test_RevertDeleteInvalidGame() public {
        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameId.selector);
        unoGame.deleteGame(999);
    }

    function test_DeletePrivateGame() public {
        uint256 gameId = _createPrivateGame(player1, 3);
        _deleteGame(gameId);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Ended));
    }

    function test_CannotJoinDeletedGame() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _deleteGame(gameId);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidGameStatus.selector);
        unoGame.joinGame(gameId, player2);
    }

    // ========================================
    // START GAME TESTS
    // ========================================

    function test_StartGameSimple() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);

        vm.prank(deployer);
        vm.expectEmit(true, false, false, true);
        emit GameStarted(gameId, bytes32(0));
        unoGame.startGame(gameId);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Started));
    }

    function test_StartGameWithShuffleProof() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);

        bytes32 deckCommitment = keccak256("deck_merkle_root");
        bytes memory shuffleProof = hex"1234";
        bytes32[] memory publicInputs = new bytes32[](0);

        vm.prank(deployer);
        vm.expectEmit(true, false, false, true);
        emit GameStarted(gameId, deckCommitment);
        unoGame.startGame(gameId, deckCommitment, shuffleProof, publicInputs);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Started));
        assertEq(game.deckCommitment, deckCommitment);
    }

    function test_StartPrivateGame() public {
        uint256 gameId = _createPrivateGame(player1, 3);
        _joinGameWithCode(gameId, player2, GAME_CODE);
        _startGame(gameId);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Started));
    }

    function test_RevertStartGameNotEnoughPlayers() public {
        uint256 gameId = _createPublicGame(player1, 4);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.NotEnoughPlayers.selector);
        unoGame.startGame(gameId);
    }

    function test_RevertStartGameInvalidProof() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);

        mockShuffleVerifier.setVerificationResult(false);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidProof.selector);
        unoGame.startGame(gameId, keccak256("deck"), hex"1234", new bytes32[](0));
    }

    // ========================================
    // COMMIT MOVE TESTS
    // ========================================

    function test_CommitMoveSimple() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        bytes32 moveHash = keccak256("move1");

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit MoveCommitted(gameId, deployer, moveHash);
        unoGame.commitMove(gameId, moveHash);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(game.moveCommitments.length, 1);
        assertEq(game.moveCommitments[0], moveHash);
    }

    function test_CommitMoveWithZKProof() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        bytes32 moveHash = keccak256("move1");
        bytes memory proof = hex"abcd";
        bytes32[] memory publicInputs = new bytes32[](1);
        publicInputs[0] = bytes32(uint256(1));

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit ProofVerified(gameId, player1, UnoGame.CircuitType.Play);
        unoGame.commitMove(gameId, player1, moveHash, proof, publicInputs, UnoGame.CircuitType.Play);

        UnoGame.MoveProof[] memory proofs = unoGame.getGameProofs(gameId);
        assertEq(proofs.length, 1);
        assertEq(proofs[0].commitment, moveHash);
        assertEq(proofs[0].player, player1);
        assertTrue(proofs[0].verified);
    }

    function test_CommitMoveWithDealProof() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        bytes32 moveHash = keccak256("deal");
        bytes memory proof = hex"abcd";
        bytes32[] memory publicInputs = new bytes32[](0);

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit ProofVerified(gameId, player1, UnoGame.CircuitType.Deal);
        unoGame.commitMove(gameId, player1, moveHash, proof, publicInputs, UnoGame.CircuitType.Deal);
    }

    function test_CommitMoveWithDrawProof() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        bytes32 moveHash = keccak256("draw");
        bytes memory proof = hex"abcd";
        bytes32[] memory publicInputs = new bytes32[](0);

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit ProofVerified(gameId, player1, UnoGame.CircuitType.Draw);
        unoGame.commitMove(gameId, player1, moveHash, proof, publicInputs, UnoGame.CircuitType.Draw);
    }

    function test_RevertCommitMoveNotPlayer() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.PlayerNotInGame.selector);
        unoGame.commitMove(gameId, player3, keccak256("move"), hex"abcd", new bytes32[](0), UnoGame.CircuitType.Play);
    }

    function test_RevertCommitMoveInvalidProof() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        mockPlayVerifier.setVerificationResult(false);

        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidProof.selector);
        unoGame.commitMove(gameId, player1, keccak256("move"), hex"abcd", new bytes32[](0), UnoGame.CircuitType.Play);
    }

    // ========================================
    // END GAME TESTS
    // ========================================

    function test_EndGame() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        bytes32 gameHash = keccak256("final_state");

        vm.prank(deployer);
        vm.expectEmit(true, true, false, true);
        emit GameEnded(gameId, deployer);
        unoGame.endGame(gameId, gameHash);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Ended));
        assertGt(game.endTime, 0);
    }

    function test_EndGameRemovesFromActiveGames() public {
        uint256 gameId = _createPublicGame(player1, 4);
        _joinGame(gameId, player2);
        _startGame(gameId);

        uint256[] memory activeBefore = unoGame.getActiveGames();
        assertEq(activeBefore.length, 1);

        _endGame(gameId, keccak256("final"));

        uint256[] memory activeAfter = unoGame.getActiveGames();
        assertEq(activeAfter.length, 0);
    }

    // ========================================
    // VIEW FUNCTION TESTS
    // ========================================

    function test_GetActiveGames() public {
        uint256 gameId1 = _createPublicGame(player1, 4);
        uint256 gameId2 = _createPublicGame(player1, 3);

        uint256[] memory activeGames = unoGame.getActiveGames();
        assertEq(activeGames.length, 2);
        assertEq(activeGames[0], gameId1);
        assertEq(activeGames[1], gameId2);
    }

    function test_GetNotStartedGames() public {
        uint256 gameId1 = _createPublicGame(player1, 4);
        uint256 gameId2 = _createPublicGame(player1, 4);
        _joinGame(gameId2, player2);
        _startGame(gameId2);

        uint256[] memory notStarted = unoGame.getNotStartedGames();
        assertEq(notStarted.length, 1);
        assertEq(notStarted[0], gameId1);
    }

    function test_GetPublicNotStartedGames() public {
        uint256 publicId = _createPublicGame(player1, 4);
        _createPrivateGame(player1, 3);

        uint256[] memory publicGames = unoGame.getPublicNotStartedGames();
        assertEq(publicGames.length, 1);
        assertEq(publicGames[0], publicId);
    }

    function test_GetPublicNotStartedGames_ExcludesStarted() public {
        uint256 gameId1 = _createPublicGame(player1, 4);
        uint256 gameId2 = _createPublicGame(player1, 4);
        _joinGame(gameId2, player2);
        _startGame(gameId2);

        uint256[] memory publicGames = unoGame.getPublicNotStartedGames();
        assertEq(publicGames.length, 1);
        assertEq(publicGames[0], gameId1);
    }

    function test_GetGamesByCreator() public {
        uint256 gameId1 = _createPublicGame(player1, 4);
        _createPublicGame(player2, 4);
        uint256 gameId3 = _createPrivateGame(player1, 3);

        uint256[] memory player1Games = unoGame.getGamesByCreator(player1);
        assertEq(player1Games.length, 2);
        assertEq(player1Games[0], gameId1);
        assertEq(player1Games[1], gameId3);

        uint256[] memory player2Games = unoGame.getGamesByCreator(player2);
        assertEq(player2Games.length, 1);
    }

    function test_GetGameCount() public {
        assertEq(unoGame.getGameCount(), 0);

        _createPublicGame(player1, 4);
        assertEq(unoGame.getGameCount(), 1);

        _createPublicGame(player2, 3);
        assertEq(unoGame.getGameCount(), 2);
    }

    function test_GetGameReturnsGameView() public {
        uint256 gameId = _createPrivateGame(player1, 3);
        _joinGameWithCode(gameId, player2, GAME_CODE);

        UnoGame.GameView memory game = unoGame.getGame(gameId);

        assertEq(game.id, gameId);
        assertEq(game.creator, player1);
        assertEq(game.players.length, 2);
        assertTrue(game.isPrivate);
        assertEq(game.gameCodeHash, GAME_CODE_HASH);
        assertEq(game.maxPlayers, 3);
    }

    // ========================================
    // UPDATE VERIFIERS TESTS (OWNER ONLY)
    // ========================================

    function test_UpdateVerifiers() public {
        MockVerifier newShuffleVerifier = new MockVerifier();
        MockVerifier newDealVerifier = new MockVerifier();
        MockVerifier newDrawVerifier = new MockVerifier();
        MockVerifier newPlayVerifier = new MockVerifier();

        vm.prank(deployer);
        unoGame.updateVerifiers(
            address(newShuffleVerifier),
            address(newDealVerifier),
            address(newDrawVerifier),
            address(newPlayVerifier)
        );

        assertEq(address(unoGame.shuffleVerifier()), address(newShuffleVerifier));
        assertEq(address(unoGame.dealVerifier()), address(newDealVerifier));
        assertEq(address(unoGame.drawVerifier()), address(newDrawVerifier));
        assertEq(address(unoGame.playVerifier()), address(newPlayVerifier));
    }

    function test_RevertUpdateVerifiersNotOwner() public {
        vm.prank(player1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player1));
        unoGame.updateVerifiers(
            address(mockShuffleVerifier),
            address(mockDealVerifier),
            address(mockDrawVerifier),
            address(mockPlayVerifier)
        );
    }

    function test_RevertUpdateVerifiersZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(UnoGame.InvalidVerifierAddress.selector);
        unoGame.updateVerifiers(
            address(0),
            address(mockDealVerifier),
            address(mockDrawVerifier),
            address(mockPlayVerifier)
        );
    }

    // ========================================
    // INTEGRATION TESTS
    // ========================================

    function test_FullPublicGameFlow_4Players() public {
        // Create public game with 4 max players
        uint256 gameId = _createPublicGame(player1, 4);

        // Players join
        _joinGame(gameId, player2);
        _joinGame(gameId, player3);
        _joinGame(gameId, player4);

        // Start with shuffle proof
        bytes32 deckCommitment = keccak256("shuffled_deck");
        _startGameWithProof(gameId, deckCommitment, hex"", new bytes32[](0));

        // Deal cards (owner calls on behalf of players)
        _commitMoveWithProof(gameId, player1, keccak256("deal_p1"), hex"", new bytes32[](0), UnoGame.CircuitType.Deal);
        _commitMoveWithProof(gameId, player2, keccak256("deal_p2"), hex"", new bytes32[](0), UnoGame.CircuitType.Deal);
        _commitMoveWithProof(gameId, player3, keccak256("deal_p3"), hex"", new bytes32[](0), UnoGame.CircuitType.Deal);
        _commitMoveWithProof(gameId, player4, keccak256("deal_p4"), hex"", new bytes32[](0), UnoGame.CircuitType.Deal);

        // Play moves
        _commitMoveWithProof(gameId, player1, keccak256("play_1"), hex"", new bytes32[](0), UnoGame.CircuitType.Play);
        _commitMoveWithProof(gameId, player2, keccak256("draw_1"), hex"", new bytes32[](0), UnoGame.CircuitType.Draw);

        // End game
        _endGame(gameId, keccak256("final_state"));

        // Verify
        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Ended));

        UnoGame.MoveProof[] memory proofs = unoGame.getGameProofs(gameId);
        assertEq(proofs.length, 6);
    }

    function test_FullPrivateGameFlow() public {
        // Create private game with 3 max players
        uint256 gameId = _createPrivateGame(player1, 3);

        // Players join with code
        _joinGameWithCode(gameId, player2, GAME_CODE);
        _joinGameWithCode(gameId, player3, GAME_CODE);

        // Start game
        _startGame(gameId);

        // Play (simple commits)
        _commitMove(gameId, keccak256("move1"));
        _commitMove(gameId, keccak256("move2"));

        // End
        _endGame(gameId, keccak256("final"));

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Ended));
    }

    function test_MultipleConcurrentGames() public {
        // Create public + private games
        uint256 gameId1 = _createPublicGame(player1, 2);
        uint256 gameId2 = _createPrivateGame(player2, 3);

        // Join and start both
        _joinGame(gameId1, player2);
        _joinGameWithCode(gameId2, player1, GAME_CODE);

        _startGame(gameId1);
        _startGame(gameId2);

        // Play in both
        _commitMove(gameId1, keccak256("game1_move1"));
        _commitMove(gameId2, keccak256("game2_move1"));

        // End one
        _endGame(gameId1, keccak256("game1_final"));

        uint256[] memory active = unoGame.getActiveGames();
        assertEq(active.length, 1);
        assertEq(active[0], gameId2);
    }

    function test_DeleteAndRecreateFlow() public {
        uint256 gameId1 = _createPublicGame(player1, 4);
        _deleteGame(gameId1);

        uint256 gameId2 = _createPublicGame(player1, 3);
        assertEq(gameId2, 2);

        uint256[] memory active = unoGame.getActiveGames();
        assertEq(active.length, 1);
        assertEq(active[0], gameId2);
    }

    function test_2PlayerGameFlow() public {
        uint256 gameId = _createPublicGame(player1, 2);
        _joinGame(gameId, player2);

        // Can't add more
        vm.prank(deployer);
        vm.expectRevert(UnoGame.GameFull.selector);
        unoGame.joinGame(gameId, player3);

        // But can start with 2
        _startGame(gameId);

        UnoGame.GameView memory game = unoGame.getGame(gameId);
        assertEq(uint256(game.status), uint256(UnoGame.GameStatus.Started));
        assertEq(game.players.length, 2);
    }
}
