import { describe, it, expect } from 'vitest';
import {
  isValidAddress,
  isValidChainId,
  isValidTxHash,
  isValidLabel,
  validateAddressInput,
} from '../lib/validators.js';

describe('isValidAddress', () => {
  it('accepts valid checksummed address', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(isValidAddress('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(true);
  });

  it('rejects missing 0x prefix', () => {
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidAddress('0x1234')).toBe(false);
    expect(isValidAddress('0x' + 'a'.repeat(41))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
  });
});

describe('isValidChainId', () => {
  it('accepts mainnet', () => expect(isValidChainId(1)).toBe(true));
  it('accepts arbitrum one', () => expect(isValidChainId(42161)).toBe(true));
  it('accepts goerli', () => expect(isValidChainId(5)).toBe(true));
  it('accepts arbitrum goerli', () => expect(isValidChainId(421613)).toBe(true));
  it('rejects unknown chain', () => expect(isValidChainId(999)).toBe(false));
});

describe('isValidTxHash', () => {
  it('accepts valid 64-char hex hash', () => {
    expect(isValidTxHash('0x' + 'a'.repeat(64))).toBe(true);
  });

  it('rejects short hash', () => {
    expect(isValidTxHash('0x' + 'a'.repeat(32))).toBe(false);
  });
});

describe('isValidLabel', () => {
  it('accepts short label', () => expect(isValidLabel('My Wallet')).toBe(true));
  it('rejects empty string', () => expect(isValidLabel('')).toBe(false));
  it('rejects too long label', () => expect(isValidLabel('a'.repeat(51))).toBe(false));
  it('accepts max length', () => expect(isValidLabel('a'.repeat(50))).toBe(true));
});

describe('validateAddressInput', () => {
  const validInput = {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    chainId: 42161,
  };

  it('returns null for valid input', () => {
    expect(validateAddressInput(validInput)).toBeNull();
  });

  it('returns null for valid input with label', () => {
    expect(validateAddressInput({ ...validInput, label: 'Main' })).toBeNull();
  });

  it('rejects missing address', () => {
    expect(validateAddressInput({ address: '', chainId: 42161 })).toBe('address is required');
  });

  it('rejects invalid address format', () => {
    expect(validateAddressInput({ address: '0xinvalid', chainId: 42161 })).toBe('Invalid Ethereum address format');
  });

  it('rejects unsupported chain', () => {
    expect(validateAddressInput({ ...validInput, chainId: 999 })).toBe('Unsupported chain ID');
  });

  it('rejects invalid label', () => {
    expect(validateAddressInput({ ...validInput, label: 'a'.repeat(51) })).toBe(
      'Label must be between 1 and 50 characters',
    );
  });
});
