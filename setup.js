import { connect, keyStores, KeyPair, utils, providers } from "near-api-js";
import dotenv from "dotenv";
import { readFile } from "fs/promises";

// Contract configuration
const BETVEX_CONTRACT = "vex-contract-12.testnet";
const USDC_CONTRACT = "usdc.betvex.testnet";
const VEX_CONTRACT = "token.betvex.testnet";

const matchesJson = await readFile(new URL("./matches.json", import.meta.url));
const matches = JSON.parse(matchesJson);

// Add a constant for gas at the top with other constants
const ONE_USDC = 1_000_000;
const ONE_NEAR = utils.format.parseNearAmount("1");
const ONE_VEX = "1000000000000000000"; // 18 decimals
const GAS_300_TGAS = "300000000000000"; // 300 TGas

// Load environment variables
dotenv.config({ path: ".env" });
const mainAccountId = process.env.MAIN_ACCOUNT_ID;
const adminAccountId = process.env.ADMIN_ACCOUNT_ID;

// Setup arrays for private keys
const mainAccountPrivateKeys = [];
const adminAccountPrivateKeys = [];

// Load main account keys
for (let i = 1; i <= 10; i++) {
  const key = process.env[`MAIN_ACCOUNT_KEY_${i}`];
  if (!key) {
    throw new Error(`Missing MAIN_ACCOUNT_KEY_${i} in environment variables`);
  }
  mainAccountPrivateKeys.push(key);
}

// Load admin account keys
for (let i = 1; i <= 10; i++) {
  const key = process.env[`ADMIN_ACCOUNT_KEY_${i}`];
  if (!key) {
    throw new Error(`Missing ADMIN_ACCOUNT_KEY_${i} in environment variables`);
  }
  adminAccountPrivateKeys.push(key);
}

// Helper function to get next main account private key in rotation
let currentMainKeyIndex = 0;
function getNextMainKey() {
  const key = mainAccountPrivateKeys[currentMainKeyIndex];
  currentMainKeyIndex =
    (currentMainKeyIndex + 1) % mainAccountPrivateKeys.length;
  return key;
}

// Helper function to get next admin account private key in rotation
let currentAdminKeyIndex = 0;
function getNextAdminKey() {
  const key = adminAccountPrivateKeys[currentAdminKeyIndex];
  currentAdminKeyIndex =
    (currentAdminKeyIndex + 1) % adminAccountPrivateKeys.length;
  return key;
}

// Helper function to create a NEAR connection with a single key
async function createConnectionWithKey(accountId, privateKey) {
  const keyPair = KeyPair.fromString(privateKey);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", accountId, keyPair);

  const connectionConfig = {
    networkId: "testnet",
    keyStore,
    nodeUrl: "https://test.rpc.fastnear.com",
  };

  const nearConnection = await connect(connectionConfig);
  return await nearConnection.account(accountId);
}

// Check main account balance
await checkMainAccountBalance();

// Stake VEX tokens first - this must succeed or the script will exit
console.log("\nStaking VEX tokens...");
let stakeSuccess = false;
try {
  await stakeVEX(100000);
  console.log("Successfully staked 100,000 VEX tokens");
  stakeSuccess = true;
} catch (error) {
  console.error("Error staking VEX tokens:", error);
  console.error("VEX staking failed - exiting script as staking is required");
  process.exit(1);
}

// Only continue if staking was successful
if (!stakeSuccess) {
  console.error("VEX staking status check failed - exiting script");
  process.exit(1);
}

// Create 10 new accounts
console.log("\nCreating accounts...");
const newAccounts = [];
const accountCreationPromises = [];

// Create all accounts in parallel
for (let i = 0; i < 10; i++) {
  const newAccountId = generateRandomAccountId("user");
  newAccounts.push(newAccountId);

  console.log(`Creating account: ${newAccountId}`);
  // Use first key's public key for all new accounts
  const keyPair = KeyPair.fromString(mainAccountPrivateKeys[0]);
  const publicKey = keyPair.getPublicKey().toString();
  accountCreationPromises.push(createAccount(newAccountId, publicKey));
}

