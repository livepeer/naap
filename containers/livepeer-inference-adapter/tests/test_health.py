"""Tests for the health monitor module."""

import asyncio
import pytest
from aiohttp import ClientSession
from aioresponses import aioresponses

from livepeer_adapter.config import AdapterConfig
from livepeer_adapter.health import HealthMonitor, HealthState


def make_config(**overrides) -> AdapterConfig:
    defaults = dict(
        orch_url="http://localhost:7935",
        orch_secret="test-secret",
        capability_name="test-model",
        backend_url="http://localhost:8080",
        health_check_interval=1,  # Fast for testing
    )
    defaults.update(overrides)
    return AdapterConfig(**defaults)


class TestHealthMonitor:
    """Tests for HealthMonitor."""

    @pytest.fixture
    async def session(self):
        s = ClientSession()
        yield s
        await s.close()

    async def test_check_health_returns_true_on_200(self, session):
        config = make_config()
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        with aioresponses() as m:
            m.get("http://localhost:8080/health", status=200)

            result = await monitor.check_health()
            assert result is True

        await monitor.close()

    async def test_check_health_returns_false_on_500(self, session):
        config = make_config()
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        with aioresponses() as m:
            m.get("http://localhost:8080/health", status=500)

            result = await monitor.check_health()
            assert result is False

        await monitor.close()

    async def test_check_health_returns_false_on_connection_error(self, session):
        config = make_config(backend_url="http://unreachable:8080")
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        with aioresponses() as m:
            m.get("http://unreachable:8080/health", exception=ConnectionError("refused"))

            result = await monitor.check_health()
            assert result is False

        await monitor.close()

    async def test_initial_state_is_waiting(self, session):
        config = make_config()
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        assert monitor.state == HealthState.WAITING

        await monitor.close()

    async def test_wait_for_healthy_succeeds(self, session):
        config = make_config()
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        with aioresponses() as m:
            m.get("http://localhost:8080/health", status=200)

            result = await monitor.wait_for_healthy(max_wait=5)
            assert result is True
            assert monitor.state == HealthState.HEALTHY

        await monitor.close()

    async def test_wait_for_healthy_times_out(self, session):
        config = make_config(health_check_interval=1)
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        with aioresponses() as m:
            m.get("http://localhost:8080/health", status=500, repeat=True)

            result = await monitor.wait_for_healthy(max_wait=2)
            assert result is False

        await monitor.close()

    async def test_monitor_calls_on_unhealthy(self, session):
        config = make_config(health_check_interval=1)
        on_healthy = AsyncMock()
        on_unhealthy = AsyncMock()
        monitor = HealthMonitor(config, on_healthy=on_healthy, on_unhealthy=on_unhealthy, session=session)

        # Start as healthy
        monitor._state = HealthState.HEALTHY

        with aioresponses() as m:
            m.get("http://localhost:8080/health", status=500, repeat=True)

            await monitor.start()
            await asyncio.sleep(1.5)
            await monitor.stop()

            on_unhealthy.assert_called()
            assert monitor.state == HealthState.UNHEALTHY

        await monitor.close()

    async def test_monitor_calls_on_healthy_after_recovery(self, session):
        config = make_config(health_check_interval=1)
        on_healthy = AsyncMock()
        on_unhealthy = AsyncMock()
        monitor = HealthMonitor(config, on_healthy=on_healthy, on_unhealthy=on_unhealthy, session=session)

        # Start as unhealthy
        monitor._state = HealthState.UNHEALTHY

        with aioresponses() as m:
            m.get("http://localhost:8080/health", status=200, repeat=True)

            await monitor.start()
            await asyncio.sleep(1.5)
            await monitor.stop()

            on_healthy.assert_called()
            assert monitor.state == HealthState.HEALTHY

        await monitor.close()

    async def test_custom_health_path(self, session):
        config = make_config(backend_health_path="/healthz")
        monitor = HealthMonitor(config, on_healthy=AsyncMock(), on_unhealthy=AsyncMock(), session=session)

        with aioresponses() as m:
            m.get("http://localhost:8080/healthz", status=200)

            result = await monitor.check_health()
            assert result is True

        await monitor.close()


class AsyncMock:
    """Simple async mock for callbacks."""

    def __init__(self):
        self.call_count = 0
        self.called = False

    async def __call__(self):
        self.call_count += 1
        self.called = True

    def assert_called(self):
        assert self.called, "Expected to be called but was not"
