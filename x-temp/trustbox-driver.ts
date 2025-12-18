/**
 * TrustBox driver script
 *      -- run the script with --
 *  npx tsx x-temp/trustbox-driver.ts
 *
 * or with options:
 *
 *  npx tsx x-temp/trustbox-driver.ts --fast (ignores the delay time set)
 *  npx tsx x-temp/trustbox-driver.ts --mode=counter (test counter increment)
 *  npx tsx x-temp/trustbox-driver.ts --mode=decrement (test counter decrement)
 *  npx tsx x-temp/trustbox-driver.ts --mode=create (test escrow creation)
 *  npx tsx x-temp/trustbox-driver.ts --mode=approve (test dual approval flow)
 *  npx tsx x-temp/trustbox-driver.ts --mode=cancel (test cancellation flow)
 *  npx tsx x-temp/trustbox-driver.ts --mode=full (test complete escrow lifecycle)
 *
 * - Reads the deployer "mnemonic" from settings/Mainnet.toml
 * - Derives the account private key
 * - Interacts with the deployed mainnet contract
 * - Modes:
 *     counter: Continuously calls increment with random delays
 *     decrement: Continuously calls decrement with random delays
 *     create: Creates escrows between parties
 *     approve: Tests dual approval mechanism
 *     cancel: Tests cancellation and refund
 *     full: Runs complete escrow flow with status checks
 * - Waits a random interval between each call:
 *     30s, 45s, 1m, 1m15s, 1m30s, 1m45s, 3m
 *
 * Usage:
 *   - Ensure you have installed dependencies: npm install
 *   - Run with tsx
 *   - By default, this script resolves settings/Mainnet.toml relative to this file
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createNetwork, TransactionVersion } from "@stacks/network";
import {
  AnchorMode,
  PostConditionMode,
  makeContractCall,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  cvToString,
  uintCV,
  principalCV,
} from "@stacks/transactions";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import * as TOML from "toml";

type NetworkSettings = {
  network?: {
    name?: string;
    stacks_node_rpc_address?: string;
    deployment_fee_rate?: number;
  };
  accounts?: {
    deployer?: {
      mnemonic?: string;
    };
  };
};

// UPDATE THESE WITH YOUR DEPLOYED CONTRACT DETAILS
const CONTRACT_ADDRESS = "SP1GNDB8SXJ51GBMSVVXMWGTPRFHGSMWNNBEY25A4"; // Your deployed address
const CONTRACT_NAME = "trustbox";

// Function names in trustbox.clar
const FN_INCREMENT = "increment";
const FN_DECREMENT = "decrement";
const FN_CREATE_ESCROW = "create-escrow";
const FN_APPROVE_RELEASE = "approve-release";
const FN_CANCEL_ESCROW = "cancel-escrow";
const FN_GET_COUNTER = "get-counter";
const FN_GET_ESCROW_INFO = "get-escrow-info";
const FN_GET_ESCROW_STATUS = "get-escrow-status";
const FN_GET_CURRENT_BLOCK = "get-current-block";
const FN_GET_NEXT_ESCROW_ID = "get-next-escrow-id";

// Reasonable default fee in microstacks for contract-call
const DEFAULT_FEE_USTX = 10000;

// Parse command-line arguments
const FAST = process.argv.includes("--fast");
const MODE =
  process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ||
  "counter";

// Random delay choices (milliseconds)
let DELAY_CHOICES_MS = [
  10_000, // 10 sec
  25_000, // 25 sec
  30_000, // 30 sec
  40_000, // 40 sec
  20_000, // 20 sec
  35_000, // 35 sec
  20_000, // 20 sec
];
if (FAST) {
  // Shorten delays for a quick smoke run
  DELAY_CHOICES_MS = [1_000, 2_000, 3_000, 5_000];
}

// Helper to get current file dir (ESM-compatible)
function thisDirname(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.dirname(__filename);
}

async function readMainnetMnemonic(): Promise<string> {
  const baseDir = thisDirname();
  // Resolve ../settings/Mainnet.toml relative to this file
  const settingsPath = path.resolve(baseDir, "../settings/Mainnet.toml");

  const raw = await fs.readFile(settingsPath, "utf8");
  const parsed = TOML.parse(raw) as NetworkSettings;

  const mnemonic = parsed?.accounts?.deployer?.mnemonic;
  if (!mnemonic || mnemonic.includes("<YOUR PRIVATE MAINNET MNEMONIC HERE>")) {
    throw new Error(
      `Mnemonic not found in ${settingsPath}. Please set [accounts.deployer].mnemonic.`
    );
  }
  return mnemonic.trim();
}

async function deriveSenderFromMnemonic(mnemonic: string) {
  // Note: generateWallet accepts the 12/24-word secret phrase via "secretKey"
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: "",
  });
  const account = wallet.accounts[0];

  function normalizeSenderKey(key: string): string {
    let k = (key || "").trim();
    if (k.startsWith("0x") || k.startsWith("0X")) k = k.slice(2);
    return k;
  }

  const rawKey = account.stxPrivateKey || "";
  const senderKey = normalizeSenderKey(rawKey); // hex private key string, no 0x prefix

  const senderAddress = getStxAddress({
    account,
    transactionVersion: TransactionVersion.Mainnet,
  });

  // Debug: key length (do not print full key)
  console.log(
    `Derived sender key length: ${senderKey.length} hex chars (address: ${senderAddress})`
  );

  return { senderKey, senderAddress };
}

function pickRandomDelayMs(): number {
  const i = Math.floor(Math.random() * DELAY_CHOICES_MS.length);
  return DELAY_CHOICES_MS[i];
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      clearTimeout(timer);
      return reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort);
  });
}

async function readCounter(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_COUNTER,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readEscrowInfo(
  network: any,
  senderAddress: string,
  escrowId: number
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_ESCROW_INFO,
    functionArgs: [uintCV(escrowId)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readEscrowStatus(
  network: any,
  senderAddress: string,
  escrowId: number
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_ESCROW_STATUS,
    functionArgs: [uintCV(escrowId)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readCurrentBlock(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_CURRENT_BLOCK,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readNextEscrowId(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_NEXT_ESCROW_ID,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function contractCall(
  network: any,
  senderKey: string,
  functionName: string,
  functionArgs: any[] = []
) {
  console.log(
    `Preparing contract-call tx for: ${functionName}${
      functionArgs.length > 0 ? " with args" : ""
    }`
  );
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs,
    network,
    senderKey,
    fee: DEFAULT_FEE_USTX,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  // Defensive: ensure tx object is valid before broadcast
  if (!tx || typeof (tx as any).serialize !== "function") {
    throw new Error(
      `Invalid transaction object for ${functionName} (missing serialize).`
    );
  }

  try {
    const resp = await broadcastTransaction({ transaction: tx, network });
    const txid =
      typeof resp === "string"
        ? resp
        : (resp as any).txid ||
          (resp as any).transactionId ||
          (resp as any).txId ||
          (resp as any).tx_id ||
          "unknown-txid";
    console.log(`Broadcast response for ${functionName}: ${txid}`);
    return txid;
  } catch (e: any) {
    const reason =
      e?.message ||
      e?.response?.error ||
      e?.response?.reason ||
      e?.responseText ||
      "unknown-error";
    throw new Error(`Broadcast failed for ${functionName}: ${reason}`);
  }
}

async function runCounterMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log("Running in COUNTER mode: will increment counter continuously");
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;
    const functionName = FN_INCREMENT;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next call (${functionName})...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    console.log(`Calling ${functionName} (#${iteration})...`);
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, functionName);
        console.log(`Broadcasted ${functionName}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${functionName}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read counter after ${functionName}:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runDecrementMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log("Running in DECREMENT mode: will decrement counter continuously");
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;
    const functionName = FN_DECREMENT;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next call (${functionName})...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    console.log(`Calling ${functionName} (#${iteration})...`);
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, functionName);
        console.log(`Broadcasted ${functionName}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${functionName}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read counter after ${functionName}:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runCreateMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in CREATE mode: will create escrows with test amounts (0.001 STX each)"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  // Test seller address (you can change this to another address)
  const testSellerAddress = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before creating next escrow...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Create escrow with 1000 uSTX (0.001 STX)
    const escrowAmount = 1000; // 0.001 STX in microstacks

    console.log(
      `Calling ${FN_CREATE_ESCROW} (#${iteration}) with ${escrowAmount} uSTX to seller ${testSellerAddress}...`
    );
    let txid: string | null = null;
    let escrowId: number | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Get next escrow ID before creating
        const nextIdStr = await readNextEscrowId(network, senderAddress);
        escrowId = parseInt(nextIdStr.replace(/[^0-9]/g, "")) || 0;

        txid = await contractCall(network, senderKey, FN_CREATE_ESCROW, [
          principalCV(testSellerAddress),
          uintCV(escrowAmount),
        ]);
        console.log(`Broadcasted ${FN_CREATE_ESCROW}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${FN_CREATE_ESCROW}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid && escrowId !== null) {
      try {
        const escrowInfo = await readEscrowInfo(
          network,
          senderAddress,
          escrowId
        );
        const escrowStatus = await readEscrowStatus(
          network,
          senderAddress,
          escrowId
        );
        console.log(`Escrow #${escrowId} info (read-only): ${escrowInfo}`);
        console.log(`Escrow #${escrowId} status (read-only): ${escrowStatus}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read escrow info:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runApproveMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in APPROVE mode: will test dual approval flow (NOTE: needs 2 accounts)"
  );
  console.log(
    "⚠️  This mode requires both buyer and seller to approve. Update script with seller key for full test."
  );

  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  // In a real scenario, you'd need the seller's private key to fully test
  // For now, this will just approve from the buyer side

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next approval...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Get current escrow count and try to approve the latest one
    try {
      const nextIdStr = await readNextEscrowId(network, senderAddress);
      const nextId = parseInt(nextIdStr.replace(/[^0-9]/g, "")) || 0;

      if (nextId === 0) {
        console.log(
          "No escrows exist yet. Create one first with --mode=create"
        );
        break;
      }

      const escrowId = nextId - 1; // Try to approve the most recent escrow

      // Check if escrow is still pending
      const status = await readEscrowStatus(network, senderAddress, escrowId);
      console.log(`Escrow #${escrowId} current status: ${status}`);

      if (!status.includes("pending")) {
        console.log(
          `Escrow #${escrowId} is not pending, skipping approval attempt`
        );
        continue;
      }

      console.log(
        `Calling ${FN_APPROVE_RELEASE} (#${iteration}) for escrow #${escrowId}...`
      );
      let txid: string | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          txid = await contractCall(network, senderKey, FN_APPROVE_RELEASE, [
            uintCV(escrowId),
          ]);
          console.log(`Broadcasted ${FN_APPROVE_RELEASE}: ${txid}`);
          break;
        } catch (err) {
          const msg = (err as Error).message || String(err);
          console.warn(
            `Attempt ${attempt} failed for ${FN_APPROVE_RELEASE}: ${msg}${
              attempt < 3 ? " — retrying..." : ""
            }`
          );
          if (attempt < 3) {
            try {
              await delay(2000 * attempt, stopSignal);
            } catch {
              keepRunning = false;
              break;
            }
          }
        }
      }

      if (txid) {
        try {
          const escrowInfo = await readEscrowInfo(
            network,
            senderAddress,
            escrowId
          );
          const escrowStatus = await readEscrowStatus(
            network,
            senderAddress,
            escrowId
          );
          console.log(
            `Escrow #${escrowId} info after approval (read-only): ${escrowInfo}`
          );
          console.log(
            `Escrow #${escrowId} status after approval (read-only): ${escrowStatus}`
          );
        } catch (re) {
          console.warn(
            `Warning: failed to read escrow info after approval:`,
            (re as Error).message
          );
        }
      }
    } catch (e) {
      console.warn(
        "Warning: failed to process approval:",
        (e as Error).message
      );
    }

    // Only do one approval per run in this mode
    break;
  }
}

async function runCancelMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in CANCEL mode: will cancel pending escrows and test refund"
  );

  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next cancellation...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Get current escrow count and try to cancel the latest pending one
    try {
      const nextIdStr = await readNextEscrowId(network, senderAddress);
      const nextId = parseInt(nextIdStr.replace(/[^0-9]/g, "")) || 0;

      if (nextId === 0) {
        console.log(
          "No escrows exist yet. Create one first with --mode=create"
        );
        break;
      }

      const escrowId = nextId - 1; // Try to cancel the most recent escrow

      // Check if escrow is still pending
      const status = await readEscrowStatus(network, senderAddress, escrowId);
      console.log(`Escrow #${escrowId} current status: ${status}`);

      if (!status.includes("pending")) {
        console.log(`Escrow #${escrowId} is not pending, cannot cancel`);
        break;
      }

      console.log(
        `Calling ${FN_CANCEL_ESCROW} (#${iteration}) for escrow #${escrowId}...`
      );
      let txid: string | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          txid = await contractCall(network, senderKey, FN_CANCEL_ESCROW, [
            uintCV(escrowId),
          ]);
          console.log(`Broadcasted ${FN_CANCEL_ESCROW}: ${txid}`);
          break;
        } catch (err) {
          const msg = (err as Error).message || String(err);
          console.warn(
            `Attempt ${attempt} failed for ${FN_CANCEL_ESCROW}: ${msg}${
              attempt < 3 ? " — retrying..." : ""
            }`
          );
          if (attempt < 3) {
            try {
              await delay(2000 * attempt, stopSignal);
            } catch {
              keepRunning = false;
              break;
            }
          }
        }
      }

      if (txid) {
        try {
          const escrowInfo = await readEscrowInfo(
            network,
            senderAddress,
            escrowId
          );
          const escrowStatus = await readEscrowStatus(
            network,
            senderAddress,
            escrowId
          );
          console.log(
            `Escrow #${escrowId} info after cancellation (read-only): ${escrowInfo}`
          );
          console.log(
            `Escrow #${escrowId} status after cancellation (read-only): ${escrowStatus}`
          );
        } catch (re) {
          console.warn(
            `Warning: failed to read escrow info after cancellation:`,
            (re as Error).message
          );
        }
      }
    } catch (e) {
      console.warn(
        "Warning: failed to process cancellation:",
        (e as Error).message
      );
    }

    // Only do one cancellation per run in this mode
    break;
  }
}

async function runFullMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in FULL mode: will test complete escrow lifecycle with status checks"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  const testSellerAddress = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next action...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Cycle through different actions
    const actionIndex = iteration % 4;

    if (actionIndex === 0) {
      // Increment counter
      console.log(`Calling ${FN_INCREMENT} (#${iteration})...`);
      try {
        const txid = await contractCall(network, senderKey, FN_INCREMENT);
        console.log(`Broadcasted ${FN_INCREMENT}: ${txid}`);
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (e) {
        console.warn(
          `Warning: failed to increment counter:`,
          (e as Error).message
        );
      }
    } else if (actionIndex === 1) {
      // Create escrow
      console.log(
        `Calling ${FN_CREATE_ESCROW} (#${iteration}) with 1000 uSTX...`
      );
      try {
        const nextIdStr = await readNextEscrowId(network, senderAddress);
        const escrowId = parseInt(nextIdStr.replace(/[^0-9]/g, "")) || 0;

        const txid = await contractCall(network, senderKey, FN_CREATE_ESCROW, [
          principalCV(testSellerAddress),
          uintCV(1000),
        ]);
        console.log(`Broadcasted ${FN_CREATE_ESCROW}: ${txid}`);

        const escrowInfo = await readEscrowInfo(
          network,
          senderAddress,
          escrowId
        );
        const escrowStatus = await readEscrowStatus(
          network,
          senderAddress,
          escrowId
        );
        console.log(`Escrow #${escrowId} info (read-only): ${escrowInfo}`);
        console.log(`Escrow #${escrowId} status (read-only): ${escrowStatus}`);
      } catch (e) {
        console.warn(`Warning: failed to create escrow:`, (e as Error).message);
      }
    } else if (actionIndex === 2) {
      // Check escrow status
      try {
        const nextIdStr = await readNextEscrowId(network, senderAddress);
        const nextId = parseInt(nextIdStr.replace(/[^0-9]/g, "")) || 0;
        console.log(`Total escrows created: ${nextId}`);

        if (nextId > 0) {
          const lastEscrowId = nextId - 1;
          const escrowInfo = await readEscrowInfo(
            network,
            senderAddress,
            lastEscrowId
          );
          const escrowStatus = await readEscrowStatus(
            network,
            senderAddress,
            lastEscrowId
          );
          console.log(`Latest escrow (#${lastEscrowId}) info: ${escrowInfo}`);
          console.log(
            `Latest escrow (#${lastEscrowId}) status: ${escrowStatus}`
          );
        }
      } catch (e) {
        console.warn(
          `Warning: failed to read escrow status:`,
          (e as Error).message
        );
      }
    } else {
      // Check overall state
      try {
        const counter = await readCounter(network, senderAddress);
        const currentBlock = await readCurrentBlock(network, senderAddress);
        const nextEscrowId = await readNextEscrowId(network, senderAddress);
        console.log(`\nCurrent state:`);
        console.log(`  Counter: ${counter}`);
        console.log(`  Current block: ${currentBlock}`);
        console.log(`  Next escrow ID: ${nextEscrowId}`);
      } catch (e) {
        console.warn(
          "Warning: failed to read overall state:",
          (e as Error).message
        );
      }
    }
  }
}

async function main() {
  console.log("TrustBox driver starting...");
  if (FAST) console.log("FAST mode enabled: shortened delays");
  console.log(`Mode: ${MODE}`);

  // 1) Network
  const network = createNetwork("mainnet");

  // 2) Load mnemonic and derive sender
  const mnemonic = await readMainnetMnemonic();
  const { senderKey, senderAddress } = await deriveSenderFromMnemonic(mnemonic);

  console.log(`Using sender address: ${senderAddress}`);
  console.log(
    `Target contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME} (mainnet)`
  );

  // 3) Continuous run based on mode
  const stopController = new AbortController();
  const stopSignal = stopController.signal;
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Stopping now...");
    stopController.abort();
  });

  try {
    if (MODE === "counter") {
      await runCounterMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "decrement") {
      await runDecrementMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "create") {
      await runCreateMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "approve") {
      await runApproveMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "cancel") {
      await runCancelMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "full") {
      await runFullMode(network, senderKey, senderAddress, stopSignal);
    } else {
      throw new Error(
        `Unknown mode: ${MODE}. Use --mode=counter, --mode=decrement, --mode=create, --mode=approve, --mode=cancel, or --mode=full`
      );
    }
  } catch (e) {
    if ((e as Error).message !== "aborted") {
      throw e;
    }
  }

  // Final status check
  try {
    const finalCounter = await readCounter(network, senderAddress);
    const finalBlock = await readCurrentBlock(network, senderAddress);
    const finalNextEscrowId = await readNextEscrowId(network, senderAddress);
    console.log(`\nFinal status:`);
    console.log(`  Counter: ${finalCounter}`);
    console.log(`  Current block: ${finalBlock}`);
    console.log(`  Next escrow ID: ${finalNextEscrowId}`);
  } catch (e) {
    console.warn("Warning: failed to read final status:", (e as Error).message);
  }
  console.log("TrustBox driver stopped.");
}

// Run
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
