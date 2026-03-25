"""Main entry point -- wires config, health monitor, registrar, and proxy server."""

from __future__ import annotations

import asyncio
import logging
import signal
import ssl
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
    caps = config.get_capabilities()
    logger.info("  Capabilities: %s", [c.name for c in caps])
    logger.info("  Orchestrator: %s", config.orch_url)
    logger.info("  Backend: %s", config.backend_url)
    logger.info("  Adapter port: %d", config.adapter_port)

    # Shared HTTP session for outbound requests (skip SSL verify for self-signed orch certs)
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    conn = aiohttp.TCPConnector(ssl=ssl_ctx)
    session = aiohttp.ClientSession(connector=conn)

    registrar = Registrar(config, session=session)
    proxy = ProxyServer(config, session=session, registrar=registrar)

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

        # Backend is healthy, mark proxy as ready
        proxy.backend_healthy = True

        # Register with orchestrator (with retries for startup ordering)
        registered = False
        for attempt in range(30):
            if await registrar.register():
                registered = True
                break
            logger.warning("Registration attempt %d/30 failed, retrying in 5s...", attempt + 1)
            await asyncio.sleep(5)

        if not registered:
            logger.error("Registration failed after 30 attempts. Exiting.")
            await proxy.stop()
            await session.close()
            sys.exit(1)

        # Start heartbeat and health monitoring
        await registrar.start_heartbeat()
        await health_monitor.start()

        cap_names = [c.name for c in config.get_capabilities()]
        logger.info("Adapter running. Serving capabilities: %s", cap_names)

        # Wait for shutdown signal
        await shutdown_event.wait()

    finally:
        logger.info("Shutting down...")
        config.save_capabilities()
        logger.info("Capabilities saved to %s", config.capabilities_file)
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
