#!/usr/bin/env bash
# The dev gateway's upstream: Ollama on the host, with the models infra/ai/litellm.dev.yaml
# names. Idempotent — re-running only pulls what is missing.
set -euo pipefail

MODELS=(hermes3:8b hermes3:3b)

if ! command -v ollama >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) brew install ollama ;;
    Linux) curl -fsSL https://ollama.com/install.sh | sh ;;
    *) echo "Install Ollama from https://ollama.com/download, then re-run." >&2; exit 1 ;;
  esac
fi

if ! curl -sf http://localhost:11434/api/version >/dev/null; then
  case "$(uname -s)" in
    Darwin) brew services start ollama ;;
    *) (OLLAMA_HOST=0.0.0.0 nohup ollama serve >/tmp/ollama.log 2>&1 &) ;;
  esac
  for _ in $(seq 30); do curl -sf http://localhost:11434/api/version >/dev/null && break; sleep 1; done
fi

for model in "${MODELS[@]}"; do
  ollama list | awk '{print $1}' | grep -qx "$model" || ollama pull "$model"
done

echo "Ollama is serving ${MODELS[*]} at http://localhost:11434 — 'make dev' reaches it as host.docker.internal."
