"""Abstract base class for inference providers."""

from __future__ import annotations

import abc

import aiohttp


class InferenceProvider(abc.ABC):
    """Base class that all inference providers must implement."""

    @abc.abstractmethod
    async def health(self) -> bool:
        """Check if the provider endpoint is reachable and healthy."""

    @abc.abstractmethod
    async def inference(self, request_body: dict, session: aiohttp.ClientSession) -> dict:
        """Run an inference request against the provider.

        Args:
            request_body: The JSON request body from the caller.
            session: A shared aiohttp client session.

        Returns:
            The provider response as a dictionary.
        """
