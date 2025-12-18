import { Cl } from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const buyer = accounts.get("wallet_1")!;
const seller = accounts.get("wallet_2")!;
const randomUser = accounts.get("wallet_3")!;

/*
  TrustBox Escrow Contract Tests
  
  Tests cover:
  1. Counter functions (decorative)
  2. Escrow creation
  3. Dual approval mechanism
  4. Cancellation and refunds
  5. Authorization checks
  6. Edge cases and error handling
*/

describe("TrustBox Counter Functions (Decorative)", () => {
  it("should start with counter at 0", () => {
    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-counter",
      [],
      buyer
    );
    expect(result).toBeOk(Cl.uint(0));
  });

  it("should increment counter successfully", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "increment",
      [],
      buyer
    );
    expect(result).toBeOk(Cl.uint(1));

    // Verify counter was incremented
    const { result: counter } = simnet.callReadOnlyFn(
      "trustbox",
      "get-counter",
      [],
      buyer
    );
    expect(counter).toBeOk(Cl.uint(1));
  });

  it("should increment counter multiple times", () => {
    simnet.callPublicFn("trustbox", "increment", [], buyer);
    simnet.callPublicFn("trustbox", "increment", [], seller);
    const { result } = simnet.callPublicFn("trustbox", "increment", [], randomUser);
    
    expect(result).toBeOk(Cl.uint(3));
  });

  it("should decrement counter successfully", () => {
    // First increment to have something to decrement
    simnet.callPublicFn("trustbox", "increment", [], buyer);
    simnet.callPublicFn("trustbox", "increment", [], buyer);

    const { result } = simnet.callPublicFn(
      "trustbox",
      "decrement",
      [],
      buyer
    );
    expect(result).toBeOk(Cl.uint(1));
  });

  it("should fail to decrement below 0 (underflow protection)", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "decrement",
      [],
      buyer
    );
    expect(result).toBeErr(Cl.uint(100)); // ERR_UNDERFLOW
  });
});

describe("TrustBox Escrow - Creation", () => {
  it("should create escrow successfully", () => {
    const amount = 1000000; // 1 STX
    const { result } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(amount)],
      buyer
    );
    expect(result).toBeOk(Cl.uint(0)); // Returns escrow ID 0
  });

  it("should increment escrow ID for each new escrow", () => {
    const amount = 1000000;
    
    const { result: escrow1 } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(amount)],
      buyer
    );
    expect(escrow1).toBeOk(Cl.uint(0));

    const { result: escrow2 } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(randomUser), Cl.uint(amount)],
      buyer
    );
    expect(escrow2).toBeOk(Cl.uint(1));
  });

  it("should fail to create escrow with 0 amount", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(0)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(101)); // ERR_INVALID_AMOUNT
  });

  it("should fail to create self-escrow (buyer = seller)", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(buyer), Cl.uint(1000000)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(107)); // ERR_SELF_ESCROW
  });

  it("should store escrow data correctly", () => {
    const amount = 5000000; // 5 STX
    const currentBlock = simnet.blockHeight;
    
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(amount)],
      buyer
    );

    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-info",
      [Cl.uint(0)],
      buyer
    );

    expect(result).toBeOk(
      Cl.tuple({
        buyer: Cl.principal(buyer),
        seller: Cl.principal(seller),
        amount: Cl.uint(amount),
        "buyer-approved": Cl.bool(false),
        "seller-approved": Cl.bool(false),
        status: Cl.stringAscii("pending"),
        "created-at": Cl.uint(currentBlock),
      })
    );
  });

  it("should set initial status to pending", () => {
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );

    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );

    expect(result).toBeOk(Cl.stringAscii("pending"));
  });
});

