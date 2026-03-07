/**
 * Express-side cron scheduler for local dev + Docker
 * Uses setInterval for simplicity (no node-cron dependency needed)
 */

import { snapshotStaking } from './snapshotStaking.js';
import { fetchPrices } from './fetchPrices.js';
import { checkAlerts } from './checkAlerts.js';
import { updateUnbonding } from './updateUnbonding.js';

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

let intervals: ReturnType<typeof setInterval>[] = [];

export function startScheduler(): void {
  console.log('[scheduler] Starting cron jobs...');

  // Fetch prices every 5 minutes
  intervals.push(setInterval(async () => {
    try { await fetchPrices(); } catch (e) { console.error('[scheduler] fetchPrices error:', e); }
  }, FIVE_MINUTES));

  // Update unbonding locks every 5 minutes
  intervals.push(setInterval(async () => {
    try { await updateUnbonding(); } catch (e) { console.error('[scheduler] updateUnbonding error:', e); }
  }, FIVE_MINUTES));

  // Snapshot staking every hour
  intervals.push(setInterval(async () => {
    try { await snapshotStaking(); } catch (e) { console.error('[scheduler] snapshotStaking error:', e); }
  }, ONE_HOUR));

  // Check alerts every 5 minutes
  intervals.push(setInterval(async () => {
    try { await checkAlerts(); } catch (e) { console.error('[scheduler] checkAlerts error:', e); }
  }, FIVE_MINUTES));

  // Run initial fetch
  setTimeout(async () => {
    try { await fetchPrices(); } catch (e) { console.error('[scheduler] initial fetchPrices error:', e); }
    try { await updateUnbonding(); } catch (e) { console.error('[scheduler] initial updateUnbonding error:', e); }
  }, 5000);
}

export function stopScheduler(): void {
  intervals.forEach(clearInterval);
  intervals = [];
  console.log('[scheduler] Cron jobs stopped');
}
