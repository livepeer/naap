"""Registrar module -- handles capability registration/unregistration with the BYOC orchestrator."""

from __future__ import annotations

import asyncio
import logging
import ssl
from typing import Optional

import aiohttp

from .config import AdapterConfig, CapabilityConfig

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
            # Skip SSL verification for self-signed orchestrator certs
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE
            conn = aiohttp.TCPConnector(ssl=ssl_ctx)
            self._session = aiohttp.ClientSession(connector=conn)
            self._owns_session = True
        return self._session

    async def register(self) -> bool:
        """Register all capabilities with the orchestrator.

        Returns True if all registrations succeeded.
        """
        caps = self._config.get_capabilities()
        if not caps:
            logger.error("No capabilities to register")
            return False

        session = await self._get_session()
        url = f"{self._config.orch_url}/capability/register"
        headers = {
            "Authorization": self._config.orch_secret,
            "Content-Type": "application/json",
        }

        all_ok = True
        for cap in caps:
            payload = {
                "name": cap.name,
                "url": f"{self._config.adapter_url}/inference",
                "capacity": cap.capacity,
                "price_per_unit": cap.price_per_unit,
                "price_scaling": cap.price_scaling,
                "currency": self._config.price_currency,
            }

            try:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        logger.info("Registered capability '%s' (model=%s) with orchestrator", cap.name, cap.model_id)
                    else:
                        body = await resp.text()
                        logger.error("Registration failed for '%s' (HTTP %d): %s", cap.name, resp.status, body)
                        all_ok = False
            except Exception as e:
                logger.error("Registration failed for '%s': %s", cap.name, e)
                all_ok = False

        self._registered = all_ok
        return all_ok

    async def register_one(self, cap: CapabilityConfig) -> bool:
        """Register a single capability with the orchestrator."""
        session = await self._get_session()
        url = f"{self._config.orch_url}/capability/register"
        headers = {"Authorization": self._config.orch_secret, "Content-Type": "application/json"}
        payload = {
            "name": cap.name,
            "url": f"{self._config.adapter_url}/inference",
            "capacity": cap.capacity,
            "price_per_unit": cap.price_per_unit,
            "price_scaling": cap.price_scaling,
            "currency": self._config.price_currency,
        }
        try:
            async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    logger.info("Registered capability '%s' (model=%s)", cap.name, cap.model_id)
                    return True
                body = await resp.text()
                logger.error("Registration failed for '%s' (HTTP %d): %s", cap.name, resp.status, body)
        except Exception as e:
            logger.error("Registration failed for '%s': %s", cap.name, e)
        return False

    async def unregister_one(self, name: str) -> bool:
        """Unregister a single capability from the orchestrator."""
        session = await self._get_session()
        url = f"{self._config.orch_url}/capability/unregister"
        headers = {"Authorization": self._config.orch_secret, "Content-Type": "application/json"}
        try:
            async with session.post(url, json={"name": name}, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    logger.info("Unregistered capability '%s'", name)
                    return True
                body = await resp.text()
                logger.warning("Unregistration for '%s' returned HTTP %d: %s", name, resp.status, body)
        except Exception as e:
            logger.warning("Unregistration failed for '%s': %s", name, e)
        return False

    async def unregister(self) -> bool:
        """Unregister all capabilities from the orchestrator.

        Returns True if all unregistrations succeeded.
        """
        if not self._registered:
            return True

        caps = self._config.get_capabilities()
        session = await self._get_session()
        url = f"{self._config.orch_url}/capability/unregister"
        headers = {
            "Authorization": self._config.orch_secret,
            "Content-Type": "application/json",
        }

        all_ok = True
        for cap in caps:
            try:
                async with session.post(url, json={"name": cap.name}, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        logger.info("Unregistered capability '%s'", cap.name)
                    else:
                        body = await resp.text()
                        logger.warning("Unregistration for '%s' returned HTTP %d: %s", cap.name, resp.status, body)
                        all_ok = False
            except Exception as e:
                logger.warning("Unregistration failed for '%s': %s", cap.name, e)
                all_ok = False

        self._registered = not all_ok
        return all_ok

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
