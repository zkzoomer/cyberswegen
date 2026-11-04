# CyberSWE Daytona task generator

This controller creates a disposable Daytona sandbox from the configured CyberSWE
snapshot, asks the operator to authorize Codex with a one-time ChatGPT device login,
and runs an autonomous task-building job. A successful job returns one verified handoff
ZIP to the local `outputs/` directory.

Codex uses the operator's signed-in ChatGPT plan. The controller does not send an
OpenAI API key to Daytona and does not require separate API billing.

## Prerequisites

- Node.js 18 or newer
- A Daytona API key and the name of the prepared CyberSWE snapshot
- A ChatGPT account eligible to run the configured Codex model

Install dependencies with:

```bash
npm install
```

Copy `.env.example` to `.env` and configure:

```ini
DAYTONA_API_KEY=
DAYTONA_SNAPSHOT=cyberswe-worker-rv-0-0-151-v2
CODEX_MODEL=gpt-5.6-sol
CODEX_REASONING_EFFORT=high
LOCAL_OUTPUT_DIR=./outputs
```

Do not add `OPENAI_API_KEY`, `CODEX_API_KEY`, or a ChatGPT credential to the image,
snapshot, repository, or `.env` file.

## Authentication smoke test

Run this before the first real job:

```bash
npm run start -- \
  --advisory https://github.com/cosmos/evm/security/advisories/GHSA-7g4w-cg88-2cq2 \
  --auth-smoke
```

The controller prints a URL and one-time device code. Open the URL in your browser,
enter the code, and approve access. The sandbox then runs a one-turn Codex request,
logs out, and is deleted. It does not build or download a task.

## Real task-building job

```bash
npm run start -- \
  --advisory https://github.com/OWNER/REPOSITORY/security/advisories/GHSA-xxxx-xxxx-xxxx \
  --task-id 1234
```

Use `--focus "short approved scope"` when one advisory describes several independent
issues. `--task-id` is optional and defaults to placeholder `1`; when the real Realm ID is
known, provide it so the generated `task.toml` is immediately correct. The fixed task author is
`Sergio Martinez <sema8047@expert.micro1.ai>` and is written into every `JOB.md` automatically.
The worker names the task `<organization>-<repository>-<advisory-identifier>`, so normal
`rv submit` produces the same canonical basename with a `.zip` extension.

After device authorization, the controller streams the task-building worker's progress. On
success it verifies the remote artifact, downloads it, verifies the local SHA-256, logs Codex
out, and deletes the sandbox. The outer handoff contains the untouched `rv submit` task ZIP,
`reasoning-notes.md`, and `draft-proposal.txt`. It includes `validation-summary.md` only when a
misleading probe finding needs explanation. The worker runs `rv submit` normally and must not
delete Realm's `qc_artifacts/` first. The controller downloads the handoff; it does not rebuild
the task ZIP.

## Non-authentication dry run

```bash
npm run start -- \
  --advisory https://github.com/cosmos/evm/security/advisories/GHSA-7g4w-cg88-2cq2 \
  --dry-run
```

This tests snapshot creation, Docker, Realm Verifier configuration, ZIP validation,
download, and cleanup without authenticating or invoking Codex.

## Credential lifecycle

`codex login --device-auth` stores a renewable login only inside the newly created
sandbox. The controller removes that login with `codex logout` before normal deletion.
Failed and interrupted jobs destroy their sandbox instead of retaining an authenticated
worker. If Daytona reports that deletion failed, delete the named sandbox manually from
the Daytona dashboard.

The credential is accessible to processes running as the sandbox user while the job is
active. Do not reuse or snapshot an authenticated sandbox.

## References

- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Sign in with ChatGPT for self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- [Daytona documentation](https://www.daytona.io/docs)

## License

See [LICENSE](LICENSE).


```
set -o pipefail

npm run start -- \
  --advisory <advisory> \
  --task-id <task-id> \
  2>&1 | tee "traces/task-1234-$(date -u +%Y%m%dT%H%M%SZ).txt"
```


npm run start -- \
  --advisory https://github.com/cosmos/evm/security/advisories/GHSA-367m-g444-9mg3 \
  --task-id 3157 \
  2>&1 | tee "traces/task-3157-$(date -u +%Y%m%dT%H%M%SZ).txt"
