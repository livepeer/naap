/**
 * WalletAddress CRUD operations
 */

import { prisma } from '../db/client.js';

export async function listAddresses(userId: string) {
  return prisma.walletAddress.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
  });
}

export async function createAddress(
  userId: string,
  address: string,
  chainId: number,
  label?: string
) {
  // Check if user has any addresses — first one becomes primary
  const existing = await prisma.walletAddress.count({ where: { userId } });

  return prisma.walletAddress.create({
    data: {
      userId,
      address,
      chainId,
      label: label || null,
      isPrimary: existing === 0,
    },
  });
}

export async function updateAddress(
  id: string,
  userId: string,
  updates: { label?: string; isPrimary?: boolean }
) {
  // Verify ownership
  const addr = await prisma.walletAddress.findFirst({ where: { id, userId } });
  if (!addr) return null;

  // If setting as primary, unset other primaries first
  if (updates.isPrimary) {
    await prisma.walletAddress.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  return prisma.walletAddress.update({
    where: { id },
    data: updates,
  });
}

export async function deleteAddress(id: string, userId: string) {
  // Verify ownership
  const addr = await prisma.walletAddress.findFirst({ where: { id, userId } });
  if (!addr) return null;

  await prisma.walletAddress.delete({ where: { id } });

  // If deleted address was primary, promote the next one
  if (addr.isPrimary) {
    const next = await prisma.walletAddress.findFirst({
      where: { userId },
      orderBy: { connectedAt: 'asc' },
    });
    if (next) {
      await prisma.walletAddress.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
  }

  return addr;
}
