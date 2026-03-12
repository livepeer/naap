"""Health monitor -- polls the backend health endpoint and manages registration state."""

from __future__ import annotations

import asyncio
import logging
from enum import Enum
from typing import Optional, Callable, Awaitable

import aiohttp

from .config import AdapterConfig

logger = logging.getLogger(__name__)


class HealthState(Enum):
    WAITING = "WAITING"
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"


class HealthMonitor:
    """Monitors backend health and triggers registration/unregistration callbacks."""

    def __init__(
        self,
        config: AdapterConfig,
        on_healthy: Callable[[], Awaitable[None]],
        on_unhealthy: Callable[[], Awaitable[None]],
        session: Optional[aiohttp.ClientSession] = None,
    ) -> None:
        self._config = config
        self._on_healthy = on_healthy
        self._on_unhealthy = on_unhealthy
        self._session = session
        self._owns_session = session is None
        self._state = HealthState.WAITING
        self._task: Optional[asyncio.Task] = None

    @property
    def state(self) -> HealthState:
        return self._state

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
            self._owns_session = True
        return self._session

    async def check_health(self) -> bool:
        """Check if the backend is healthy. Returns True if healthy."""
        session = await self._get_session()
        url = f"{self._config.backend_url}{self._config.backend_health_path}"

        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return resp.status >= 200 and resp.status < 300
        except Exception:
            return False

    async def wait_for_healthy(self, max_wait: int = 300) -> bool:
        """Wait for the backend to become healthy, polling every health_check_interval.

        Returns True if backend became healthy within max_wait seconds.
        """
        elapsed = 0
        interval = self._config.health_check_interval

        logger.info("Waiting for backend at %s%s to become healthy...", self._config.backend_url, self._config.backend_health_path)

        while elapsed < max_wait:
            if await self.check_health():
                logger.info("Backend is healthy after %ds", elapsed)
                self._state = HealthState.HEALTHY
                return True

            await asyncio.sleep(interval)
            elapsed += interval
            logger.debug("Backend not yet healthy (%d/%ds)", elapsed, max_wait)

        logger.error("Backend did not become healthy within %ds", max_wait)
        return False

    async def start(self) -> None:
        """Start the health monitoring loop."""
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._monitor_loop())

    async def stop(self) -> None:
        """Stop the health monitoring loop."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _monitor_loop(self) -> None:
        """Continuously monitor backend health and trigger state transitions."""
        while True:
            await asyncio.sleep(self._config.health_check_interval)

            healthy = await self.check_health()
            prev_state = self._state

            if healthy and self._state != HealthState.HEALTHY:
                self._state = HealthState.HEALTHY
                logger.info("Backend recovered (was %s)", prev_state.value)
                await self._on_healthy()

            elif not healthy and self._state == HealthState.HEALTHY:
                self._state = HealthState.UNHEALTHY
                logger.warning("Backend became unhealthy")
                await self._on_unhealthy()

    async def close(self) -> None:
        """Clean up resources."""
        await self.stop()
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()
