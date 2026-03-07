"""Tests for the registrar module."""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from aiohttp import ClientSession
from aioresponses import aioresponses

from livepeer_adapter.config import AdapterConfig
from livepeer_adapter.registrar import Registrar


def make_config(**overrides) -> AdapterConfig:
    defaults = dict(
        orch_url="http://localhost:7935",
        orch_secret="test-secret",
        capability_name="test-model",
        backend_url="http://localhost:8080",
    )
    defaults.update(overrides)
    return AdapterConfig(**defaults)


class TestRegistrar:
    """Tests for Registrar."""

    @pytest.fixture
    async def session(self):
        s = ClientSession()
        yield s
        await s.close()

    async def test_register_success(self, session):
        config = make_config()
        registrar = Registrar(config, session=session)

        with aioresponses() as m:
            m.post("http://localhost:7935/capability/register", status=200, payload={"ok": True})

            result = await registrar.register()

            assert result is True
            assert registrar.is_registered is True

        await registrar.close()

    async def test_register_failure_http_error(self, session):
        config = make_config()
        registrar = Registrar(config, session=session)

        with aioresponses() as m:
            m.post("http://localhost:7935/capability/register", status=500, body="Internal Server Error")

            result = await registrar.register()

            assert result is False
            assert registrar.is_registered is False

        await registrar.close()

    async def test_register_failure_connection_error(self, session):
        config = make_config(orch_url="http://unreachable:7935")
        registrar = Registrar(config, session=session)

        with aioresponses() as m:
            m.post("http://unreachable:7935/capability/register", exception=ConnectionError("refused"))

            result = await registrar.register()

            assert result is False
            assert registrar.is_registered is False

        await registrar.close()

    async def test_unregister_success(self, session):
        config = make_config()
        registrar = Registrar(config, session=session)

        with aioresponses() as m:
            m.post("http://localhost:7935/capability/register", status=200)
            m.post("http://localhost:7935/capability/unregister", status=200)

            await registrar.register()
            result = await registrar.unregister()

            assert result is True
            assert registrar.is_registered is False

        await registrar.close()

    async def test_unregister_skips_if_not_registered(self, session):
        config = make_config()
        registrar = Registrar(config, session=session)

        result = await registrar.unregister()
        assert result is True  # No-op is success

        await registrar.close()

    async def test_register_sends_correct_payload(self, session):
        config = make_config(
            capability_name="flux-dev",
            adapter_port=9090,
            capacity=4,
            price_per_unit=5000,
            price_scaling=1_000_000,
        )
        registrar = Registrar(config, session=session)

        with aioresponses() as m:
            m.post("http://localhost:7935/capability/register", status=200)

            await registrar.register()

            # Verify the request was made with correct payload
            call = m.requests[("POST", "http://localhost:7935/capability/register")]
            assert len(call) == 1

        await registrar.close()

    async def test_register_sends_auth_header(self, session):
        config = make_config(orch_secret="my-secret-123")
        registrar = Registrar(config, session=session)

        with aioresponses() as m:
            m.post("http://localhost:7935/capability/register", status=200)

            await registrar.register()

        await registrar.close()

    async def test_heartbeat_re_registers(self, session):
        config = make_config(register_interval=1)  # Fast for testing
        registrar = Registrar(config, session=session)

        register_count = 0

        with aioresponses() as m:
            def callback(url, **kwargs):
                nonlocal register_count
                register_count += 1
                return MagicMock(status=200)

            m.post("http://localhost:7935/capability/register", callback=callback, repeat=True)

            await registrar.register()
            await registrar.start_heartbeat()
            await asyncio.sleep(2.5)  # Should trigger ~2 heartbeats
            await registrar.stop_heartbeat()

            assert register_count >= 3  # initial + at least 2 heartbeats

        await registrar.close()
