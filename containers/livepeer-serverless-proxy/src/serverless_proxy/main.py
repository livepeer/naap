"""Main entry point -- wires config, provider, and proxy server."""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

import aiohttp

from .config import load_config, ConfigError
from .server import ProxyServer, create_provider

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("serverless-proxy")


async def run() -> None:
    """Main async entry point."""
    try:
        config = load_config()
    except ConfigError as e:
        logger.error("Configuration error: %s", e)
        sys.exit(1)

    logger.info("Livepeer Serverless Proxy starting")
    logger.info("  Provider: %s", config.provider)
    logger.info("  Model ID: %s", config.model_id or "(none)")
    logger.info("  Port: %d", config.port)

    # Shared HTTP session for outbound requests
    session = aiohttp.ClientSession()

    provider = create_provider(config)
    server = ProxyServer(config, provider=provider, session=session)

    # Shutdown handler
    shutdown_event = asyncio.Event()

    def handle_signal() -> None:
        logger.info("Shutdown signal received")
        shutdown_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    try:
        await server.start()
        logger.info("Proxy running. Forwarding to provider '%s'", config.provider)

        # Wait for shutdown signal
        await shutdown_event.wait()

    finally:
        logger.info("Shutting down...")
        await server.stop()
        if not session.closed:
            await session.close()
        logger.info("Shutdown complete")


def main() -> None:
    """Synchronous entry point."""
    asyncio.run(run())


if __name__ == "__main__":
    main()
