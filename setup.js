import { connect, keyStores, KeyPair, utils, providers } from "near-api-js";
import dotenv from "dotenv";
import { readFile } from "fs/promises";

const matchesJson = await readFile(new URL('./matches.json', import.meta.url));
const matches = JSON.parse(matchesJson);

const ONE_USDC = 1_000_000;
const ONE_NEAR = utils.format.parseNearAmount("1");

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
    currentMainKeyIndex = (currentMainKeyIndex + 1) % mainAccountPrivateKeys.length;
    return key;
}

// Helper function to get next admin account private key in rotation
let currentAdminKeyIndex = 0;
function getNextAdminKey() {
    const key = adminAccountPrivateKeys[currentAdminKeyIndex];
    currentAdminKeyIndex = (currentAdminKeyIndex + 1) % adminAccountPrivateKeys.length;
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

// Create 10 new accounts
console.log('Creating accounts...');
const newAccounts = [];
const accountCreationPromises = [];

// Create all accounts in parallel
for (let i = 0; i < 10; i++) {
    const newAccountId = generateRandomAccountId('user');
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
    console.log('All accounts created successfully');
} catch (error) {
    console.error('Error during account creation:', error);
    process.exit(1);
}

// Then do all storage deposits in parallel
console.log('Registering accounts for USDC...');
const registrationPromises = newAccounts.map(accountId => {
    console.log(`Registering account: ${accountId}`);
    return registerAccountForToken(accountId);
});

// Wait for ALL registrations to complete
try {
    await Promise.all(registrationPromises);
    console.log('All accounts registered for USDC');
} catch (error) {
    console.error('Error during account registration:', error);
    process.exit(1);
}

// Finally do all transfers in parallel
console.log('Transferring USDC to accounts...');
const fundingPromises = newAccounts.map(accountId => {
    console.log(`Transferring USDC to account: ${accountId}`);
    return transferUSDC(accountId);
});

// Wait for ALL transfers to complete
try {
    await Promise.all(fundingPromises);
    console.log('All accounts funded with USDC');
} catch (error) {
    console.error('Error during USDC transfer:', error);
    process.exit(1);
}

console.log('All accounts created and funded successfully');

// Then create matches...

// Create all matches from the matches.json file
console.log('Creating matches...');

// Process matches in batches of 2 to match our 10 keys
const batchSize = 2;
for (let i = 0; i < matches.length; i += batchSize) {
    const batch = matches.slice(i, i + batchSize);
    const batchPromises = batch.map(match => {
        console.log(`Creating match: ${match.team_1} vs ${match.team_2}`);
        return createMatch(match);
    });

    try {
        await Promise.all(batchPromises);
        console.log(`Successfully created batch ${i/2 + 1} of matches`);
    } catch (error) {
        console.error(`Failed to create batch ${i/2 + 1} of matches:`, error);
        process.exit(1);
    }
}

console.log('All matches created successfully');

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
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

// Update the transaction functions to use new connection pattern
async function createAccount(newAccountId, newPublicKey) {
    return retryOnFail(async () => {
        const account = await createConnectionWithKey(mainAccountId, getNextMainKey());
        const createAccountResult = await account.functionCall({
            contractId: "testnet",
            methodName: "create_account",
            args: {
                new_account_id: newAccountId,
                new_public_key: newPublicKey,
            },
            attachedDeposit: utils.format.parseNearAmount("0.1"),
        });
        return { accountId: newAccountId, result: createAccountResult };
    });
}

async function registerAccountForToken(accountId) {
    return retryOnFail(async () => {
        const account = await createConnectionWithKey(mainAccountId, getNextMainKey());
        return await account.functionCall({
            contractId: "usdc.betvex.testnet",
            methodName: "storage_deposit",
            args: {
                account_id: accountId,
            },
            attachedDeposit: "1250000000000000000000",
        });
    });
}

async function transferUSDC(accountId) {
    return retryOnFail(async () => {
        const account = await createConnectionWithKey(mainAccountId, getNextMainKey());
        return await account.functionCall({
            contractId: "usdc.betvex.testnet",
            methodName: "ft_transfer",
            args: {
                receiver_id: accountId,
                amount: (1 * ONE_USDC).toString(),
            },
            attachedDeposit: 1,
        });
    });
}

async function createMatch(matchData) {
    return retryOnFail(async () => {
        const account = await createConnectionWithKey(adminAccountId, getNextAdminKey());
        return await account.functionCall({
            contractId: "contract.betvex.testnet",
            methodName: "create_match",
            args: {
                game: matchData.game,
                team_1: matchData.team_1,
                team_2: matchData.team_2,
                in_odds_1: matchData.in_odds_1,
                in_odds_2: matchData.in_odds_2,
                date: matchData.date,
            },
            gas: "300000000000000", // 300 TGas
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
    const account = await createConnectionWithKey(mainAccountId, mainAccountPrivateKeys[0]);
    
    // Check usdc balance
    const usdcBalance = await viewContract({
        contractId: "usdc.betvex.testnet",
        methodName: "ft_balance_of",
        args: {
            account_id: mainAccountId,
        },
    });

    // Require main account has at least 10_000 usdc
    if (usdcBalance < 10_000 * ONE_USDC) {
        console.error(`Insufficient USDC balance. Required: 10,000 USDC, Found: ${usdcBalance / ONE_USDC} USDC`);
        process.exit(1);
    }
    
    // Check NEAR balance
    const nearBalance = await account.getAccountBalance();

    // Require main account has at least 5 NEAR
    if (nearBalance.total < 5 * ONE_NEAR) {
        console.error(`Insufficient NEAR balance. Required: 5 NEAR, Found: ${nearBalance.total} NEAR`);
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