// Wait for ALL account creations to complete
try {
  await Promise.all(accountCreationPromises);
  console.log("All accounts created successfully");
} catch (error) {
  console.error("Error during account creation:", error);
  process.exit(1);
}

// After creating accounts, fund them with additional NEAR
console.log("Funding accounts with NEAR...");
const nearFundingPromises = newAccounts.map((accountId) => {
  console.log(`Funding account with NEAR: ${accountId}`);
  return fundAccountWithNear(accountId);
});

// Wait for ALL NEAR funding to complete
try {
  await Promise.all(nearFundingPromises);
  console.log("All accounts funded with NEAR");
} catch (error) {
  console.error("Error during NEAR funding:", error);
  process.exit(1);
}

// Then do all storage deposits in parallel
console.log("Registering accounts for USDC...");
const registrationPromises = newAccounts.map((accountId) => {
  console.log(`Registering account: ${accountId}`);
  return registerAccountForToken(accountId);
});

// Wait for ALL registrations to complete
try {
  await Promise.all(registrationPromises);
  console.log("All accounts registered for USDC");
} catch (error) {
  console.error("Error during account registration:", error);
  process.exit(1);
}

// Finally do all transfers in parallel
console.log("Transferring USDC to accounts...");
const fundingPromises = newAccounts.map((accountId) => {
  console.log(`Transferring USDC to account: ${accountId}`);
  return transferUSDC(accountId);
});

// Wait for ALL transfers to complete
try {
  await Promise.all(fundingPromises);
  console.log("All accounts funded with USDC");
} catch (error) {
  console.error("Error during USDC transfer:", error);
  process.exit(1);
}

console.log("All accounts created and funded successfully");

// Then create matches...
console.log("Creating matches...");

// Create matches in two batches of 10
const batchSize = 10;
const numberOfBatches = 2;

for (let batchNumber = 0; batchNumber < numberOfBatches; batchNumber++) {
  const startIndex = batchNumber * batchSize;
  const batch = matches.slice(startIndex, startIndex + batchSize);
  console.log(`\nCreating batch ${batchNumber + 1} of matches...`);

  const batchPromises = batch.map((match) => {
    console.log(`Creating match: ${match.team_1} vs ${match.team_2}`);
    return createMatch(match);
  });

  try {
    await Promise.all(batchPromises);
    console.log(`Successfully created batch ${batchNumber + 1} of matches`);

    // Add delay between batches
    if (batchNumber < numberOfBatches - 1) {
      console.log("Waiting before processing next batch...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error(
      `Failed to create batch ${batchNumber + 1} of matches:`,
      error,
    );
    process.exit(1);
  }
}

console.log("All matches created successfully");

// Add tracking objects after the matches array
const matchOutcomes = {
  cancelled: [],
  endedBetting: [],
  finished: [],
  bets: {}, // Will store bet IDs and outcomes for each match
};

// Add new functions for match management
async function cancelMatch(matchId) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      adminAccountId,
      getNextAdminKey(),
    );
    return await account.functionCall({
      contractId: BETVEX_CONTRACT,
      methodName: "cancel_match",
      args: {
        match_id: matchId,
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "0",
    });
  });
}

async function endBetting(matchId) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      adminAccountId,
      getNextAdminKey(),
    );
    return await account.functionCall({
      contractId: BETVEX_CONTRACT,
      methodName: "end_betting",
      args: {
        match_id: matchId,
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "0",
    });
  });
}

async function finishMatch(matchId, winner) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      adminAccountId,
      getNextAdminKey(),
    );
    return await account.functionCall({
      contractId: BETVEX_CONTRACT,
      methodName: "finish_match",
      args: {
        match_id: matchId,
        winner: winner,
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "0",
    });
  });
}

