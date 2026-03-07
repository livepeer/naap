/**
 * useRoundCountdown - Real-time countdown to a target round
 */

import { useState, useEffect, useMemo } from 'react';

interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  percentComplete: number;
  isReady: boolean;
  totalSeconds: number;
}

const SECONDS_PER_BLOCK = 0.25; // Arbitrum ~250ms block time

export function useRoundCountdown(
  currentRound: number,
  targetRound: number,
  roundLength: number = 5760
): CountdownState {
  const [now, setNow] = useState(Date.now());

  // Rounds remaining (can be 0 or negative if ready)
  const roundsRemaining = useMemo(
    () => Math.max(0, targetRound - currentRound),
    [currentRound, targetRound]
  );

  const isReady = roundsRemaining <= 0;

  // Estimate total seconds remaining
  const totalSeconds = useMemo(
    () => Math.max(0, roundsRemaining * roundLength * SECONDS_PER_BLOCK),
    [roundsRemaining, roundLength]
  );

  // Tick every second when not ready
  useEffect(() => {
    if (isReady) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isReady]);

  // Calculate breakdown from total seconds
  const countdown = useMemo(() => {
    if (isReady) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, percentComplete: 100, isReady: true, totalSeconds: 0 };
    }

    // Subtract elapsed time since last update
    const elapsed = Math.floor((Date.now() - now) / 1000);
    const remaining = Math.max(0, totalSeconds - elapsed);

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = Math.floor(remaining % 60);

    // Calculate total rounds in the unbonding period for percentage
    const totalRounds = targetRound - (currentRound - roundsRemaining);
    const percentComplete = totalRounds > 0
      ? Math.min(100, ((totalRounds - roundsRemaining) / totalRounds) * 100)
      : 100;

    return { days, hours, minutes, seconds, percentComplete, isReady: false, totalSeconds: remaining };
  }, [now, isReady, totalSeconds, currentRound, targetRound, roundsRemaining]);

  return countdown;
}
