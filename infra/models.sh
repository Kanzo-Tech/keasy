#!/bin/sh
# Download the model the page runs (web/src/lib/ai.ts) once, into the directory keasy's own origin
# serves at /models (compose.yaml's `models`): its MLC weights from Hugging Face at a pinned revision,
# and its compiled library from WebLLM's binary-mlc-llm-libs at a pinned commit. Laid out as the page
# reads them under KEASY_MODEL_URL:
#
#   <dir>/<model>/resolve/<revision>/...    the weights, as Hugging Face lays a revision out
#   <dir>/lib/<webllm>/<library>            the library, by the WebLLM release it was compiled for
#
# Every file is checked: a weight against the digest the pinned revision's tree gives it (the LFS
# sha256, or the git blob's sha1), the library against the sha256 below. A second run is a no-op.
# web/src/lib/ai.test.ts holds these pins to the page's, and the WebLLM release to the one installed.
#
#   sh infra/models.sh [dir]     dir defaults to $KEASY_MODELS, else infra/models (gitignored)
set -eu

model=Qwen3-4B-q4f16_1-MLC
revision=a5c9fab855e3ccbdfed2e7e69683d75f30332161
webllm=v0_2_86
library=Qwen3-4B-q4f16_1_cs1k-webgpu.wasm
libs=00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0
library_sha256=678f9537c7388113e28141ef7a8e416cc600e72a7cf2ea7aac0e045659d3ecbd

here=$(cd "$(dirname "$0")" && pwd)
dir=${1:-${KEASY_MODELS:-$here/models}}
weights="$dir/$model/resolve/$revision"
lib="$dir/lib/$webllm/$library"

for tool in curl python3; do
  command -v "$tool" >/dev/null || { echo "models: needs $tool" >&2; exit 1; }
done

if [ -f "$weights/.complete" ] && [ -f "$lib" ]; then
  echo "models: $model already in $dir"
  exit 0
fi

mkdir -p "$weights" "$(dirname "$lib")"
echo "models: $model at $revision (about 2.3 GB) into $dir"

# The revision's tree is fixed by its commit: what it lists is what is downloaded and checked.
curl -fsSL --retry 5 --retry-all-errors "https://huggingface.co/api/models/mlc-ai/$model/tree/$revision" \
  | python3 -I -c '
import hashlib, json, os, subprocess, sys

model, revision, weights = sys.argv[1:]
for entry in json.load(sys.stdin):
    path = entry["path"]
    if entry["type"] != "file" or path in (".gitattributes", "README.md"):
        continue
    target = os.path.join(weights, path)
    lfs = entry.get("lfs")
    def digest():
        with open(target, "rb") as f:
            data = f.read()
        if lfs:
            return hashlib.sha256(data).hexdigest() == lfs["oid"]
        return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest() == entry["oid"]
    if os.path.exists(target) and digest():
        continue
    url = f"https://huggingface.co/mlc-ai/{model}/resolve/{revision}/{path}"
    print(f"models: {path}", flush=True)
    subprocess.run(["curl", "-fsSL", "--retry", "5", "--retry-all-errors", "-o", target + ".part", url], check=True)
    os.replace(target + ".part", target)
    if not digest():
        sys.exit(f"models: {path} does not match revision {revision}")
' "$model" "$revision" "$weights"

curl -fsSL --retry 5 --retry-all-errors -o "$lib.part" \
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/$libs/web-llm-models/$webllm/base/$library"
python3 -I -c '
import hashlib, sys
path, expected = sys.argv[1:]
with open(path, "rb") as f:
    if hashlib.sha256(f.read()).hexdigest() != expected:
        sys.exit(f"models: the library does not match its sha256 {expected}")
' "$lib.part" "$library_sha256"
mv "$lib.part" "$lib"

touch "$weights/.complete"
echo "models: done — KEASY_MODEL_URL=/models serves it"