describe("TrustBox Escrow - Dual Approval", () => {
  beforeEach(() => {
    // Create a fresh escrow before each test
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );
  });

  it("should allow buyer to approve", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Check that buyer-approved is true
    const { result: info } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-info",
      [Cl.uint(0)],
      buyer
    );
    
    // Verify approval status by checking the tuple (created-at is u2 from beforeEach)
    expect(info).toBeOk(
      Cl.tuple({
        buyer: Cl.principal(buyer),
        seller: Cl.principal(seller),
        amount: Cl.uint(1000000),
        "buyer-approved": Cl.bool(true),
        "seller-approved": Cl.bool(false),
        status: Cl.stringAscii("pending"),
        "created-at": Cl.uint(2),
      })
    );
  });

  it("should allow seller to approve", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      seller
    );
    expect(result).toBeOk(Cl.bool(true));

    // Check that seller-approved is true
    const { result: info } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-info",
      [Cl.uint(0)],
      seller
    );
    
    // Verify approval status by checking the tuple (created-at is u2 from beforeEach)
    expect(info).toBeOk(
      Cl.tuple({
        buyer: Cl.principal(buyer),
        seller: Cl.principal(seller),
        amount: Cl.uint(1000000),
        "buyer-approved": Cl.bool(false),
        "seller-approved": Cl.bool(true),
        status: Cl.stringAscii("pending"),
        "created-at": Cl.uint(2),
      })
    );
  });

  it("should complete escrow when both approve", () => {
    // Buyer approves
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], buyer);

    // Seller approves (should trigger completion)
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      seller
    );
    expect(result).toBeOk(Cl.bool(true));

    // Check status is completed
    const { result: status } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );
    expect(status).toBeOk(Cl.stringAscii("completed"));
  });

  it("should fail if unauthorized user tries to approve", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      randomUser
    );
    expect(result).toBeErr(Cl.uint(103)); // ERR_NOT_AUTHORIZED
  });

  it("should fail if buyer tries to approve twice", () => {
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], buyer);

    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(106)); // ERR_ALREADY_APPROVED
  });

  it("should fail if seller tries to approve twice", () => {
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], seller);

    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      seller
    );
    expect(result).toBeErr(Cl.uint(106)); // ERR_ALREADY_APPROVED
  });

  it("should fail to approve non-existent escrow", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(999)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(102)); // ERR_ESCROW_NOT_FOUND
  });

  it("should fail to approve already completed escrow", () => {
    // Complete the escrow
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], buyer);
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], seller);

    // Try to approve again
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(104)); // ERR_INVALID_STATUS
  });
});

describe("TrustBox Escrow - Cancellation", () => {
  beforeEach(() => {
    // Create a fresh escrow before each test
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );
  });

  it("should allow buyer to cancel escrow", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "cancel-escrow",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Check status is cancelled
    const { result: status } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );
    expect(status).toBeOk(Cl.stringAscii("cancelled"));
  });

  it("should allow seller to cancel escrow", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "cancel-escrow",
      [Cl.uint(0)],
      seller
    );
    expect(result).toBeOk(Cl.bool(true));

    // Check status is cancelled
    const { result: status } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      seller
    );
    expect(status).toBeOk(Cl.stringAscii("cancelled"));
  });

  it("should fail if unauthorized user tries to cancel", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "cancel-escrow",
      [Cl.uint(0)],
      randomUser
    );
    expect(result).toBeErr(Cl.uint(103)); // ERR_NOT_AUTHORIZED
  });

  it("should fail to cancel non-existent escrow", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "cancel-escrow",
      [Cl.uint(999)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(102)); // ERR_ESCROW_NOT_FOUND
  });

  it("should fail to cancel already completed escrow", () => {
    // Complete the escrow
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], buyer);
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], seller);

    // Try to cancel
    const { result } = simnet.callPublicFn(
      "trustbox",
      "cancel-escrow",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(104)); // ERR_INVALID_STATUS
  });

  it("should fail to cancel already cancelled escrow", () => {
    // Cancel once
    simnet.callPublicFn("trustbox", "cancel-escrow", [Cl.uint(0)], buyer);

    // Try to cancel again
    const { result } = simnet.callPublicFn(
      "trustbox",
      "cancel-escrow",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(104)); // ERR_INVALID_STATUS
  });

  it("should not allow approval after cancellation", () => {
    // Cancel escrow
    simnet.callPublicFn("trustbox", "cancel-escrow", [Cl.uint(0)], buyer);

    // Try to approve
    const { result } = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(104)); // ERR_INVALID_STATUS
  });
});

describe("TrustBox Escrow - Read-Only Functions", () => {
  it("should return error for non-existent escrow info", () => {
    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-info",
      [Cl.uint(999)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(102)); // ERR_ESCROW_NOT_FOUND
  });

  it("should return error for non-existent escrow status", () => {
    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(999)],
      buyer
    );
    expect(result).toBeErr(Cl.uint(102)); // ERR_ESCROW_NOT_FOUND
  });

  it("should return current block height", () => {
    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-current-block",
      [],
      buyer
    );
    expect(result).toBeOk(Cl.uint(simnet.blockHeight));
  });

  it("should return next escrow ID", () => {
    const { result: before } = simnet.callReadOnlyFn(
      "trustbox",
      "get-next-escrow-id",
      [],
      buyer
    );
    expect(before).toBeOk(Cl.uint(0));

    // Create an escrow
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );

    const { result: after } = simnet.callReadOnlyFn(
      "trustbox",
      "get-next-escrow-id",
      [],
      buyer
    );
    expect(after).toBeOk(Cl.uint(1));
  });

  it("should check if escrow exists", () => {
    // Non-existent escrow
    const { result: notExists } = simnet.callReadOnlyFn(
      "trustbox",
      "escrow-exists",
      [Cl.uint(0)],
      buyer
    );
    expect(notExists).toBeBool(false);

    // Create escrow
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );

    // Should exist now
    const { result: exists } = simnet.callReadOnlyFn(
      "trustbox",
      "escrow-exists",
      [Cl.uint(0)],
      buyer
    );
    expect(exists).toBeBool(true);
  });
});

