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
  - only supports locking orders that have 1 offer item and 1 consideration item
- ZoneAggregator
  - allows the user to require validation from multiple zones
  - e.g. restrict to addresses and use a time lock
