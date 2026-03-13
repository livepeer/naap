"""Proxy server -- receives requests from the orchestrator and forwards them to the inference backend."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Optional

from aiohttp import web, ClientSession, ClientTimeout

import json

from .config import AdapterConfig, CapabilityConfig

logger = logging.getLogger(__name__)


class TrainingJob:
    """Tracks the state of an async training job."""
    def __init__(self, job_id: str, model_id: str, capability: str) -> None:
        self.job_id = job_id
        self.model_id = model_id
        self.capability = capability
        self.status = "submitted"
        self.progress = 0
        self.provider_request_id = None
        self.result = None
        self.error = None
        self.created_at = time.time()
        self.updated_at = time.time()
        self.callback_url = None

    def to_dict(self) -> dict:
        d = {
            "job_id": self.job_id, "model_id": self.model_id,
            "capability": self.capability, "status": self.status,
            "progress": self.progress, "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if self.provider_request_id: d["provider_request_id"] = self.provider_request_id
        if self.result: d["result"] = self.result
        if self.error: d["error"] = self.error
        return d



class ProxyServer:
    """HTTP server that proxies inference requests to the backend."""

    def __init__(self, config: AdapterConfig, session: Optional[ClientSession] = None,
                 registrar=None) -> None:
        self._config = config
        self._session = session
        self._owns_session = session is None
        self._registrar = registrar
        self._app = web.Application()
        self._app.router.add_get("/health", self._handle_health)
        self._app.router.add_get("/capabilities", self._handle_list_capabilities)
        self._app.router.add_post("/capabilities", self._handle_add_capability)
        self._app.router.add_delete("/capabilities/{name}", self._handle_remove_capability)
        self._app.router.add_post("/inference", self._handle_inference)
        self._app.router.add_post("/train", self._handle_train_async)
        self._app.router.add_get("/train", self._handle_train_list)
        self._app.router.add_get("/train/{job_id}", self._handle_train_status)
        self._app.router.add_post("/train/{job_id}/cancel", self._handle_train_cancel)
        self._app.router.add_post("/inference/{path:.*}", self._handle_inference)
        self._runner: Optional[web.AppRunner] = None
        self._backend_healthy = False
        self._training_jobs = {}
        self._training_tasks = {}

    @property
    def app(self) -> web.Application:
        return self._app

    @property
    def backend_healthy(self) -> bool:
        return self._backend_healthy

    @backend_healthy.setter
    def backend_healthy(self, value: bool) -> None:
        self._backend_healthy = value

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            self._session = ClientSession()
            self._owns_session = True
        return self._session

    async def _handle_health(self, request: web.Request) -> web.Response:
        """Health endpoint -- returns 200 if backend is healthy, 503 otherwise."""
        if self._backend_healthy:
            return web.json_response({"status": "healthy", "capability": self._config.capability_name})
        return web.json_response({"status": "unhealthy"}, status=503)

    async def _handle_inference(self, request: web.Request) -> web.StreamResponse:
        """Forward inference request to backend, streaming SSE if applicable.

        For multi-capability mode, resolves the model_id from the capability
        name in the URL path and passes it to the backend proxy.
        """
        session = await self._get_session()

        # Extract capability/path info from URL
        extra_path = request.match_info.get("path", "")

        # Resolve model_id from capability name if multi-capability
        model_id = None
        if extra_path:
            model_id = self._config.get_model_for_capability(extra_path)

        # Build backend URL with model_id in path for multi-model proxy
        if model_id:
            backend_url = f"{self._config.backend_url}{self._config.backend_inference_path}/{model_id}"
        elif extra_path:
            backend_url = f"{self._config.backend_url}{self._config.backend_inference_path}/{extra_path}"
        else:
            backend_url = f"{self._config.backend_url}{self._config.backend_inference_path}"

        logger.info("Forwarding to backend: %s (path=%s, model=%s)", backend_url, extra_path, model_id)

        # Read request body
        body = await request.read()

        # Forward headers (Content-Type, Accept, etc.) but not Livepeer-specific ones
        forward_headers = {}
        for header in ("Content-Type", "Accept", "Authorization"):
            if header in request.headers:
                forward_headers[header] = request.headers[header]

        timeout = ClientTimeout(total=self._config.backend_timeout)

        try:
            async with session.post(backend_url, data=body, headers=forward_headers, timeout=timeout) as resp:
                content_type = resp.headers.get("Content-Type", "")

                # SSE streaming response
                if "text/event-stream" in content_type:
                    response = web.StreamResponse(
                        status=resp.status,
                        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
                    )
                    await response.prepare(request)

                    async for chunk in resp.content.iter_any():
                        await response.write(chunk)

                    await response.write_eof()
                    return response

                # Regular response
                response_body = await resp.read()
                # Strip charset from content_type (aiohttp doesn't allow it in content_type param)
                ct = content_type.split(";")[0].strip() if content_type else "application/json"
                return web.Response(
                    body=response_body,
                    status=resp.status,
                    content_type=ct,
                )

        except Exception as e:
            logger.error("Backend request failed: %s", e)
            return web.json_response(
                {"error": "Backend request failed", "detail": str(e)},
                status=502,
            )


    # ---- Training endpoints ----
    async def _handle_train_async(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)
        model_id = body.get("model_id", "")
        capability = body.get("capability", "")
        if not model_id:
            return web.json_response({"error": "model_id is required"}, status=400)
        job_id = str(uuid.uuid4())
        job = TrainingJob(job_id=job_id, model_id=model_id, capability=capability)
        job.callback_url = body.pop("callback_url", None)
        self._training_jobs[job_id] = job
        task = asyncio.create_task(self._run_training_job(job, body))
        self._training_tasks[job_id] = task
        logger.info("Training job submitted: job_id=%s model_id=%s", job_id, model_id)
        return web.json_response({
            "job_id": job_id, "status": "submitted",
            "status_url": f"/train/{job_id}",
        }, status=202)

    async def _handle_train_status(self, request: web.Request) -> web.Response:
        job_id = request.match_info["job_id"]
        job = self._training_jobs.get(job_id)
        if not job:
            return web.json_response({"error": "Job not found"}, status=404)
        return web.json_response(job.to_dict())

    async def _handle_train_cancel(self, request: web.Request) -> web.Response:
        job_id = request.match_info["job_id"]
        job = self._training_jobs.get(job_id)
        if not job:
            return web.json_response({"error": "Job not found"}, status=404)
        if job.status in ("completed", "failed", "cancelled"):
            return web.json_response({"error": f"Job already {job.status}"}, status=400)
        task = self._training_tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        job.status = "cancelled"
        job.updated_at = time.time()
        return web.json_response({"job_id": job_id, "status": "cancelled"})

    async def _handle_train_list(self, request: web.Request) -> web.Response:
        status_filter = request.query.get("status")
        jobs = [j.to_dict() for j in self._training_jobs.values()
                if not status_filter or j.status == status_filter]
        return web.json_response({"jobs": jobs, "total": len(jobs)})

    async def _run_training_job(self, job, body):
        session = await self._get_session()
        try:
            job.status = "running"
            job.updated_at = time.time()
            submit_url = f"{self._config.backend_url}/train/submit"
            async with session.post(submit_url, json=body, timeout=ClientTimeout(total=30)) as resp:
                if resp.status not in (200, 201, 202):
                    err = await resp.text()
                    job.status = "failed"
                    job.error = f"Backend submit failed ({resp.status}): {err[:500]}"
                    job.updated_at = time.time()
                    return
                submit_result = await resp.json()
            if "error" in submit_result:
                job.status = "failed"
                job.error = submit_result.get("detail", submit_result["error"])
                job.updated_at = time.time()
                return
            job.provider_request_id = submit_result.get("request_id")
            provider_model_id = submit_result.get("model_id", job.model_id)
            if not job.provider_request_id:
                job.status = "completed"
                job.result = submit_result
                job.progress = 100
                job.updated_at = time.time()
                return
            logger.info("Training job %s: polling provider request_id=%s", job.job_id, job.provider_request_id)
            elapsed = 0
            poll_timeout = 28800
            while elapsed < poll_timeout:
                await asyncio.sleep(5)
                elapsed += 5
                try:
                    status_url = f"{self._config.backend_url}/train/status/{job.provider_request_id}?model_id={provider_model_id}"
                    async with session.get(status_url, timeout=ClientTimeout(total=15)) as resp:
                        status_data = await resp.json()
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning("Training %s: poll failed: %s", job.job_id, e)
                    continue
                provider_status = status_data.get("status", "UNKNOWN")
                job.updated_at = time.time()
                if provider_status == "COMPLETED":
                    job.status = "completed"
                    job.result = status_data
                    job.progress = 100
                    logger.info("Training %s: completed (elapsed=%ds)", job.job_id, elapsed)
                    return
                if provider_status in ("FAILED", "CANCELLED"):
                    job.status = "failed"
                    job.error = status_data.get("error", provider_status)
                    return
                if provider_status == "IN_PROGRESS":
                    job.status = "running"
                    job.progress = min(95, int(elapsed / max(poll_timeout, 1) * 100))
            job.status = "failed"
            job.error = f"Timed out after {poll_timeout}s"
            job.updated_at = time.time()
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.updated_at = time.time()
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            job.updated_at = time.time()

    def set_registrar(self, registrar) -> None:
        self._registrar = registrar

    async def _handle_list_capabilities(self, request: web.Request) -> web.Response:
        """List all registered capabilities."""
        caps = self._config.get_capabilities()
        return web.json_response({
            "capabilities": [
                {"name": c.name, "model_id": c.model_id, "capacity": c.capacity,
                 "price_per_unit": c.price_per_unit, "price_scaling": c.price_scaling}
                for c in caps
            ]
        })

    async def _handle_add_capability(self, request: web.Request) -> web.Response:
        """Add or update a capability at runtime, register with orchestrator."""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

        name = body.get("name")
        model_id = body.get("model_id")
        if not name or not model_id:
            return web.json_response({"error": "name and model_id required"}, status=400)

        cap = CapabilityConfig(
            name=name,
            model_id=model_id,
            capacity=body.get("capacity", 1),
            price_per_unit=body.get("price_per_unit", 0),
            price_scaling=body.get("price_scaling", 1_000_000),
        )

        self._config.add_capability(cap)
        self._config.save_capabilities()

        # Register with orchestrator
        if self._registrar:
            await self._registrar.register_one(cap)

        logger.info("Added capability '%s' (model=%s)", name, model_id)
        return web.json_response({"status": "added", "capability": name})

    async def _handle_remove_capability(self, request: web.Request) -> web.Response:
        """Remove a capability at runtime, unregister from orchestrator."""
        name = request.match_info["name"]

        if not self._config.remove_capability(name):
            return web.json_response({"error": f"capability '{name}' not found"}, status=404)

        self._config.save_capabilities()

        # Unregister from orchestrator
        if self._registrar:
            await self._registrar.unregister_one(name)

        logger.info("Removed capability '%s'", name)
        return web.json_response({"status": "removed", "capability": name})

    async def start(self) -> None:
        """Start the HTTP server."""
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self._config.adapter_host, self._config.adapter_port)
        await site.start()
        logger.info("Proxy server listening on %s:%d", self._config.adapter_host, self._config.adapter_port)

    async def stop(self) -> None:
        """Stop the HTTP server and clean up."""
        if self._runner:
            await self._runner.cleanup()
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()
