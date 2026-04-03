/**
 * Express-side cron scheduler for local dev + Docker
 * Uses setInterval for simplicity (no node-cron dependency needed)
 */

import { snapshotStaking } from './snapshotStaking.js';
import { fetchPrices } from './fetchPrices.js';
import { checkAlerts } from './checkAlerts.js';
import { updateUnbonding } from './updateUnbonding.js';
import { syncOrchestrators } from './syncOrchestrators.js';
import { syncNetworkSnapshot } from './syncNetworkSnapshot.js';
import { syncCapabilities } from './syncCapabilities.js';
import { monthlySnapshot } from './monthlySnapshot.js';
import { confirmTransactions } from './confirmTransactions.js';

const THIRTY_SECONDS = 30 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const SIX_HOURS = 6 * ONE_HOUR;
const ONE_DAY = 24 * ONE_HOUR;

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

  // Sync orchestrators + network snapshot hourly (guards for round change internally)
  intervals.push(setInterval(async () => {
    try { await syncOrchestrators(); } catch (e) { console.error('[scheduler] syncOrchestrators error:', e); }
  }, ONE_HOUR));

  intervals.push(setInterval(async () => {
    try { await syncNetworkSnapshot(); } catch (e) { console.error('[scheduler] syncNetworkSnapshot error:', e); }
  }, ONE_HOUR));

  // Sync capabilities every 6 hours
  intervals.push(setInterval(async () => {
    try { await syncCapabilities(); } catch (e) { console.error('[scheduler] syncCapabilities error:', e); }
  }, SIX_HOURS));

  // Monthly snapshot check daily
  intervals.push(setInterval(async () => {
    try { await monthlySnapshot(); } catch (e) { console.error('[scheduler] monthlySnapshot error:', e); }
  }, ONE_DAY));

  // Confirm pending transactions every 30 seconds
  intervals.push(setInterval(async () => {
    try { await confirmTransactions(); } catch (e) { console.error('[scheduler] confirmTransactions error:', e); }
  }, THIRTY_SECONDS));

  // Initial sync (delayed 10s to let DB connect)
  setTimeout(async () => {
    try { await fetchPrices(); } catch (e) { console.error('[scheduler] initial fetchPrices error:', e); }
    try { await updateUnbonding(); } catch (e) { console.error('[scheduler] initial updateUnbonding error:', e); }
    try { await syncOrchestrators(); } catch (e) { console.error('[scheduler] initial syncOrchestrators error:', e); }
    try { await syncNetworkSnapshot(); } catch (e) { console.error('[scheduler] initial syncNetworkSnapshot error:', e); }
    try { await syncCapabilities(); } catch (e) { console.error('[scheduler] initial syncCapabilities error:', e); }
    try { await monthlySnapshot(); } catch (e) { console.error('[scheduler] initial monthlySnapshot error:', e); }
  }, 10000);
}

export function stopScheduler(): void {
  intervals.forEach(clearInterval);
  intervals = [];
  console.log('[scheduler] Cron jobs stopped');
}
