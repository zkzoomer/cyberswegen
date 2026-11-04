# CyberSWE Daytona worker image

`Dockerfile.cyberswe` builds two useful targets:

- `worker-base`: all public toolchains and upload utilities, without `rv`;
- `worker`: the complete image, including the private pinned `rv` package.

## Build the public base

```bash
docker build \
  --target worker-base \
  -f Dockerfile.cyberswe \
  -t cyberswe-worker-base:dev \
  .
```

## Build the complete worker

Generate a short-lived Artifact Registry access token locally and expose it to
BuildKit as a secret. It is used only by the `rv` installation layer and is not
stored in the resulting image.

```bash
gcloud auth print-access-token > /tmp/cyberswe-rv-token

docker build \
  --secret id=artifact_registry_token,src=/tmp/cyberswe-rv-token \
  -f Dockerfile.cyberswe \
  -t cyberswe-worker:dev \
  .
```

Delete `/tmp/cyberswe-rv-token` after the build.

## Google Drive runtime configuration

The image contains `upload-task-to-drive`, but no Google credential. Use a
dedicated Google service account and share only the destination Drive folder
with that account. Upload its JSON credential to the Daytona sandbox at runtime,
for example as `/run/secrets/google-drive-service-account.json`, and set:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-drive-service-account.json
export GOOGLE_DRIVE_FOLDER_ID=<destination-folder-id>
```

After producing a task:

```bash
upload-task-to-drive /output/task.zip
```

The uploader prints JSON containing the created Drive file ID and web link.
The service-account credential must never be added to the Docker build context,
image, repository, task ZIP, or agent prompt.

## Runtime credentials not included in the image

- `OPENAI_API_KEY` for the Codex SDK, Codex CLI, and `rv` in Codex mode;
- Google Drive service-account JSON;
- optional Google Application Default Credentials for an explicitly requested
  `rv update`.

Configure each disposable worker before running checks:

```bash
rv mode codex
```

The job instructions may select the probe model separately; no OpenCode login
or OpenCode installation is required.

The installed `rv` is already pinned. Rebuild the image to update it instead of
authenticating every disposable worker to Artifact Registry.
