/**
 * Express routes for wallet address CRUD
 */

import { Router, Request, Response } from 'express';
import { listAddresses, createAddress, updateAddress, deleteAddress } from '../lib/addressService.js';
import { validateAddressInput } from '../lib/validators.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const addresses = await listAddresses(userId);
    res.json({ addresses });
  } catch (err) {
    console.error('Error fetching addresses:', err);
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, address, chainId, label } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const validationError = validateAddressInput({ address, chainId, label });
    if (validationError) return res.status(400).json({ error: validationError });

    const walletAddress = await createAddress(userId, address, chainId, label);
    res.json({ address: walletAddress });
  } catch (err) {
    console.error('Error creating address:', err);
    res.status(500).json({ error: 'Failed to create address' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { userId, label, isPrimary } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const updated = await updateAddress(req.params.id, userId, { label, isPrimary });
    if (!updated) return res.status(404).json({ error: 'Address not found' });

    res.json({ address: updated });
  } catch (err) {
    console.error('Error updating address:', err);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const deleted = await deleteAddress(req.params.id, userId);
    if (!deleted) return res.status(404).json({ error: 'Address not found' });

    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting address:', err);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

export default router;
