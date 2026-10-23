"""
Open-weight model for Ask AI and the Slack assistant, served by vLLM on Modal.

It exposes an OpenAI-compatible API (/v1/chat/completions) behind a bearer
key, scales to zero when idle, and boots again on the next request (the first
question after a quiet spell waits for it). The app talks to it when these
Vercel env vars are set (see src/lib/llm.ts):

  LLM_BASE_URL  https://<workspace>--prompt-library-llm-server.modal.run/v1
  LLM_API_KEY   the same value as the Modal secret below
  LLM_MODEL     llm

Deploy (from a machine with the Modal CLI, signed in to your workspace):

  modal secret create prompt-library-llm LLM_API_KEY=<a long random string>
  modal deploy infra/modal/llm.py
  modal run infra/modal/llm.py     # optional: boots it and sends a test question

Model and GPU: openai/gpt-oss-20b on one A100 40GB. vLLM supports gpt-oss on
Ampere and Hopper (not Ada yet). To use a bigger model, change MODEL_NAME and
GPU together.
"""

import modal

MODEL_NAME = "openai/gpt-oss-20b"
SERVED_NAME = "llm"
GPU = "A100-40GB"
VLLM_PORT = 8000
MINUTES = 60

vllm_image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install("vllm==0.21.0")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)

hf_cache_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("vllm-cache", create_if_missing=True)

app = modal.App("prompt-library-llm")


@app.server(
    image=vllm_image,
    gpu=GPU,
    # Stay up this long after the last request, then scale to zero (no charge while down).
    scaledown_window=10 * MINUTES,
    startup_timeout=10 * MINUTES,
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
    secrets=[modal.Secret.from_name("prompt-library-llm")],
    port=VLLM_PORT,
    target_concurrency=32,
    # Public URL, but vLLM rejects any request without the bearer key (--api-key).
    unauthenticated=True,
)
class Server:
    @modal.enter()
    def start(self):
        import os
        import subprocess

        cmd = [
            "vllm",
            "serve",
            MODEL_NAME,
            "--served-model-name",
            SERVED_NAME,
            "--host",
            "0.0.0.0",
            "--port",
            str(VLLM_PORT),
            "--api-key",
            os.environ["LLM_API_KEY"],
            # Faster boots from zero at a small cost to generation speed.
            "--enforce-eager",
            "--tensor-parallel-size",
            "1",
        ]
        self.process = subprocess.Popen(cmd)

    @modal.exit()
    def stop(self):
        self.process.terminate()


@app.local_entrypoint()
async def test():
    """Boot the server and ask one question: `modal run infra/modal/llm.py`."""
    import os
    import time

    import aiohttp

    key = os.environ.get("LLM_API_KEY", "")
    url = await Server.get_url.aio()
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    async with aiohttp.ClientSession(base_url=url, headers=headers) as session:
        deadline = time.time() + 10 * MINUTES
        while time.time() < deadline:
            async with session.get("/health") as resp:
                if resp.status == 200:
                    break
            time.sleep(2)
        payload = {
            "model": SERVED_NAME,
            "messages": [{"role": "user", "content": "In one sentence, what is a Clay formula?"}],
        }
        async with session.post("/v1/chat/completions", json=payload) as resp:
            print(resp.status, await resp.text())
