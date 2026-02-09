#!/usr/bin/env tsx

/**
 * SIWE + Remote Signer Demo
 * 
 * This script demonstrates the complete SIWE authentication flow
 * and how to use the resulting JWT with go-livepeer's remote signer.
 * 
 * Prerequisites:
 * - jwt-issuer running on port 8082
 * - go-livepeer remote signer running on port 8081 (optional)
 * 
 * Usage:
 *   npm install -g tsx
 *   tsx examples/siwe-remote-signer-demo.ts
 */

import { SiweMessage } from 'siwe';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// Configuration
const JWT_ISSUER_URL = process.env.JWT_ISSUER_URL || 'http://localhost:8082';
const REMOTE_SIGNER_URL = process.env.REMOTE_SIGNER_URL || 'http://localhost:8081';

// For demo purposes, we'll use a test private key
// In production, this would come from a wallet like MetaMask
const DEMO_PRIVATE_KEY = process.env.DEMO_PRIVATE_KEY || 
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function main() {
  console.log('🚀 SIWE + Remote Signer Demo\n');

  // Step 1: Set up wallet client
  console.log('📝 Step 1: Setting up wallet...');
  const account = privateKeyToAccount(DEMO_PRIVATE_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });
  console.log(`✅ Wallet address: ${account.address}\n`);

  // Step 2: Get nonce from jwt-issuer
  console.log('📝 Step 2: Getting nonce from jwt-issuer...');
  const nonceResponse = await fetch(`${JWT_ISSUER_URL}/auth/nonce`, {
    method: 'POST',
  });
  
  if (!nonceResponse.ok) {
    throw new Error(`Failed to get nonce: ${await nonceResponse.text()}`);
  }

  const { nonce, domain } = await nonceResponse.json();
  console.log(`✅ Nonce: ${nonce}`);
  console.log(`✅ Domain: ${domain}\n`);

  // Step 3: Create SIWE message
  console.log('📝 Step 3: Creating SIWE message...');
  const message = new SiweMessage({
    domain,
    address: account.address,
    statement: 'Sign in to NaaP Platform Demo',
    uri: 'http://localhost:3000',
    version: '1',
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
  });

  const messageString = message.prepareMessage();
  console.log('✅ SIWE Message:');
  console.log(messageString);
  console.log();

  // Step 4: Sign message
  console.log('📝 Step 4: Signing SIWE message with wallet...');
  const signature = await client.signMessage({
    message: messageString,
  });
  console.log(`✅ Signature: ${signature}\n`);

  // Step 5: Verify signature and get JWT
  console.log('📝 Step 5: Verifying signature and getting JWT...');
  const loginResponse = await fetch(`${JWT_ISSUER_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: messageString,
      signature,
    }),
  });

  if (!loginResponse.ok) {
    throw new Error(`Login failed: ${await loginResponse.text()}`);
  }

  const { token, expires_at, address } = await loginResponse.json();
  console.log('✅ JWT Token received!');
  console.log(`   Address: ${address}`);
  console.log(`   Expires: ${expires_at}`);
  console.log(`   Token (first 50 chars): ${token.substring(0, 50)}...\n`);

  // Step 6: Decode JWT to show claims
  console.log('📝 Step 6: Decoding JWT claims...');
  const tokenParts = token.split('.');
  const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
  console.log('✅ JWT Claims:');
  console.log(JSON.stringify(payload, null, 2));
  console.log();

  // Step 7: Test remote signer (if available)
  console.log('📝 Step 7: Testing remote signer...');
  try {
    const signerResponse = await fetch(`${REMOTE_SIGNER_URL}/sign-orchestrator-info`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (signerResponse.ok) {
      const signerData = await signerResponse.json();
      console.log('✅ Remote signer response:');
      console.log(JSON.stringify(signerData, null, 2));
    } else {
      console.log(`⚠️  Remote signer not available or returned error: ${signerResponse.status}`);
      console.log(`   This is expected if remote signer is not running.`);
    }
  } catch (error) {
    console.log(`⚠️  Could not connect to remote signer at ${REMOTE_SIGNER_URL}`);
    console.log(`   This is expected if remote signer is not running.`);
  }

  console.log('\n✨ Demo complete!\n');
  console.log('📚 Next steps:');
  console.log('   1. Use this JWT to authenticate API calls to go-livepeer remote signer');
  console.log('   2. Store the JWT securely (e.g., in browser localStorage)');
  console.log('   3. Refresh the JWT before it expires (8 hours by default)');
  console.log('   4. Use the JWT in Authorization header: Bearer <token>\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
