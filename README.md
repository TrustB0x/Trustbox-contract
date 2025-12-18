# TrustBox

A secure escrow smart contract for Stacks blockchain built with Clarity. Lock STX between two parties and release only when both approve, or refund if cancelled.

## What It Does

TrustBox allows you to:
- Lock STX funds between two parties (buyer and seller)
- Require both parties to approve before release
- Refund if either party cancels
- Track escrow status in real-time
- Create trustless peer-to-peer transactions

Perfect for:
- Freelance payments
- P2P marketplace transactions
- Service agreements
- Learning multi-party contract logic
- Understanding escrow mechanics

## Features

- **Dual Approval**: Both parties must approve before funds release
- **Cancellation Protection**: Either party can cancel and trigger refund
- **Transparent**: All escrow states are on-chain
- **No Middleman**: Smart contract handles everything
- **Gas Efficient**: Optimized for minimal costs
- **Secure**: Funds locked until conditions met

## Prerequisites

- [Clarinet](https://github.com/hirosystems/clarinet) installed
- Basic understanding of Stacks blockchain
- A Stacks wallet for testnet deployment

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/trustbox.git
cd trustbox

# Check Clarinet installation
clarinet --version
```

## Project Structure

```
trustbox/
├── contracts/
│   └── trustbox.clar        # Main escrow contract
├── tests/
│   └── trustbox_test.ts     # Contract tests
├── Clarinet.toml            # Project configuration
└── README.md
```

## Usage

### Deploy Locally

```bash
# Start Clarinet console
clarinet console

# Create an escrow
(contract-call? .trustbox create-escrow 
  'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC  ;; seller address
  u1000000                                      ;; amount (1 STX = 1,000,000 micro-STX)
)

# Approve release (as buyer)
(contract-call? .trustbox approve-release u0)

# Approve release (as seller)
(contract-call? .trustbox approve-release u0)

# Cancel escrow (if needed)
(contract-call? .trustbox cancel-escrow u0)
```

### Contract Functions

**create-escrow (seller, amount)**
```clarity
(contract-call? .trustbox create-escrow 
  'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC
  u5000000
)
```
Creates escrow, locks STX, returns escrow ID

**approve-release (escrow-id)**
```clarity
(contract-call? .trustbox approve-release u0)
```
Approve release (both parties must call this)

**cancel-escrow (escrow-id)**
```clarity
(contract-call? .trustbox cancel-escrow u0)
```
Cancel and refund (either party can call)

**get-escrow-info (escrow-id)**
```clarity
(contract-call? .trustbox get-escrow-info u0)
```
Returns escrow details and status

**get-escrow-status (escrow-id)**
```clarity
(contract-call? .trustbox get-escrow-status u0)
```
Returns current status: pending, approved, completed, or cancelled

## How It Works

### Creating an Escrow
1. Buyer calls `create-escrow` with seller address and amount
2. STX is transferred from buyer to contract
3. Escrow ID is generated and returned
4. Status set to "pending"

### Releasing Funds (Happy Path)
1. Buyer calls `approve-release` 
2. Seller calls `approve-release`
3. When both approve, funds automatically transfer to seller
4. Status changes to "completed"

### Cancelling (Refund Path)
1. Either party calls `cancel-escrow`
2. Funds automatically return to buyer
3. Status changes to "cancelled"
4. Cannot be undone

## Escrow States

```
PENDING → Both approve → COMPLETED (funds to seller)
   ↓
   Either cancels → CANCELLED (refund to buyer)
```

## Testing

```bash
# Run all tests
npm run test

# Check contract syntax
clarinet check

# Run specific test
npm run test -- trustbox
```

## Learning Goals

Building this contract teaches you:
- ✅ Multi-party authorization logic
- ✅ STX token transfers (user → contract → user)
- ✅ State management (pending/approved/completed/cancelled)
- ✅ Using `as-contract` for contract-initiated transfers
- ✅ Access control patterns
- ✅ Refund mechanisms

## Example Use Cases

**Freelance Payment:**
```clarity
;; Client creates escrow for developer
(contract-call? .trustbox create-escrow 
  'ST1DEVELOPER_ADDRESS
  u10000000  ;; 10 STX for completed work
)
;; Developer delivers work and both approve
```

**Marketplace Sale:**
```clarity
;; Buyer locks payment for item
(contract-call? .trustbox create-escrow 
  'ST1SELLER_ADDRESS
  u2500000  ;; 2.5 STX for item
)
;; Seller ships, buyer receives, both approve
```

**Service Agreement:**
```clarity
;; Client locks funds for service
(contract-call? .trustbox create-escrow 
  'ST1SERVICE_PROVIDER
  u15000000  ;; 15 STX for service
)
;; Service completed, both parties approve release
```

## Security Features

- ✅ Funds locked in contract until release conditions met
- ✅ Both parties must explicitly approve
- ✅ Either party can trigger refund
- ✅ Cannot approve your own escrow alone
- ✅ Cannot withdraw without both approvals
- ✅ No admin override or backdoors

## Common Scenarios

### Scenario 1: Successful Transaction
```
1. Buyer creates escrow (STX locked)
2. Seller delivers goods/service
3. Buyer approves release
4. Seller approves release
5. STX automatically sent to seller
```

### Scenario 2: Disputed Transaction
```
1. Buyer creates escrow (STX locked)
2. Seller fails to deliver
3. Buyer cancels escrow
4. STX automatically refunded to buyer
```

### Scenario 3: Mutual Cancellation
```
1. Buyer creates escrow (STX locked)
2. Both parties decide to cancel
3. Either party calls cancel
4. STX automatically refunded to buyer
```

## Deployment

### Testnet
```bash
clarinet deployments generate --testnet --low-cost
clarinet deployments apply -p deployments/default.testnet-plan.yaml
```

### Mainnet
```bash
clarinet deployments generate --mainnet
clarinet deployments apply -p deployments/default.mainnet-plan.yaml
```

## Roadmap

- [ ] Write the core contract
- [ ] Add comprehensive tests
- [ ] Deploy to testnet
- [ ] Add escrow timeout/expiration
- [ ] Support partial releases
- [ ] Add dispute resolution mechanism
- [ ] Support SIP-010 tokens (not just STX)
- [ ] Add escrow metadata/notes

## Important Notes

⚠️ **Security Considerations:**
- Always verify seller address before creating escrow
- Double-check amount (remember: 1 STX = 1,000,000 micro-STX)
- Once cancelled, cannot be reversed
- Both parties should agree on terms off-chain first

💡 **Best Practices:**
- Use escrow for significant transactions
- Communicate clearly with counterparty
- Keep escrow IDs safe for reference
- Test on testnet before mainnet use

## Contributing

This is a learning project! Feel free to:
- Open issues for questions
- Submit PRs for improvements
- Fork and experiment
- Share your use cases

## License

MIT License - do whatever you want with it

## Resources

- [Clarity Language Reference](https://docs.stacks.co/clarity)
- [Clarinet Documentation](https://github.com/hirosystems/clarinet)
- [Stacks Blockchain](https://www.stacks.co/)
- [Escrow Contract Patterns](https://book.clarity-lang.org/)

---

Built while learning Clarity 🤝
