pragma solidity ^0.7.6;

interface ITickOracle {
    /**
     * @notice Get the current tick in the Uni V3 pool according to our oracle
     * @param pool the address of our uni v3 pool
     * @return the current tick
     */
    function getTick(address pool) external view returns (int24);
}
