#!/usr/bin/env bash
# One-shot setup for Grandma AI's local, no-API-key AI engine (Ollama).
# Run this on whatever machine will actually run `server/` (your laptop
# for local dev, or the host you deploy the backend to).
#
#   npm run ollama:setup
#
# Installs Ollama if it isn't already, makes sure the daemon is running,
# then pulls the two models the app uses:
#   - llama3.1  (chat + tool-calling: tasks, recipes, grocery lists, memory)
#   - llava     (vision, for Family Cookbook handwritten-recipe digitization)
#
# Safe to re-run - every step checks whether it's already done first.
set -euo pipefail

OLLAMA_HOST_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"

echo "== Grandma AI: Ollama setup =="

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama is already installed."
else
  echo "Ollama not found - installing..."
  case "$(uname -s)" in
    Linux*)
      curl -fsSL https://ollama.com/install.sh | sh
      ;;
    Darwin*)
      if command -v brew >/dev/null 2>&1; then
        brew install ollama
      else
        echo ""
        echo "Homebrew isn't installed, so this script can't install Ollama automatically."
        echo "Download the macOS app from https://ollama.com/download, install it (it starts"
        echo "automatically), then re-run: npm run ollama:setup"
        exit 1
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo ""
      echo "This script can't install Ollama automatically on Windows."
      echo "Download and run the installer from https://ollama.com/download,"
      echo "then re-run this script (from Git Bash / WSL) to pull the models: npm run ollama:setup"
      exit 1
      ;;
    *)
      echo ""
      echo "Unrecognized OS ($(uname -s)). Install Ollama manually from https://ollama.com/download,"
      echo "then re-run this script to pull the models."
      exit 1
      ;;
  esac
fi

echo "Checking whether the Ollama daemon is running at ${OLLAMA_HOST_URL}..."
if ! curl -fsS "${OLLAMA_HOST_URL}/api/version" >/dev/null 2>&1; then
  echo "Starting it..."
  (nohup ollama serve > /tmp/ollama-serve.log 2>&1 &)
  for _ in $(seq 1 20); do
    if curl -fsS "${OLLAMA_HOST_URL}/api/version" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -fsS "${OLLAMA_HOST_URL}/api/version" >/dev/null 2>&1; then
    echo "Couldn't confirm the Ollama daemon came up - check /tmp/ollama-serve.log and try 'ollama serve' manually."
    exit 1
  fi
fi
echo "Ollama daemon is up."

echo ""
echo "Pulling llama3.1 (chat + tool-calling)... this downloads a few GB the first time."
ollama pull llama3.1

echo ""
echo "Pulling llava (handwriting photo OCR)... also a few GB the first time."
ollama pull llava

echo ""
echo "== Done =="
echo "Ollama is running at ${OLLAMA_HOST_URL} with llama3.1 and llava pulled."
echo "server/.env already defaults to AI_PROVIDER=ollama, so 'npm run dev' will use this automatically."
