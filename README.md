setup-contract-script

This script is used to set up the vex-contract. The script sets up different matches, moves them to different stages and makes bets from different users.

The contract should be deployed and initialized before running this script.

## Running the script

```bash
npm run setup
```

## env

```env
ADMIN_ACCOUNT_ID=admin.betvex.testnet
ADMIN_ACCOUNT_KEY_1=ed25519:2jDDE...
ADMIN_ACCOUNT_KEY_2=ed25519:2jDDE...
ADMIN_ACCOUNT_KEY_3=ed25519:ed25519:2jDDE...
...



MAIN_ACCOUNT_ID=betvex-setup.testnet
MAIN_ACCOUNT_KEY_1=ed25519:ed25519:2jDDE...
MAIN_ACCOUNT_KEY_2=ed25519:ed25519:2jDDE...
MAIN_ACCOUNT_KEY_3=ed25519:2jDDE...
...
```
