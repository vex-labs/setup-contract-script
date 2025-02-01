import {
    getSignerFromPrivateKey,
    getProviderByEndpoints,
    SignedTransactionComposer,
  } from '@near-js/client';
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

const rpcProvider = getProviderByEndpoints('https://test.rpc.fastnear.com');
const signer = getSignerFromPrivateKey(process.env.MAIN_ACCOUNT_KEY_1);

const { result } = await SignedTransactionComposer.init({
    sender: mainAccountId,
    receiver: "usdc.betvex.testnet",
    deps: { rpcProvider, signer },
  })
    .functionCall(
      'ft_transfer',
      Buffer.from(JSON.stringify({ receiver_id: adminAccountId, amount: 1000 })),
      1,
    )
    .signAndSend();

console.log(result);