async function claimBet(accountId, betId) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      accountId,
      mainAccountPrivateKeys[0],
    );
    return await account.functionCall({
      contractId: BETVEX_CONTRACT,
      methodName: "claim",
      args: {
        bet_id: betId.toString(),
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "0",
    });
  });
}

// Add function to get user's bets
async function getUserBets(accountId) {
  return await viewContract({
    contractId: BETVEX_CONTRACT,
    methodName: "get_users_bets",
    args: {
      bettor: accountId,
      from_index: null,
      limit: null,
    },
  });
}

// Modify makeRandomBets to use get_users_bets for tracking
async function makeRandomBets(accounts, matches) {
  console.log("Starting betting process...");

  // Pre-determine which matches will be finished and their winners
  // First 6 matches will be finished with Team1 as winner
  const matchesToFinish = matches.slice(0, 6);
  const matchWinners = new Map(
    matchesToFinish.map((match) => [
      `${match.team_1}-${match.team_2}-${match.date}`,
      "Team1", // We'll set Team1 as winner for all finished matches
    ]),
  );

  console.log("\nPre-determined match outcomes:");
  matchWinners.forEach((winner, matchId) => {
    console.log(`Match ${matchId} will be finished with ${winner} as winner`);
  });

  // Keep track of how much each account has bet
  const accountBetAmounts = {};
  accounts.forEach((account) => (accountBetAmounts[account] = 0));

  // Create betting promises array
  const bettingPromises = [];

  // For each account
  for (const accountId of accounts) {
    // Make 8-12 bets per account
    const numberOfBets = Math.floor(Math.random() * 5) + 8;
    console.log(`\nAccount ${accountId} will make ${numberOfBets} bets`);

    // Make the specified number of bets
    for (let i = 0; i < numberOfBets; i++) {
      // 90% chance to bet on a match that will be finished
      const willBetOnFinishedMatch = Math.random() < 0.9;
      const match = willBetOnFinishedMatch
        ? matchesToFinish[Math.floor(Math.random() * matchesToFinish.length)]
        : matches[Math.floor(Math.random() * matches.length)];

      const matchId = `${match.team_1}-${match.team_2}-${match.date}`;
      const isFinishedMatch = matchWinners.has(matchId);

      // If betting on a match that will be finished, 80% chance to bet on the winning team
      let team;
      if (isFinishedMatch) {
        team = Math.random() < 0.8 ? matchWinners.get(matchId) : "Team2";
      } else {
        team = Math.random() < 0.5 ? "Team1" : "Team2";
      }

      // Calculate remaining betting allowance for this account
      const remainingAllowance = 1000 - (accountBetAmounts[accountId] || 0);
      if (remainingAllowance <= 0) {
        console.log(
          `Account ${accountId} has reached betting limit, skipping remaining bets`,
        );
        break;
      }

      // Generate random bet amount (between 1 and remaining allowance, max 100 USDC per bet)
      const maxBet = Math.min(remainingAllowance, 100);
      const betAmount = Math.floor(Math.random() * maxBet) + 1;

      // Update account bet total
      accountBetAmounts[accountId] += betAmount;

      // Create bet promise
      console.log(
        `${accountId} betting ${betAmount} USDC on ${team} in match ${matchId} ${isFinishedMatch ? `(will finish with ${matchWinners.get(matchId)} winning)` : ""}`,
      );
      bettingPromises.push(
        bet(
          accountId,
          mainAccountPrivateKeys[0],
          matchId,
          team,
          betAmount,
        ).catch((error) => {
          console.error(`Error placing bet for ${accountId}:`, error);
          accountBetAmounts[accountId] -= betAmount;
        }),
      );

      // Add small delay between bets to prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Wait for all bets to complete
  try {
    await Promise.all(bettingPromises);
    console.log("All bets placed successfully");

    // Print summary of bets
    console.log("\nBetting Summary:");
    for (const [account, totalBet] of Object.entries(accountBetAmounts)) {
      console.log(`${account}: Total bet: ${totalBet} USDC`);
    }

    // Get all bets for each account using get_users_bets
    console.log("\nFetching bet information from contract...");
    for (const accountId of accounts) {
      try {
        const userBets = await getUserBets(accountId);
        console.log(`\nBets for ${accountId}:`, userBets);

        // Process each bet and add to matchOutcomes
        for (const [betId, bet] of userBets) {
          const matchId = bet.match_id;
          if (!matchOutcomes.bets[matchId]) {
            matchOutcomes.bets[matchId] = [];
          }
          matchOutcomes.bets[matchId].push({
            betId: parseInt(betId),
            accountId: accountId,
            team: bet.team,
            amount: parseInt(bet.amount) / ONE_USDC,
          });
        }
      } catch (error) {
        console.error(`Error fetching bets for ${accountId}:`, error);
      }
    }

    // Print tracked bet IDs
    console.log("\nTracked Bet IDs by Match:");
    for (const [matchId, bets] of Object.entries(matchOutcomes.bets)) {
      const willBeFinished = matchesToFinish.some(
        (m) => `${m.team_1}-${m.team_2}-${m.date}` === matchId,
      );
      console.log(
        `\nMatch ${matchId} ${willBeFinished ? "(will be finished)" : ""}:`,
      );
      console.log("Total bets:", bets.length);
      console.log(
        "Bets:",
        bets
          .map(
            (b) =>
              `ID ${b.betId} (${b.accountId} - ${b.team} - ${b.amount} USDC)`,
          )
          .join("\n  "),
      );
    }
  } catch (error) {
    console.error("Error during betting process:", error);
  }
}

// Add match management process after making bets
async function manageMatches() {
  console.log("\nStarting match management process...");

  // First, end betting on 6 matches from the start
  const matchesForEndBetting = [...matches] // Create a copy of matches array
    .sort(() => Math.random() - 0.5) // Shuffle the array
    .slice(0, 6); // Take first 6 from shuffled array
  console.log(
    "\nEnding betting for matches:",
    matchesForEndBetting.map((m) => `${m.team_1} vs ${m.team_2}`).join(", "),
  );

  // End betting on all selected matches
  const endBettingPromises = [];
  for (const match of matchesForEndBetting) {
    const matchId = `${match.team_1}-${match.team_2}-${match.date}`;
    console.log(`Ending betting for match: ${matchId}`);
    endBettingPromises.push(
      endBetting(matchId)
        .then(() => {
          matchOutcomes.endedBetting.push(matchId);
          console.log(`Successfully ended betting for match: ${matchId}`);
        })
        .catch((error) => {
          console.error(`Failed to end betting for match ${matchId}:`, error);
        }),
    );
    // Add delay between starting each end_betting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Wait for all end_betting operations to complete
  console.log("Waiting for all end_betting operations to complete...");
  await Promise.all(endBettingPromises);

  // Add a longer delay (10 seconds) after all end_betting operations
  console.log("Adding 10 second delay after end_betting operations...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Then cancel 2 matches from the end (avoiding the ones we ended betting on)
  const matchesToCancel = matches.slice(-2);
  console.log(
    "\nCancelling matches:",
    matchesToCancel.map((m) => `${m.team_1} vs ${m.team_2}`).join(", "),
  );

  for (const match of matchesToCancel) {
    const matchId = `${match.team_1}-${match.team_2}-${match.date}`;
    try {
      await cancelMatch(matchId);
      matchOutcomes.cancelled.push(matchId);
      console.log(`Successfully cancelled match: ${matchId}`);
      // Add delay after cancelling
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to cancel match ${matchId}:`, error);
    }
  }

  // Add another 10 second delay before finishing matches
  console.log("Adding 10 second delay before finishing matches...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Finally, finish 4 of the matches that had betting ended
  const matchesToFinish = matchesForEndBetting
    .filter((match) => {
      const matchId = `${match.team_1}-${match.team_2}-${match.date}`;
      // Add check to ensure match hasn't already been finished
      return (
        matchOutcomes.endedBetting.includes(matchId) &&
        !matchOutcomes.cancelled.includes(matchId) &&
        !matchOutcomes.finished.some((m) => m.matchId === matchId)
      );
    })
    .slice(0, 4);

  console.log(
    "\nFinishing matches:",
    matchesToFinish.map((m) => `${m.team_1} vs ${m.team_2}`).join(", "),
  );

  for (const match of matchesToFinish) {
    const matchId = `${match.team_1}-${match.team_2}-${match.date}`;
    try {
      // Double check the match hasn't been finished while we were processing others
      if (matchOutcomes.finished.some((m) => m.matchId === matchId)) {
        console.log(
          `Skipping match ${matchId} as it has already been finished`,
        );
        continue;
      }

      const winner = Math.random() < 0.5 ? "Team1" : "Team2";
      console.log(
        `Attempting to finish match ${matchId} with winner ${winner}...`,
      );
      try {
        await finishMatch(matchId, winner);
        matchOutcomes.finished.push({ matchId, winner });
        console.log(
          `Successfully finished match ${matchId} with winner ${winner}`,
        );
      } catch (error) {
        console.error(`Failed to finish match ${matchId}:`, error);
        console.log("Continuing with next match...");
      }
      // Add longer delay after finishing attempt (whether successful or not)
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Unexpected error processing match ${matchId}:`, error);
    }
  }

  // Print final state
  console.log("\nFinal Match States:");
  console.log("Ended Betting:", matchOutcomes.endedBetting);
  console.log("Cancelled:", matchOutcomes.cancelled);
  console.log(
    "Finished:",
    matchOutcomes.finished.map((m) => `${m.matchId} (Winner: ${m.winner})`),
  );
}

// Add claiming process
async function processWinningClaims() {
  console.log("\nProcessing winning claims...");

  // Process claims for finished matches
  for (const { matchId, winner } of matchOutcomes.finished) {
    console.log(
      `\nProcessing claims for finished match ${matchId} (Winner: ${winner})`,
    );
    const matchBets = matchOutcomes.bets[matchId] || [];
    console.log(`Found ${matchBets.length} total bets for this match`);

    // Get all winning bets for this match
    const winningBets = matchBets.filter((bet) => bet.team === winner);
    console.log(`Found ${winningBets.length} winning bets for team ${winner}`);

    // Try to claim all winning bets
    for (const bet of winningBets) {
      console.log(
        `\nAttempting to claim bet ${bet.betId} for ${bet.accountId} (${bet.amount} USDC on ${bet.team})`,
      );
      try {
        await claimBet(bet.accountId, bet.betId);
        console.log(`Successfully claimed bet ${bet.betId}`);
        // Add delay between claims to prevent rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to claim bet ${bet.betId}:`, error);
        // Try one more time if it failed
        try {
          console.log(`Retrying claim for bet ${bet.betId}...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await claimBet(bet.accountId, bet.betId);
          console.log(`Successfully claimed bet ${bet.betId} on retry`);
        } catch (retryError) {
          console.error(
            `Failed to claim bet ${bet.betId} on retry:`,
            retryError,
          );
        }
      }
    }
  }

  // Process claims for cancelled matches
  for (const matchId of matchOutcomes.cancelled) {
    console.log(`\nProcessing claims for cancelled match ${matchId}`);
    const matchBets = matchOutcomes.bets[matchId] || [];
    console.log(`Found ${matchBets.length} total bets for this match`);

    // Try to claim all bets for cancelled matches
    for (const bet of matchBets) {
      console.log(
        `\nAttempting to claim cancelled bet ${bet.betId} for ${bet.accountId} (${bet.amount} USDC)`,
      );
      try {
        await claimBet(bet.accountId, bet.betId);
        console.log(`Successfully claimed cancelled bet ${bet.betId}`);
        // Add delay between claims to prevent rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to claim cancelled bet ${bet.betId}:`, error);
        // Try one more time if it failed
        try {
          console.log(`Retrying claim for cancelled bet ${bet.betId}...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await claimBet(bet.accountId, bet.betId);
          console.log(
            `Successfully claimed cancelled bet ${bet.betId} on retry`,
          );
        } catch (retryError) {
          console.error(
            `Failed to claim cancelled bet ${bet.betId} on retry:`,
            retryError,
          );
        }
      }
    }
  }

  // Print final claiming summary
  console.log("\nClaiming Process Complete");
  console.log(
    "Finished Matches:",
    matchOutcomes.finished.map((m) => m.matchId).join(", "),
  );
  console.log("Cancelled Matches:", matchOutcomes.cancelled.join(", "));

  // Print bet counts by match
  for (const [matchId, bets] of Object.entries(matchOutcomes.bets)) {
    const matchStatus = matchOutcomes.finished.find(
      (m) => m.matchId === matchId,
    )
      ? `finished (Winner: ${matchOutcomes.finished.find((m) => m.matchId === matchId).winner})`
      : matchOutcomes.cancelled.includes(matchId)
        ? "cancelled"
        : "not finished";

    console.log(`\nMatch ${matchId} (${matchStatus}):`);
    console.log(`Total bets: ${bets.length}`);
    if (matchStatus.includes("finished")) {
      const winner = matchOutcomes.finished.find(
        (m) => m.matchId === matchId,
      ).winner;
      const winningBets = bets.filter((bet) => bet.team === winner);
      console.log(`Winning bets: ${winningBets.length}`);
      console.log(
        "Winning bet IDs:",
        winningBets.map((b) => b.betId).join(", "),
      );
    }
  }
}

// Make random bets with the new accounts
await makeRandomBets(newAccounts, matches);

// Add these calls after makeRandomBets
await manageMatches();
await processWinningClaims();

// Helper function to retry failed transactions
async function retryOnFail(operation, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error; // If we're out of attempts, throw the error
      }
      console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Update the transaction functions to use new connection pattern
async function createAccount(newAccountId, newPublicKey) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      mainAccountId,
      getNextMainKey(),
    );
    const createAccountResult = await account.functionCall({
      contractId: "testnet",
      methodName: "create_account",
      args: {
        new_account_id: newAccountId,
        new_public_key: newPublicKey,
      },
      attachedDeposit: utils.format.parseNearAmount("0.5"), // Increase initial deposit to 0.5 NEAR
    });
    return { accountId: newAccountId, result: createAccountResult };
  });
}

// Add function to send additional NEAR to accounts
async function fundAccountWithNear(accountId) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      mainAccountId,
      getNextMainKey(),
    );
    return await account.sendMoney(
      accountId,
      utils.format.parseNearAmount("0.5"), // Send 0.5 NEAR for transactions
    );
  });
}

async function registerAccountForToken(accountId) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      mainAccountId,
      getNextMainKey(),
    );
    return await account.functionCall({
      contractId: USDC_CONTRACT,
      methodName: "storage_deposit",
      args: {
        account_id: accountId,
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "1250000000000000000000",
    });
  });
}

async function transferUSDC(accountId) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      mainAccountId,
      getNextMainKey(),
    );
    return await account.functionCall({
      contractId: USDC_CONTRACT,
      methodName: "ft_transfer",
      args: {
        receiver_id: accountId,
        amount: (1000 * ONE_USDC).toString(),
      },
      gas: GAS_300_TGAS,
      attachedDeposit: 1,
    });
  });
}

async function createMatch(matchData) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      adminAccountId,
      getNextAdminKey(),
    );
    return await account.functionCall({
      contractId: BETVEX_CONTRACT,
      methodName: "create_match",
      args: {
        game: matchData.game,
        team_1: matchData.team_1,
        team_2: matchData.team_2,
        in_odds_1: matchData.in_odds_1,
        in_odds_2: matchData.in_odds_2,
        date: matchData.date,
      },
      gas: GAS_300_TGAS,
    });
  });
}

async function bet(accountId, privateKey, matchId, team, amount) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(accountId, privateKey);

    // Convert amount to USDC decimals
    const usdcAmount = (amount * ONE_USDC).toString();

    // Construct the bet message according to FtTransferAction::Bet(BetInfo)
    const msg = JSON.stringify({
      Bet: {
        match_id: matchId,
        team: team,
      },
    });

    return await account.functionCall({
      contractId: USDC_CONTRACT,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: BETVEX_CONTRACT,
        amount: usdcAmount,
        msg: msg,
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "1", // 1 yoctoNEAR required for ft_transfer_call
    });
  });
}

// Generate a random account ID
function generateRandomAccountId(prefix) {
  const randomNumbers = Math.floor(1000000000 + Math.random() * 9000000000); // Generates a 10-digit random number
  return `${prefix}-${randomNumbers}.testnet`;
}

async function checkMainAccountBalance() {
  // Create a temporary connection for balance check
  const account = await createConnectionWithKey(
    mainAccountId,
    mainAccountPrivateKeys[0],
  );

  // Check usdc balance
  const usdcBalance = await viewContract({
    contractId: USDC_CONTRACT,
    methodName: "ft_balance_of",
    args: {
      account_id: mainAccountId,
    },
  });

  // Check VEX balance
  const vexBalance = await viewContract({
    contractId: VEX_CONTRACT,
    methodName: "ft_balance_of",
    args: {
      account_id: mainAccountId,
    },
  });

  // Require main account has at least 100_000 VEX
  if (BigInt(vexBalance) < BigInt(100_000) * BigInt(ONE_VEX)) {
    console.error(
      `Insufficient VEX balance. Required: 100,000 VEX, Found: ${BigInt(vexBalance) / BigInt(ONE_VEX)} VEX`,
    );
    process.exit(1);
  }

  // Require main account has at least 10_000 usdc
  if (usdcBalance < 10_000 * ONE_USDC) {
    console.error(
      `Insufficient USDC balance. Required: 10,000 USDC, Found: ${usdcBalance / ONE_USDC} USDC`,
    );
    process.exit(1);
  }

  // Check NEAR balance
  const nearBalance = await account.getAccountBalance();

  // Require main account has at least 5 NEAR
  if (nearBalance.total < 5 * ONE_NEAR) {
    console.error(
      `Insufficient NEAR balance. Required: 5 NEAR, Found: ${nearBalance.total} NEAR`,
    );
    process.exit(1);
  }
}

async function viewContract({
  contractId,
  methodName,
  args = {},
  finality = "optimistic",
}) {
  // Set up a new provider
  const url = `https://test.rpc.fastnear.com`;
  const provider = new providers.JsonRpcProvider({ url });

  // Convert the arguments to base64
  const argsBase64 = args
    ? Buffer.from(JSON.stringify(args)).toString("base64")
    : "";

  // Make the view call
  const viewCallResult = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
    finality: finality,
  });

  // Parse the result
  return JSON.parse(Buffer.from(viewCallResult.result).toString());
}

async function stakeVEX(amount) {
  return retryOnFail(async () => {
    const account = await createConnectionWithKey(
      mainAccountId,
      getNextMainKey(),
    );

    // Convert amount to VEX decimals (18)
    const vexAmount = (BigInt(amount) * BigInt(ONE_VEX)).toString();

    console.log(`Staking ${amount} VEX tokens...`);
    return await account.functionCall({
      contractId: VEX_CONTRACT,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: BETVEX_CONTRACT,
        amount: vexAmount,
        msg: JSON.stringify("Stake"), // Properly format as JSON string
      },
      gas: GAS_300_TGAS,
      attachedDeposit: "1", // 1 yoctoNEAR required for ft_transfer_call
    });
  });
}
