/**
 * AI recommendation routes (S19)
 */

import { Router, Request, Response } from 'express';
import { getRecommendations, type RecommendationProfile } from '../lib/aiRecommendService.js';

const router = Router();

router.post('/api/v1/wallet/ai/recommend', async (req: Request, res: Response) => {
  try {
    const { userId, profile, limit = 5 } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const defaultProfile: RecommendationProfile = {
      riskTolerance: 'moderate',
      targetYield: 'medium',
      diversify: true,
    };

    const recommendations = await getRecommendations(
      userId,
      { ...defaultProfile, ...profile },
      limit,
    );

    res.json({ data: recommendations });
  } catch (error: any) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
