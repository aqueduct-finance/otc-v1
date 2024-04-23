# Aqueduct V1 OTC

Contracts built on top of OpenSea's seaport protocol (version 1.5). They add extra features/restrictions to seaport orders.

Seaport docs: [https://docs.opensea.io/docs/seaport](https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md)

## Contracts
- RequireServerSignature
  - stores an owner address
  - for the order to be valid, fulfiller must pass in signature from the owner
- RestrictToAddresses
  - only allows an order to be filled by a set of addresses that the offerer designates
  - here, the offerer makes a call to the contract before order fulfillment to designate these addresses
- RestrictToAddressesBySignature
  - only allows an order to be filled by a set of addresses that the offerer designates
  - this contract does not require any interactions from the offerer before fulfillment
  - instead, the offerer computes the merkle tree of all addresses in the set, and stores the merkle root in their order
- TokenLockupPlansHandler
  - requires that the offer and/or consideration use a time lock
  - uses Hedgey's TokenLockupPlans contract
  - https://github.com/hedgey-finance/Locked_VestingTokenPlans/blob/master/contracts/LockupPlans/TokenLockupPlans.sol
  - only supports locking the first offer item and/or first consideration item
  - use case example:
     - The Uniswap Foundation wants to sell some UNI token to Bob, an investor. They also don't want Bob to be able to immediately sell his new UNI tokens elsewhere. The foundation creates a trade to sell 100 UNI for 1000 USDC on OpenSea's seaport protocol, and they specify this contract's address as the `zone`. To define Bob's vesting schedule, they will create a `LockParams` struct, with values for `offerLockupParams`, but leave `considerationLockupParams` empty. To be sure that seaport enforces these parameters, they encode this struct, take its hash, and supply that value as the `zoneHash` in their seaport order. The foundation signs the order and shares it with Bob offchain. When Bob goes to fill the order on seaport, he will provide the `LockParams` struct as the `extraData` param. Before making the trade, Bob will also need to approve TokenLockupPlansHandler to spend his UNI token (if he doesn't, the trade will just fail). When Bob is ready to make the trade, he will call the `fulfillAdvancedOrder` function on the seaport contract. In this transaction: first, seaport will send the foundation's UNI token to Bob and send Bob's USDC to the foundation; second, TokenLockupPlansHandler will retrieve the UNI token back from Bob (based on the amount that seaport settled) and deposit it into Hedgey's TokenLockupPlans contract, per the params defined in the `LockParams` struct.
     - TokenLockupPlansHandler is designed to inherit both the security and functionality of seaport. E.g. if Bob chose to partially fill his order, seaport will pass that fill `amount` to TokenLockupPlansHandler, and it will still be able to vest the correct amount
- ZoneAggregator
  - allows the user to require validation from multiple zones
  - e.g. restrict to addresses and use a time lock
