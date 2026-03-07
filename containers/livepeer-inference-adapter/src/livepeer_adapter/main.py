"""Main entry point -- wires config, health monitor, registrar, and proxy server."""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

import aiohttp

from .config import load_config, ConfigError
from .health import HealthMonitor
from .registrar import Registrar
from .proxy import ProxyServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("livepeer-adapter")


async def run() -> None:
    """Main async entry point."""
    try:
        config = load_config()
    except ConfigError as e:
        logger.error("Configuration error: %s", e)
        sys.exit(1)

    logger.info("Livepeer Inference Adapter starting")
    logger.info("  Capability: %s", config.capability_name)
    logger.info("  Orchestrator: %s", config.orch_url)
    logger.info("  Backend: %s", config.backend_url)
    logger.info("  Adapter port: %d", config.adapter_port)
    logger.info("  Capacity: %d", config.capacity)

    # Shared HTTP session for outbound requests
    session = aiohttp.ClientSession()

    registrar = Registrar(config, session=session)
    proxy = ProxyServer(config, session=session)

    async def on_healthy() -> None:
        proxy.backend_healthy = True
        await registrar.register()

    async def on_unhealthy() -> None:
        proxy.backend_healthy = False
        await registrar.unregister()

    health_monitor = HealthMonitor(config, on_healthy=on_healthy, on_unhealthy=on_unhealthy, session=session)

    # Shutdown handler
    shutdown_event = asyncio.Event()

    def handle_signal() -> None:
        logger.info("Shutdown signal received")
        shutdown_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    try:
        # Start proxy server
        await proxy.start()

        # Wait for backend to become healthy
        if not await health_monitor.wait_for_healthy():
            logger.error("Backend never became healthy. Exiting.")
            await proxy.stop()
            await session.close()
            sys.exit(1)

        # Register with orchestrator
        if not await registrar.register():
            logger.error("Initial registration failed. Exiting.")
            await proxy.stop()
            await session.close()
            sys.exit(1)

        # Start heartbeat and health monitoring
        await registrar.start_heartbeat()
        await health_monitor.start()

        logger.info("Adapter running. Serving capability '%s'", config.capability_name)

        # Wait for shutdown signal
        await shutdown_event.wait()

    finally:
        logger.info("Shutting down...")
        await health_monitor.close()
        await registrar.unregister()
        await registrar.close()
        await proxy.stop()
        if not session.closed:
            await session.close()
        logger.info("Shutdown complete")


def main() -> None:
    """Synchronous entry point."""
    asyncio.run(run())


if __name__ == "__main__":
    main()
