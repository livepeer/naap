"""Registrar module -- handles capability registration/unregistration with the BYOC orchestrator."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import aiohttp

from .config import AdapterConfig

logger = logging.getLogger(__name__)


class Registrar:
    """Manages capability lifecycle with a Livepeer BYOC orchestrator."""

    def __init__(self, config: AdapterConfig, session: Optional[aiohttp.ClientSession] = None) -> None:
        self._config = config
        self._session = session
        self._owns_session = session is None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._registered = False

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
            self._owns_session = True
        return self._session

    async def register(self) -> bool:
        """Register this adapter's capability with the orchestrator.

        Returns True if registration succeeded, False otherwise.
        """
        session = await self._get_session()
        url = f"{self._config.orch_url}/capability/register"

        payload = {
            "name": self._config.capability_name,
            "url": f"http://localhost:{self._config.adapter_port}/inference",
            "capacity": self._config.capacity,
            "price": {
                "pricePerUnit": self._config.price_per_unit,
                "pixelsPerUnit": self._config.price_scaling,
            },
        }

        headers = {
            "Authorization": self._config.orch_secret,
            "Content-Type": "application/json",
        }

        try:
            async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    self._registered = True
                    logger.info("Registered capability '%s' with orchestrator at %s", self._config.capability_name, self._config.orch_url)
                    return True
                else:
                    body = await resp.text()
                    logger.error("Registration failed (HTTP %d): %s", resp.status, body)
                    return False
        except Exception as e:
            logger.error("Registration failed: %s", e)
            return False

    async def unregister(self) -> bool:
        """Unregister this adapter's capability from the orchestrator.

        Returns True if unregistration succeeded, False otherwise.
        """
        if not self._registered:
            return True

        session = await self._get_session()
        url = f"{self._config.orch_url}/capability/unregister"

        headers = {
            "Authorization": self._config.orch_secret,
            "Content-Type": "application/json",
        }

        try:
            async with session.post(url, json={"name": self._config.capability_name}, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    self._registered = False
                    logger.info("Unregistered capability '%s'", self._config.capability_name)
                    return True
                else:
                    body = await resp.text()
                    logger.warning("Unregistration returned HTTP %d: %s", resp.status, body)
                    return False
        except Exception as e:
            logger.warning("Unregistration failed: %s", e)
            return False

    async def start_heartbeat(self) -> None:
        """Start periodic re-registration heartbeat."""
        if self._heartbeat_task is not None:
            return
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        """Stop the heartbeat loop."""
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

    async def _heartbeat_loop(self) -> None:
        """Re-register periodically to cover orchestrator restarts."""
        while True:
            await asyncio.sleep(self._config.register_interval)
            if self._registered:
                await self.register()

    @property
    def is_registered(self) -> bool:
        return self._registered

    async def close(self) -> None:
        """Clean up resources."""
        await self.stop_heartbeat()
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()
