# Aqueduct V1 OTC

Contracts built on top of OpenSea's seaport protocol (version 1.5). They add extra features/restrictions to seaport orders.

Seaport docs: [https://docs.opensea.io/docs/seaport](https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md)

## Lockups / Vesting
### TokenLockupPlansHandler
  - requires that the offer and/or consideration use a time lock
  - uses Hedgey's TokenLockupPlans contract
  - https://github.com/hedgey-finance/Locked_VestingTokenPlans/blob/master/contracts/LockupPlans/TokenLockupPlans.sol
  - only supports locking the first offer item and/or first consideration item
  - use case example:
     - The Uniswap Foundation wants to sell some UNI token to Bob, an investor. They also don't want Bob to be able to immediately sell his new UNI tokens elsewhere. The foundation creates a trade to sell 100 UNI for 1000 USDC on OpenSea's seaport protocol, and they specify this contract's address as the `zone`. To define Bob's vesting schedule, they will create a `LockParams` struct, with values for `offerLockupParams`, but leave `considerationLockupParams` empty. To be sure that seaport enforces these parameters, they encode this struct, take its hash, and supply that value as the `zoneHash` in their seaport order. The foundation signs the order and shares it with Bob offchain. When Bob goes to fill the order on seaport, he will provide the `LockParams` struct as the `extraData` param. Before making the trade, Bob will also need to approve TokenLockupPlansHandler to spend his UNI token (if he doesn't, the trade will just fail). When Bob is ready to make the trade, he will call the `fulfillAdvancedOrder` function on the seaport contract. In this transaction: first, seaport will send the foundation's UNI token to Bob and send Bob's USDC to the foundation; second, TokenLockupPlansHandler will retrieve the UNI token back from Bob (based on the amount that seaport settled) and deposit it into Hedgey's TokenLockupPlans contract, per the params defined in the `LockParams` struct.
     - TokenLockupPlansHandler is designed to inherit both the security and functionality of seaport. E.g. if Bob chose to partially fill his order, seaport will pass that fill `amount` to TokenLockupPlansHandler, and it will still be able to vest the correct amount
- Dependencies / External Contract Interactions:
  - Seaport v1.5
    - https://github.com/ProjectOpenSea/seaport
    - all calls to TokenLockupPlansHandler must originate from seaport
    - for security reasons, TokenLockupPlansHandler is called post-settlement by seaport (after each user has already swapped their assets, and all checks within seaport have been met)
    - for docs on seaport order creation and fulfillment, see: https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md#order
    - TokenLockupPlansHandler supports all types of order fulfillment by accessing the `amount` param on the first offer/consideration item (e.g. `zoneParameters.offer[0].amount`)
      - for example, if permitted, the user can do a partial fill by setting the `numerator` and `denominator` params when fulfilling through seaport, and TokenLockupPlansHandler will still lock the correct amount
  - TokenLockupPlans
    - https://github.com/hedgey-finance/Locked_VestingTokenPlans/blob/master/contracts/LockupPlans/TokenLockupPlans.sol
    - TokenLockupPlansHandler will lock the first offer and/or consdideration item, based on the `LockParams` struct (encoded in `extraData` included during fulfillment on seaport)
    - to secure the `LockParams` struct, the offerer hashes it and passes that value as the `zoneHash` at order creation, and signs the order 
    - the `LockParams` encoded in `extraData` that are passed to TokenLockupPlansHandler almost map directly to the params passed to `TokenLockupPlans.createPlan()`, with some small changes:
      - `recipient` is derived from `zoneParameters.offerer`/`zoneParameters.fulfiller` respectively, depending on which side(s) are being locked
      - `token` is derived from `offer.token`/`consideration.token` respectively, depending on which side(s) are being locked (first offer/consideration item)
      - `amount` is derived from `offer.amount`/`consideration.amount` respectively, depending on which side(s) are being locked (first offer/consideration item)
      - `start` and `period` are passed directly from the `CreatePlanParams` struct
      - `cliff` is calculated as `createPlanParams.start + createPlanParams.cliffOffsetTime`
      - `rate` is calculated as `(amount * createPlanParams.period) / createPlanParams.endOffsetTime`
        - this is necessary because `amount` is dynamic (e.g. when the counterparty does a partial fill), and `rate` is dependent on `amount`

## Access Control / Permissions
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
- ZoneAggregator
  - allows the user to require validation from multiple zones
  - e.g. restrict to addresses and use a time lock