describe("TrustBox Escrow - Complex Scenarios", () => {
  it("should handle multiple concurrent escrows", () => {
    // Create multiple escrows
    const escrow1 = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );
    expect(escrow1.result).toBeOk(Cl.uint(0));

    const escrow2 = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(randomUser), Cl.uint(2000000)],
      seller
    );
    expect(escrow2.result).toBeOk(Cl.uint(1));

    const escrow3 = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(buyer), Cl.uint(3000000)],
      randomUser
    );
    expect(escrow3.result).toBeOk(Cl.uint(2));

    // All should have pending status
    const { result: status1 } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );
    expect(status1).toBeOk(Cl.stringAscii("pending"));

    const { result: status2 } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(1)],
      buyer
    );
    expect(status2).toBeOk(Cl.stringAscii("pending"));

    const { result: status3 } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(2)],
      buyer
    );
    expect(status3).toBeOk(Cl.stringAscii("pending"));
  });

  it("should handle approval in reverse order (seller then buyer)", () => {
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );

    // Seller approves first
    const sellerApprove = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      seller
    );
    expect(sellerApprove.result).toBeOk(Cl.bool(true));

    // Status should still be pending
    const { result: statusPending } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );
    expect(statusPending).toBeOk(Cl.stringAscii("pending"));

    // Buyer approves second (should complete)
    const buyerApprove = simnet.callPublicFn(
      "trustbox",
      "approve-release",
      [Cl.uint(0)],
      buyer
    );
    expect(buyerApprove.result).toBeOk(Cl.bool(true));

    // Status should be completed
    const { result: statusCompleted } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );
    expect(statusCompleted).toBeOk(Cl.stringAscii("completed"));
  });

  it("should maintain independent state for different escrows", () => {
    // Create two escrows
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(buyer), Cl.uint(2000000)],
      seller
    );

    // Approve first escrow
    simnet.callPublicFn("trustbox", "approve-release", [Cl.uint(0)], buyer);

    // Cancel second escrow
    simnet.callPublicFn("trustbox", "cancel-escrow", [Cl.uint(1)], seller);

    // Check statuses are independent
    const { result: status1 } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(0)],
      buyer
    );
    expect(status1).toBeOk(Cl.stringAscii("pending")); // Still pending (only buyer approved)

    const { result: status2 } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-status",
      [Cl.uint(1)],
      buyer
    );
    expect(status2).toBeOk(Cl.stringAscii("cancelled"));
  });
});

describe("TrustBox Escrow - Edge Cases", () => {
  it("should handle very small amounts (1 microstacks)", () => {
    const { result } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1)],
      buyer
    );
    expect(result).toBeOk(Cl.uint(0));
  });

  it("should handle very large amounts", () => {
    const largeAmount = 1000000000000; // 1 million STX
    const { result } = simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(largeAmount)],
      buyer
    );
    expect(result).toBeOk(Cl.uint(0));
  });

  it("should track created-at block height correctly", () => {
    const initialBlock = simnet.blockHeight;
    
    simnet.callPublicFn(
      "trustbox",
      "create-escrow",
      [Cl.principal(seller), Cl.uint(1000000)],
      buyer
    );

    const { result } = simnet.callReadOnlyFn(
      "trustbox",
      "get-escrow-info",
      [Cl.uint(0)],
      buyer
    );

    // Verify the created-at field matches the initial block
    expect(result).toBeOk(
      Cl.tuple({
        buyer: Cl.principal(buyer),
        seller: Cl.principal(seller),
        amount: Cl.uint(1000000),
        "buyer-approved": Cl.bool(false),
        "seller-approved": Cl.bool(false),
        status: Cl.stringAscii("pending"),
        "created-at": Cl.uint(initialBlock),
      })
    );
  });
});
