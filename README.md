<img src="assets/icon.svg" width="64" height="64" alt="">

# ReadAloud

Paste anything. Hear it read. A React + Vite PWA that streams text-to-speech passage by passage, highlights the sentence being read, remembers your place, and works offline with a local voice.

## Layout

```
apps/web          The app (Vite + React 18 + TypeScript, React Router, Zustand, Framer Motion, PWA)
packages/ui       Component library (Tailwind + Morphicons + Lucide) with Storybook
packages/tokens   CSS variables for all 8 themes, a Tailwind preset, and a WCAG contrast check
deploy/kind       Terraform-managed local kind cluster and deployment helper
deploy/aws        Private EC2 + k3s target and ECR deployment helper
deploy/terraform  Shared Kubernetes module and environment mapping
```

The [hosting explainer](docs/kind-cluster-explainer.html) shows ingress routing, runtime components, Terraform ownership, deployment flow, storage, and the private AWS target. Its performance charts are explicitly historical. The [VoiceStudio integration record](docs/plans/voicestudio-integration.html) includes the updated runtime and speech request diagrams; its original planning estimates remain marked as history. See the [Studio guide](docs/voicestudio-studio.md) for current voice features and verification notes.

## Scripts

```sh
pnpm install
npm run dev          # app on http://127.0.0.1:5181 (strict port, .ts.net allowed); also prints the Tailnet URL from `tailscale serve`
pnpm build            # production build → apps/web/dist
pnpm --filter @readaloud/web preview   # serve the build on :4173
pnpm storybook        # Storybook on :6006 (dark / light / all Omarchy themes in the toolbar)
pnpm typecheck
pnpm test             # tokens contrast check + vitest unit tests
pnpm test:e2e         # Playwright: keyboard flow, responsive, axe per screen per theme
pnpm contrast         # WCAG 2.2 AA table for every theme
docker compose up -d  # VoiceStudio + the built app on :4179 (see Voices below)
```

Copy `apps/web/.env.example` to `.env` to point the app at a TTS backend.

## iOS app

Capacitor 8 wraps the web app in a native app. The Xcode project is `apps/web/ios/App/App.xcodeproj` and uses Swift Package Manager (no CocoaPods). `webDir` is `apps/web/dist`. What the web view loads is decided when `ios:sync` builds the app:

- **From a ReadAloud server**, when `READALOUD_PUBLIC_URL` is set (in the environment, `apps/web/.env.local`, or the root `.env`). The app opens that address, so it is the deployed web app with the device plugins added: every deploy reaches the phone without rebuilding, and the speech proxy, the shared library and background preparation all work as they do in a browser. See [Load the app from the server](#load-the-app-from-the-server).
- **From its own files**, when the setting is empty. The web view loads the bundle copied into the app and never opens a remote URL. It works with no network, and each web change needs a new `ios:sync` and Xcode build.

| | |
|---|---|
| Bundle id | `dev.andrewsolomon.arcreader` |
| Home-screen name | ReadAloud |
| Deployment target | iOS 15.0 |
| Signing | Automatic, team `7RRX4APJYW` |

ReadAloud is the name on the web app's home screen and window title. The bundle id stays `arcreader`. iOS 15.0 is Capacitor 8's minimum, so Xcode 27.2 can build it.

The shell pads `env(safe-area-inset-*)`: the status bar overlays the web view, the top of every screen clears the notch, and the home indicator is owned by the tab bar (or by the player, when focus mode hides the tab bar). The status-bar text follows the theme.

### Load the app from the server

Set the address once, where the deploy also reads it, then build and install the app:

```sh
# root .env (or apps/web/.env.local)
READALOUD_PUBLIC_URL=https://<machine>.<tailnet>.ts.net:8449
```

`ios:sync` writes it into the app as Capacitor's `server.url`, so changing the address means building and installing the app again. The local kind deployment owns the other end: with the same setting, Terraform has Tailscale serve the cluster's web port at that address, and `deploy/kind/deploy.sh` fails unless the address ends up serving the build it just deployed (see [the kind cluster](#or-run-it-in-a-local-kind-cluster)).

- The phone must be on the tailnet to open the app. When the server cannot be reached, the app shows a page stored inside it that names the server. The page checks for the server every few seconds and opens the app by itself once it answers, so reconnecting Tailscale is enough. **Try again** opens it at once, and gives the button back after 10 seconds if the connection hangs. If the server answers with an error instead (for a few seconds while a deploy restarts the web pod), that error is what the web view shows; close and reopen the app.
- iOS keeps the page alive for days, so the app asks the server which build it serves each time it comes to the foreground, and reloads once nothing is playing when a deploy has happened.
- The app's storage belongs to the address it loads from. Documents saved in an app that ran its own files stay with that build; the server's shared library takes their place.
- The speech server setting described below is hidden. Speech goes through the server's `/api/vs` proxy, and the Local voice still reads with the iPhone's own voices.

### Voices on device

This section describes the app running its own files. The browser build sends speech to the Vite proxy at `/api/vs`, which holds the VoiceStudio key. That proxy is not in the iOS bundle, so a relative `/api/vs` is ignored and passages are read with **AVSpeechSynthesizer** (the iPhone's installed voices) through a small plugin in the app target. WKWebView's Web Speech API is not used for this: it often stays silent, and it stops when the app leaves the foreground. Word highlighting follows the synthesizer's word ranges, with the same estimated clock the browser voice uses between ranges.

To use VoiceStudio or a ReadAloud server instead, open Settings → Speech server and paste an absolute URL:

- VoiceStudio itself: `https://<mac>.<tailnet>.ts.net:3900`, plus the API key if the server requires one. The key is stored on the device and sent only to that absolute URL.
- A ReadAloud server that already proxies VoiceStudio and holds the key: `https://<host>.<tailnet>.ts.net:8449/api/vs`. Leave the key empty.

Those requests use Capacitor's native HTTP stack, so the server does not need to allow the `capacitor://` origin. `localhost` is the phone, not the Mac. Background preparation, the shared library, and OpenAI/Fish proxies stay on the web server; they are not part of the bundled shell. Cached clips still play offline.

The audio session is playback, and the app declares the audio background mode, so the current passage keeps playing when the screen locks. There is no lock-screen play/pause button. iOS can suspend the app in a gap between sentences, and the orange background-audio indicator is the cost of letting a reader continue while locked. The browser PWA is unchanged.

The service worker is registered only in the browser. The native shell unregisters any worker, so a cached PWA shell cannot intercept the bundled files or hide a deploy from an app that loads from the server.

Paste into the composer works as a normal text paste. **Read clipboard** uses the system pasteboard, which asks for permission on iOS 16 and later.

### Build on a Mac

Xcode 27 and this repo. From the repository root:

```sh
pnpm install
pnpm ios:sync     # production web build, then copy dist/ into the Xcode project
pnpm ios:open     # opens apps/web/ios/App/App.xcodeproj
```

`pnpm --filter @readaloud/web ios:sync` and `ios:open` do the same thing. Run `ios:sync` before the first Xcode build. An app that runs its own files needs it again after any web change; an app that loads from the server needs it only when the address, a plugin or the native project changes. Check `server.url` in the generated `capacitor.config.json` to see which one a sync built. The copied web bundle (`apps/web/ios/App/App/public`) and the generated `capacitor.config.json` are gitignored.

The first Xcode build downloads the Capacitor Swift package from `https://github.com/ionic-team/capacitor-swift-pm.git`. That needs a network connection once. Swift packages resolve through the pnpm symlinks in `apps/web/node_modules`.

Then in Xcode:

1. The App target is already set to team `7RRX4APJYW` with automatic signing. If that Apple ID is not signed in yet, add it under Xcode → Settings → Accounts, then confirm the team under the App target → Signing & Capabilities. Xcode creates the provisioning profile.
2. Simulator: choose an iPhone or iPad simulator and press Run.
3. A device: connect the iPhone or iPad, choose it, and press Run. On the device, turn on Developer Mode (Settings → Privacy & Security) and trust the certificate (Settings → General → VPN & Device Management). A free personal-team profile expires after 7 days; press Run again to refresh it.

Version in Xcode is 1.0 (build 1), separate from the web app's package version. The icon and launch screen come from `apps/web/public/icons`.

For parallel worktrees, give each Playwright run separate ports, for example `E2E_PORT=4184 E2E_VOICE_PORT=3987 E2E_OPENAI_PORT=3986 pnpm test:e2e`. Each run uses temporary server library storage; UI tests isolate their libraries while the shared-library test uses independent browsers against the real HTTP API.

## Shared library

Documents, selected document voices, saved Patois adaptations and summaries, and listening progress are shared by all clients of the same web server through `/api/library/sync`. There are no separate user accounts or private libraries: everyone who can reach that server uses the same library. Keep using the same Tailscale URL on each device.

The server stores the library atomically in `LIBRARY_DATA_DIR/library.json` (default: `apps/web/.readaloud-library` when started from the app directory). The library has no expiry. Back up that directory; use a stable absolute `LIBRARY_DATA_DIR` when switching checkouts. Docker Compose mounts a persistent `library-data` volume.

On first connection, each browser automatically merges its existing documents and listening positions into the server library. Existing IDs are retained; for conflicting edits or positions, the newest `updatedAt` wins, so client clocks should be accurate. Different IDs remain separate documents, even if their text is identical. Deletions are permanent across devices: the server retains tombstones so an offline browser cannot re-import a removed document.

IndexedDB remains the offline copy. Local edits and deletions are committed alongside a persistent outgoing queue, retried after reconnecting, on focus, and every five seconds while the app is visible. The Library shows whether it has synced or is waiting. A fresh device can open a document link after syncing. Downloaded audio, app preferences, usage totals, and cloud-provider preparation queues remain local to each browser. Sync does not interrupt active playback; shared progress is used the next time a document opens.

Every sync also reconciles the cached documents and positions with the server, even after the initial browser import is complete. Local records missing from the server (or newer than its copy) are queued again without changing their timestamps; server deletion tombstones still win. “Synced” requires matching document IDs and an empty outgoing queue. The Library shows the synced document count, a **Sync now** button, and any sync error directly on the page.

Preparation yields to live speech: while a reader or voice preview is sending speech requests through the web server to the same VoiceStudio, background passages pause there, and resume fifteen seconds after the last live request. VoiceStudio runs one GPU worker with a one-deep queue, so this keeps live requests from being refused as busy and keeps two engines from evicting each other from memory.

VoiceStudio preparation jobs and server-rendered audio are discovered through `GET /api/preparations`. Other devices see the same server coverage, machine assignments, and queued work without starting generation or downloading the audio. Playback fetches an existing server clip when needed; **Prepare audio** can download an existing reading for offline use. Cancelling a shared job cancels it on the server. Audio that existed only in another browser's cache is not counted as server-ready. Server audio retains the preparation service's seven-day retention; a locally downloaded copy can outlive it.

When an older preparation skipped clips already cached on one device, that device shares those existing clips to the server in batches of eight per refresh. Leave it open while **Sharing saved audio** is displayed. These uploads use `PUT /api/preparations/:id/audio/:index`, preserve cached audio, and never start synthesis. Other clients discover the newly shared clips on their next refresh.

Run a single Vite dev or preview server per library directory. Static hosting needs an equivalent library API; without it, the app retains local changes and reports that sync is unavailable.

## Playback engine (`apps/web/src/engine`)

- One audio clip per passage (a paragraph, or up to about 60 words of one); about a minute of listening ahead is prefetched (at least two passages, at most two requests at a time), so long paragraphs bank time for runs of short ones; OpenAI and Fish prefetch only the next passage, since they keep up and bill audio a pause or skip never plays. The reader still moves sentence by sentence: each clip's sentence starts are located from its pauses (or from word timings when enabled), clips are level-matched and their edge silences trimmed at the joins. One request per sentence made generative voices shift tone at every sentence; see `planPassages` in `src/lib/segment.ts`.
- Advances with `requestAnimationFrame` on real elapsed time. With audio, `audio.currentTime` is the clock. Without provider timestamps, word timing is estimated at 2.83 words/s × speed.
- Chunks are cached in IndexedDB (`audio` store, keyed by engine + voice + text) so documents replay offline. Positions persist per document (`positions` store) and drive the Library progress rings.
- Provider chain: cache → speech server → browser voice. When the server is unreachable, a banner appears and the browser speech engine reads instead.

## Voices: VoiceStudio

ReadAloud talks to [VoiceStudio](https://github.com/debpalash/VoiceStudio) through its OpenAI-compatible audio API. The browser never contacts VoiceStudio directly: the Vite dev and preview servers proxy `/api/vs/*` to it and inject the API key, so the key stays out of the bundle and only the proxy talks to VoiceStudio.

### 1. Run VoiceStudio and ReadAloud (Docker Compose)

Your user needs access to the Docker socket (`sudo usermod -aG docker $USER`, then log in again). `compose.yaml` defines VoiceStudio (CPU) with its `voicestudio-data` volume and the web app, built and served by `vite preview` with its proxies. It reads settings from `.env` in the repo root (gitignored):

```sh
echo "VOICESTUDIO_API_KEY=$(openssl rand -hex 32)" > .env
# optional: OPENAI_API_KEY=sk-...   FISH_API_KEY=...   VOICESTUDIO_TAG=sha-...   WEB_PORT=4179
docker compose up -d
```

If you already have `apps/web/.env.local`, `ln -s apps/web/.env.local .env` uses it as-is; the variable names match. The app is at http://127.0.0.1:4179 and VoiceStudio at http://127.0.0.1:3900, both on loopback only. Both containers restart with Docker. OpenAI and Fish voices appear when their keys are set. Model names and the default engine (`VITE_DEFAULT_ENGINE`, `VITE_OPENAI_TTS_MODEL`, `VITE_PATOIS_MODEL`, `VITE_FISH_TTS_MODEL`) can also go in `.env`. Provider choices are baked in at build time, so run `docker compose up -d --build` after changing `.env` or pulling new code. To publish on the tailnet, run `tailscale serve --bg --https=<port> http://127.0.0.1:4179`.

#### VoiceStudio on another machine

Cloned and designed voices use OmniVoice, which runs about 10× slower than real time on a laptop CPU. On an Apple Silicon Mac it uses the GPU (MPS); actual speed also depends on passage length, reference encoding, and synthesis steps. ReadAloud requests VoiceStudio's normal 16-step preset. See [Mac preparation tuning](docs/voicestudio-studio.md#mac-preparation-tuning-2026-11-05) for the isolated-worker fixes used on the Mac mini. To use VoiceStudio on such a machine, run its backend there from source with the same API key, and publish it on the tailnet:

```sh
git clone --depth 1 --branch v0.5.7 https://github.com/debpalash/VoiceStudio.git && cd VoiceStudio
uv sync --locked --python 3.11 --managed-python && uv run --no-sync python scripts/setup.py
OMNIVOICE_API_KEY=<VOICESTUDIO_API_KEY> OMNIVOICE_SERVER_MODE=1 .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 3900
tailscale serve --bg --https=3900 http://127.0.0.1:3900
```

Then set `VOICESTUDIO_REMOTE_URL=https://<machine>.<tailnet>.ts.net:3900` in `.env` and run `docker compose up -d`. The web container uses the remote server as its preferred machine; the local VoiceStudio container can prepare one compatible overflow reading while the remote machine is occupied. For `npm run dev`, set `VOICESTUDIO_URL` to the same address. Each server keeps its own voices and licence acceptances: accept the OmniVoice licences on the remote machine. The local container prepares a reading only when it has the same voice: same profile id, settings and reference audio. Create voices on the remote machine, then copy them all to the local container with `apps/web/scripts/sync-voices.sh [ssh-host]` (it uses `ssh` and `docker`, backs up the local voice database, and never deletes local-only voices). Persona export/import can't be used for this because import assigns a new id. Compose pins the local speech-to-text model to Whisper large-v3 Turbo (`VOICESTUDIO_ASR_MODEL`); install it from the Model Manager.

The volume has a fixed name, so models downloaded by an earlier `docker run -v voicestudio-data:…` carry over. Remove the old container first (`docker rm -f voicestudio`). Compose then warns once that the volume already exists; that is expected.

Open http://127.0.0.1:3900, pick **KittenTTS** in the Model Manager (about 80 MB, runs on any CPU), and let it download. Pin the image with `VOICESTUDIO_TAG=sha-…` in `.env` once it works; the project ships often.

Measured on this laptop (Intel i7, 12 threads, CPU only, KittenTTS warm; the first request after a cold start also downloads the 80 MB model and took about 19 s):

| Sentence | Words | First byte | MP3 size |
|---|---|---|---|
| "Simplicity, simplicity, simplicity!" | 3 | 0.87 s | 60 KB |
| "I went to the woods because I wished to live deliberately." | 11 | 1.2 s | 240 KB (WAV) |
| "The quick brown fox … begin to call." | 22 | 2.3 s | 156 KB |

Generation runs at roughly 3–4× real time, so the prefetch keeps up once playback starts (the numbers above are per sentence; a passage request is a few sentences long). MP3 is the cheapest format; WAV and PCM save nothing on latency. Saved profiles require an active cloning engine; ReadAloud checks this before requesting speech and reports an explicit browser fallback if it is unavailable. KittenTTS cannot clone. Re-measure with `apps/web/scripts/measure-tts.sh`:

```sh
VOICESTUDIO_API_KEY=… apps/web/scripts/measure-tts.sh   # three runs, first-byte and total time; or reads apps/web/.env.local
```

Select the engine without the UI if you prefer:

```sh
set -a; . ./.env; set +a
curl -X POST -H "Authorization: Bearer $VOICESTUDIO_API_KEY" -H "Content-Type: application/json" \
  -d '{"family":"tts","backend_id":"kittentts"}' http://127.0.0.1:3900/engines/select
```

#### Or run it in a local kind cluster

`deploy/kind` runs the same two services in a single-node [kind](https://kind.sigs.k8s.io/) cluster (context `kind-readaloud`, namespace `readaloud`). It reads the same root `.env` and replaces Compose: the cluster binds 127.0.0.1:4179 (web) and 127.0.0.1:3900 (VoiceStudio) and mounts the Compose volumes (`readaloud_library-data`, `readaloud_preparation-data`, `voicestudio-data`), so the library, prepared audio, models, and voices carry over unchanged. Both host ports lead to a [Traefik](https://doc.traefik.io/traefik/) ingress controller (namespace `traefik`), and an Ingress routes each port to its app's ClusterIP Service.

Terraform owns all of it in two stages: `deploy/kind/terraform/cluster` creates the kind cluster (ports, mounts, node image) and `deploy/kind/terraform/app` calls the shared `deploy/terraform/modules/readaloud` module for everything in it (Traefik, the Deployments, Services, Ingresses, config and secrets from `.env`). The state lives in `~/.local/state/readaloud/terraform`, outside the repository, so every checkout deploys the same cluster; the app state holds the `.env` secrets.

Set `READALOUD_PUBLIC_URL=https://<machine>.<tailnet>.ts.net:<port>` in `.env` and Terraform also has Tailscale serve the web port at that address (`deploy/kind/terraform/app/public-url.tf`): it runs `tailscale serve` when the address is first set or changes, runs it again if Tailscale has stopped serving it, and refuses an address that names another machine. Each deploy then ends by checking that the address serves the new build, and fails if it does not. The iOS app can be built to load from the same address ([iOS app](#load-the-app-from-the-server)), which makes this deploy the way the phone is updated. Without the setting, Terraform leaves Tailscale alone.

```sh
deploy/kind/deploy.sh   # build the web image, load it into kind, roll out
kubectl --context kind-readaloud -n readaloud get pods
kubectl --context kind-readaloud -n readaloud logs deploy/web
kubectl --context kind-readaloud -n traefik logs deploy/traefik   # routing errors, 404s while a pod restarts
deploy/kind/terraform.sh app plan       # what a deploy would change (keeps the running web image)
deploy/kind/terraform.sh cluster plan   # cluster changes; applying one recreates the cluster
```

Needs `kind`, `kubectl` and `terraform` (`mise use -g terraform`) on the PATH. The first run stops Compose (volumes are kept), creates the cluster, and loads the 17 GB VoiceStudio image into it, which takes a few minutes; later runs only rebuild and reload the web image. The node container restarts with Docker, like the Compose services did. Each app runs as exactly one pod and updates with `Recreate`: the shared library and the preparation queue are single-process state, so a second web pod would overwrite the first one's files and double-book the speech workers. A deploy therefore still drops the app for a few seconds while the new pod starts. Configuration changes in `.env` restart only the pods that use them. Don't run Compose alongside the cluster. kind cannot change a running cluster, so `deploy.sh` only applies the cluster stage when the cluster is missing and otherwise warns when it has drifted; apply such a change by hand with `deploy/kind/terraform.sh cluster apply`. To go back to Compose, `deploy/kind/terraform.sh cluster destroy` (the volumes stay) and `docker compose up -d`.

**Existing kind cluster cutover:** the kind provider cannot import a cluster created by the old YAML scripts. Deploy stops if that cluster exists without Terraform state. Schedule downtime, back up the Docker volumes, run `kind delete cluster --name readaloud`, then run `deploy/kind/deploy.sh` to recreate it under Terraform. Deleting the kind node keeps the named Docker volumes, but loading VoiceStudio and starting its models takes several minutes. Do not remove the volumes or use `docker compose down -v`. If Terraform previously managed the cluster, restore its state backup instead of treating it as a fresh migration.

The Omarchy `readaloud` cluster completed this cutover on 6 Nov 2026. Terraform now owns its cluster and app resources; the original Docker volumes remain mounted, and the pre-cutover backups are kept outside the repository under `~/.local/state/readaloud/backups`. The AWS target below remains unprovisioned.

#### Or host it privately on AWS

`deploy/aws` runs the same web app and Traefik module on one EC2 host with k3s. VoiceStudio stays on the Mac mini (or another tailnet machine); no speech models run on EC2. Access is through Tailscale Serve at `https://readaloud-aws.tail1b9428.ts.net`. The AWS security group admits only Tailscale's UDP port; HTTP, SSH and the Kubernetes API have no public inbound rule. Tailnet policy controls who can reach the app, the API on TCP 6443, and the remote VoiceStudio.

Terraform has two independent stages:

- `deploy/aws/terraform/infra`: a VPC, public subnet with outbound internet, EC2 (`t3a.medium`, amd64), ECR, IAM, an encrypted 10 GB EBS data volume, and seven daily snapshots. The 30 GB root disk is disposable. The data disk holds the library, preparations, k3s state, and Tailscale identity.
- `deploy/aws/terraform/app`: the shared Kubernetes module, with only the web app and Traefik. A [CoreDNS zone override](https://docs.k3s.io/advanced#coredns-custom-configuration-imports) forwards tailnet DNS to Tailscale so the web pod can find the Mac; ordinary DNS uses the [VPC resolver](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html). ECR pulls use the instance role through a [kubelet credential provider](https://kubernetes.io/docs/tasks/administer-cluster/kubelet-credential-provider/); there is no expiring registry password to renew manually.

Prerequisites: Docker with Compose, Terraform, `kubectl`, AWS CLI v2 with a working profile or SSO session, and Tailscale on the deployment machine. AWS credentials need permission to manage the resources above, pass the instance and backup roles, push to ECR, and use SSM Run Command. Enable MagicDNS and HTTPS certificates in the tailnet; its policy must permit the AWS host to reach VoiceStudio and this machine to reach the host's Kubernetes API. A first-boot Tailscale auth key must be approved for the intended tailnet and any required tags.

Put the server settings in the root `.env`, as for kind. At minimum:

```sh
VOICESTUDIO_REMOTE_URL=https://andrews-mac-mini.tail1b9428.ts.net:3900
VOICESTUDIO_API_KEY=<the remote server's key>
# Optional second remote server; AWS does not invent a local fallback.
# VOICESTUDIO_SECONDARY_REMOTE_URL=https://another-host.example.ts.net:3900
```

Create the infrastructure, then deploy the app:

```sh
aws sso login --profile your-profile
export AWS_PROFILE=your-profile
aws sts get-caller-identity

# Read a first-boot key without placing it in shell history.
read -rsp 'Tailscale auth key: ' TF_VAR_tailscale_auth_key; echo
export TF_VAR_tailscale_auth_key
deploy/aws/terraform.sh infra plan
deploy/aws/terraform.sh infra apply
unset TF_VAR_tailscale_auth_key

deploy/aws/deploy.sh
```

The first deploy waits for SSM and cloud-init, fetches the admin kubeconfig through SSM into `~/.kube/readaloud-aws.yaml` (mode 600), builds and pushes a uniquely tagged image, and waits for the pods to roll out. It leaves the default kubectl context alone. The first deployment starts with an empty cloud library; local Docker volumes are not uploaded. Existing library and prepared audio require a separate data migration while their writers are stopped.

Infrastructure defaults to `us-east-1`. To override region, hostname, tailnet, instance type, or data disk size, export the corresponding `TF_VAR_*` values consistently for infrastructure commands, for example `TF_VAR_region=us-west-2`. The image build is for amd64; use an x86 instance. App settings still come from `.env`. Later deployments are simply `deploy/aws/deploy.sh`; merging locally continues to deploy kind through the existing hook.

```sh
deploy/aws/terraform.sh infra output -raw url
deploy/aws/terraform.sh infra plan
deploy/aws/terraform.sh app plan   # keeps the image currently running
kubectl --kubeconfig ~/.kube/readaloud-aws.yaml -n readaloud get pods
kubectl --kubeconfig ~/.kube/readaloud-aws.yaml -n readaloud logs deploy/web
kubectl --kubeconfig ~/.kube/readaloud-aws.yaml -n traefik logs deploy/traefik
```

For bootstrap failures, inspect `/var/log/readaloud-setup.log` and `cloud-init status --long` in an SSM session (`aws ssm start-session --target <instance_id>`; interactive sessions also need the Session Manager plugin). Infrastructure apply returning successfully means EC2 was created; it does not certify that cloud-init finished. No AWS resources are created by validation alone.

State lives in `~/.local/state/readaloud/aws`, with providers cached under `~/.cache/readaloud-aws/terraform`. Keep a protected backup of both Terraform states: the app state contains API keys, and infrastructure state and EC2 user data contain the first-boot Tailscale key. Revoke that join key after the machine joins; its persisted identity handles later boots. EBS snapshots contain private app data and the cluster and tailnet identities, and are crash-consistent rather than an application-level backup. Never boot a restored copy alongside the original host with the same identities.

AMI and user-data edits intentionally do not replace a running instance. To apply them, review `deploy/aws/terraform.sh infra plan -replace=aws_instance.host`, then apply with the same flag. This causes downtime, keeps the data disk, and reuses its Tailscale and k3s identities. The services require the data mount before starting. To refresh an expired or replaced cluster's local admin certificate, remove `~/.kube/readaloud-aws.yaml`; the next app command fetches it again. A complete loss of the data disk requires restoring a snapshot and recovering the Terraform state, not just replacing EC2.

The data volume has `prevent_destroy`, so `infra destroy` is deliberately blocked until that protection is explicitly reviewed and removed. To retire the deployment, destroy the app stage first, then review infrastructure removal and backup retention. EC2, EBS, snapshots, ECR and the public IPv4 address incur AWS charges while present.

Vercel is not a deployment target yet. The current server uses writable local files and an in-memory preparation queue. Hosting the complete app there requires moving the library and audio to durable storage, the queue to a durable worker, and the Vite middleware to functions; its access to the private VoiceStudio also needs a deliberate network design. Deploying the static frontend alone would omit those server features.

### 2. Develop against it

To run the app with `npm run dev` against the Compose VoiceStudio, create `apps/web/.env.local` with the same key:

```sh
VITE_API_BASE=/api/vs
VITE_TTS_PROVIDER=openai
VITE_DEFAULT_ENGINE=kittentts
VOICESTUDIO_URL=http://127.0.0.1:3900
VOICESTUDIO_API_KEY=<VOICESTUDIO_API_KEY from .env>
```

Then `npm run dev`. The Voices page lists KittenTTS's eight presets plus any cloned or designed profiles; Settings → Engine lists what the server reports.

### Studio

Open **Studio** to clone a voice, design one from a description, browse VoiceStudio’s designed-voice gallery, dictate, transcribe files, or dub a video. The required model terms can be reviewed and accepted in Studio. See [Studio setup and verification](docs/voicestudio-studio.md) for API details and the remaining live-render verification gate.

### OpenAI voices (the ChatGPT voices)

The same adapter talks to OpenAI's speech endpoint. Add to `apps/web/.env.local`:

```sh
VITE_OPENAI_BASE=/api/oa
VITE_OPENAI_TTS_MODEL=gpt-4o-mini-tts   # or tts-1 / tts-1-hd
OPENAI_API_KEY=sk-...                     # read by the proxy only
```

The Voices page then lists Alloy, Ash, Ballad, Coral, Echo, Fable, Nova, Onyx, Sage, Shimmer and Verse. Each voice carries its own engine, so OpenAI voices go to `/api/oa` and VoiceStudio voices to `/api/vs`; Settings → Engine selects VoiceStudio’s active engine for saved profiles or enables the browser-voice override. OpenAI requests are not serialized (it handles concurrency); clips are still cached at 1×. Settings → API usage & spending shows monthly requests, reported input/audio output tokens, and list-price cost estimates. GPT-4o mini TTS requests use speech events to retain reported usage; binary-only compatible servers remain playable, with tokens and cost marked unavailable. Every gpt-4o-mini-tts request also carries a fixed `instructions` line asking for one steady delivery, so passages match each other. Every passage sent to an OpenAI voice leaves the machine; VoiceStudio keeps everything local.

### Fish Audio voices

Add to the ignored `apps/web/.env.local` and restart Vite (rebuild for preview):

```sh
VITE_FISH_BASE=/api/fish
VITE_FISH_TTS_MODEL=s2.1-pro
FISH_API_KEY=<your Fish Audio API key>
```

The key is read only by the server proxy; never put it in a `VITE_` variable or the browser's Settings API-key field. Keep `.env.local` private (`chmod 600 apps/web/.env.local`). The proxy allows voice catalogue reads and speech generation only. Static hosting needs an equivalent backend proxy; Vite dev and preview include it.

Choose a voice tagged **Fish Audio** on the Voices page. Sarah, **Jamaican English**, and **Jamaican Patois** are always included when Fish is enabled, alongside up to 12 English voices from Fish's catalogue. A failed refresh displays a retry action and keeps the existing voices available. Saved Fish voice IDs remain playable even if they fall outside the current catalogue page.

Jamaican English uses Fish's [Jamaican Accent Male](https://fish.audio/m/d7988a7138db47cc8a4876a36625dff6/) to read the original wording. **Jamaican Patois rewrites English into Jamaican Patois**, then reads the adaptation with [Jamaican Patois Male](https://fish.audio/m/0724e14ccf884007a641908722575fdf/). Use **Preview** to audition each voice, then select it globally or for an individual document.

Patois rewriting requires `VITE_OPENAI_BASE=/api/oa` and the server-side `OPENAI_API_KEY` above. It uses `gpt-4.1-mini` by default (`VITE_PATOIS_MODEL` overrides it) through the existing OpenAI proxy. Source text is sent to OpenAI in bounded chunks; adapted text goes to Fish. Text-model token charges are separate from the speech-character estimates in Settings. The reader displays and highlights the adapted text. The original and completed adaptation are stored together on this device, so repeat listening reuses the rewrite; switching to another voice restores the original. Positions reset when changing between original and adapted text. Failed, cancelled, refused, or truncated rewrites do not start speech or replace the original. The preparation banner offers cancel and retry. Adaptation quality still benefits from a fluent speaker's review.

Fish uses [`POST /v1/tts`](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech) with the voice's `reference_id` and returns MP3 audio. Passage prefetch, playback speed, cache, and character usage work as before. Fish caches include the selected model, and cloud requests run independently of the local worker queue. Changing voices retries the connection after an offline fallback. Word highlighting uses estimated timing unless the existing optional VoiceStudio alignment is enabled.

`s2.1-pro` requires API credit; an insufficient-credit response is shown without marking all providers offline. Other models can be selected using `VITE_FISH_TTS_MODEL`; consult Fish's current model documentation before changing it. Text read with a Fish voice is sent to Fish Audio. Leave `VITE_FISH_BASE` empty to hide this provider.

### API usage & spending

Settings groups speech usage by provider and model, with monthly history and a daily spend chart. Only completed generations are recorded, including prefetch; cached playback and browser voices add no usage. OpenAI GPT-4o mini TTS uses provider-reported input and audio output tokens (almost all of the cost is audio output); TTS-1 uses Unicode character counts, and Fish uses UTF-8 bytes. Prices are snapshots of list rates checked November 5, 2026 ([OpenAI](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [TTS-1](https://developers.openai.com/api/docs/models/tts-1), [TTS-1 HD](https://developers.openai.com/api/docs/models/tts-1-hd), [Fish Audio](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)). Unknown models or missing usage show unavailable costs rather than a guessed rate.

To spend less on OpenAI, set **Settings → OpenAI model** to **Standard** (`tts-1`, about a third less per character). It ignores the narration prompt, so delivery can vary between passages; accent voices stay on the steady model. Clips cached sentence by sentence before passages existed are joined into a passage locally instead of being generated again. The player menu offers **Prepare audio** for VoiceStudio voices; the Library also allows explicit preparation of paid voices, with a note that this bills uncached audio for the whole document in each voice.

Daily aggregates live in `readaloud:usage` in this browser's local storage. They contain no API keys, document text, or audio. Keys used with the same provider share totals; other devices, apps, Studio operations (including dubbing/transcription), hosting costs, tax, and credits are excluded. Failed/interrupted requests may still incur provider charges. Account links lead to actual billing information. Clearing site data clears history. Existing character counters migrate with their original month; their missing model, token, and cost data stays unavailable. Estimates are saved when generated so changing a model or rate does not reprice history.

### Slow engines (cloned voices on CPU)

Starting a VoiceStudio reading from Compose (typed text, an uploaded file, a URL, or the clipboard) automatically prepares the whole document in the background while playback starts. The player shows preparation progress; use **Stop preparing** in its menu to cancel. Browser-only playback and paid voices keep their usual playback behavior.

The Library shows listening progress and a separate preparation ring for each cached voice, in both list and card views. Coverage comes from audio saved on this device and follows the selected speech model; clearing or evicting cached audio reduces it. Select documents, choose **Prepare selected**, and check one or more voices to queue every document/voice combination. Each document also has a **Prepare audio** action. VoiceStudio prepares one whole reading per machine, finishing it before starting the next voice on that machine. With only the primary configured, local readings run one at a time. The Mac mini is the preferred machine: new readings always go there whenever its single preparation slot is free. With a compatible secondary configured, Omarchy can run one overflow reading while the Mac is occupied, and the rest wait in the server queue. Each machine runs at most one preparing reading at a time, and a busy Mac takes its next queued reading as soon as its current one finishes. When the Mac frees up, it takes the oldest reading in a voice that only it has before readings Omarchy could also prepare, so those can run on Omarchy in the meantime. The queue shows the actual machine name, waiting readings (with the machine a reading is waiting for when only one can prepare it), and audio being saved on this device. OpenAI and Fish keep independent pools of up to three readings each. The queue is saved on this device: reopening or refreshing the app resumes interrupted and queued readings with their original voices and model settings, reusing completed audio. Cached audio downloads bypass synthesis. Identical readings share server work, and cancelling one keeps that work running while another reading still needs it. Active VoiceStudio readings render on the server while the app is inactive; keep the tab open to advance through queued readings or prepare paid voices. Saved audio is reused on subsequent preparations. Preparing voices does not change the document's listening voice or saved position. Browser speech is live and cannot be prepared.

Cloning engines such as OmniVoice are built for a GPU. On a CPU they can take ten times longer to generate a passage than to play it, so the reader pauses between passages while the next one renders (the player's spinner shows the wait). The app detects this and points to **Prepare audio** in the player menu (offered for VoiceStudio voices only). This submits the whole document to the web server as one background job, starting at the current passage and wrapping around. Rendering continues when the phone switches apps, locks, or closes the page. Progress reconnects when the reading is reopened, and playback reuses completed audio. **Stop preparing** cancels the remaining passages; a passage already rendering can finish.

To prepare on the Mac and Omarchy together, keep `VOICESTUDIO_URL` pointing to the Mac and set these server-side values for dev/preview:

```ini
VOICESTUDIO_NAME=Mac
VOICESTUDIO_SECONDARY_URL=http://127.0.0.1:3900
VOICESTUDIO_SECONDARY_NAME=Omarchy
```

The secondary uses `VOICESTUDIO_API_KEY` unless `VOICESTUDIO_SECONDARY_API_KEY` is set. Compose automatically uses `http://voicestudio:3900` as the secondary when `VOICESTUDIO_REMOTE_URL` selects a remote primary; `VOICESTUDIO_SECONDARY_REMOTE_URL` overrides that container address. Restart the web server after changing these values. The secondary must have the same engine and voice: saved designs are compared by recipe and seed; clones also require identical reference audio. Missing, changed, unavailable, or incompatible voices stay queued for the primary. No profiles are copied and no engine is changed automatically. The CPU machine can take substantially longer than the Mac; it handles its own reading without sharing the Mac's inference time. Jobs retain their assigned machine when the web server restarts, and cancellation releases a busy machine after its current passage finishes.

Jobs, source passages, and generated audio are stored on the web server in `PREPARATION_DATA_DIR` (default: `apps/web/.readaloud-preparations` when launched from the app directory). Compose mounts a persistent `preparation-data` volume there. Running jobs resume after a web-server restart and wait for VoiceStudio to reconnect if it is also restarting. Temporary connection failures during submission or audio downloads retry automatically; cancelled and failed readings stay stopped. Files older than seven days are removed at startup. The browser downloads completed clips into IndexedDB when active again, so offline playback is ready after the app reports **Audio prepared**. Previously cached passages need no new generation. Background preparation requires the built-in `/api/vs` connection and the Vite dev or preview server; static hosting needs the equivalent job API. The player menu does not offer whole-document preparation for OpenAI or Fish; the Library offers it explicitly with its billing notice. For live reading choose a KittenTTS voice (CPU-native, faster than real time) or an OpenAI voice.

### Without VoiceStudio

`LIVE=1 pnpm test:e2e` runs the `@live` specs against a real server (URL and key from `.env.local`) and prints the measured first-sentence latency. Without the flag, `tests/stub-voicestudio.mjs` imitates the API (bearer check, two cloned profiles, sine-tone audio, word timings). Playwright starts it automatically. To develop against it:

```sh
node apps/web/tests/stub-voicestudio.mjs 3999 test-key &
VOICESTUDIO_URL=http://127.0.0.1:3999 VOICESTUDIO_API_KEY=test-key VITE_API_BASE=/api/vs npm run dev
```

### Word timings (optional)

The speech endpoint returns audio only, so the word underline is estimated. Settings → Playback → **Word timings from the server** sends each synthesized passage to `/v1/audio/transcriptions` (`verbose_json`, word granularity) and uses the result when every word aligns; the timings then also fix the sentence starts inside the clip. It costs one extra request per passage and is off by default.

### Legacy contract

With `VITE_TTS_PROVIDER=readaloud` the app instead calls `POST {VITE_API_BASE}/tts` with `{ text, voice, provider, format: "mp3" }` and accepts `audio/mpeg` (optional `X-Duration`, `X-Word-Timings` headers) or JSON `{ audio: <base64>, mime, duration, words }`. `POST /auth/magic-link` and `GET /auth/google` back the Auth screen in either mode.

## Article summaries

The Reader's **Summarize** button (sparkles, in the header) asks an LLM for a plain-prose summary of about 200 words and shows it above the text. Summaries are saved on the document and shared through library sync, so each article is summarized once; editing the text marks the summary out of date. The panel stays open across documents until you hide it, but only the button or **Summarize** starts a request. **Listen** reads the summary with the document's voice: the Reader shows and highlights the summary instead of the text, and **Read the full article** switches back. Summary audio is cached and can be prepared like any reading; listening to it leaves the article's saved place and read count untouched, and summaries are read as written (the Jamaican Patois voice reads the summary without adapting it).

It uses [OpenCode Go](https://opencode.ai/docs/go/). Paste your Go API key in **Settings → Summaries** (it is the `key` under `opencode-go` in `~/.local/share/opencode/auth.json`). The server checks it with OpenCode, then saves it as `llm.json` (mode 600) in `LIBRARY_DATA_DIR`, so Compose keeps it in the library volume. The browser only ever sees its last four characters. A saved key takes precedence over the optional server-side `LLM_API_KEY`; **Remove** falls back to it. `LLM_URL` (default `https://opencode.ai/zen/go`) points at any OpenAI-compatible base, e.g. `https://opencode.ai/zen` for pay-as-you-go Zen. Anyone who can reach the server can replace or remove the key, as with the shared library.

`/api/llm` forwards `POST /v1/chat/completions` for text and `POST /v1/responses` for image descriptions, adding the key, a `readaloud` user agent, and a per-document `x-opencode-session`, which Go requires. Settings → Summaries picks the model:

- **Muse Spark** (`muse-spark-1.3-contributor`, default): about 20 s and about $0.002 of Go allowance for a 15,000-word essay. Go only serves it once **Allow paid endpoints that train on request data** is on in the OpenCode console, so the article text may be used for training.
- **GLM 5.3** (`glm-5.3`): about a minute and about $0.20 for the same essay, against GLM 5.3's $15 monthly Go limit (shared with any coding use).

Go is designed for coding agents and OpenCode monitors its traffic for abuse. Occasional summaries are light, but if that is a concern, point `LLM_URL` at Zen and pay per token. Article text is sent to OpenCode and the model provider.

## Code in readings

Code blocks are narrated as short explanations instead of source code. Fenced Markdown, indented code, imported HTML `<pre>` blocks, and recognizable unfenced snippets are detected before sentence splitting. The reader shows an explanation card with expandable original code. Both live speech (including browser voices) and prepared/downloaded audio use the same narration.

When a summary connection is configured, opening or preparing a reading generates explanations with the model in **Settings → Summaries**. Code and a small amount of surrounding context are sent to that provider. Explanations are saved with the document and shared across voices and devices; changing a block invalidates its explanation. If the service is unavailable, the output is unusable, or an example exceeds the request limits, narration announces that the code is being skipped and continues. Raw code is never used as the fallback for a detected block. Unformatted text without recognizable code syntax may still be treated as prose; retain code fences when pasting.

Older saved positions in documents containing code restart at the beginning once, because code blocks now occupy a single seek target. Subsequent positions resume normally.

## Images and diagrams in readings

Article fetching preserves meaningful images, responsive/lazy image sources, figure captions, alt text, and inline SVG diagrams in reading order. Relative URLs are resolved against the article URL. Decorative images and tiny tracking pixels are omitted. Markdown image links are preserved too. Each visual gets one spoken explanation and an expandable **View image** or **View diagram** card. Image addresses and SVG markup are never narrated.

Opening or preparing a reading uses the saved **Settings → Summaries** connection to describe its visuals. Images use Muse Spark through the Responses API, independently of the text-summary model; set `VITE_VISUAL_MODEL` at build time to use another vision-capable Responses model on your `LLM_URL`. The provider receives the image URL (or rasterized inline diagram), caption, alt text, and nearby article context. Inline SVG is rendered as an inert image and converted to PNG for vision. Descriptions focus on a picture's subject, a diagram's relationships, or a chart's main trend, rather than reading every label.

Descriptions are saved and synced with the document, reused across voices, and used by live, browser, prepared, and downloaded audio. If vision is unavailable, the reader explicitly uses the article's caption or alt text; without either, it announces the unavailable description and continues. Broken images never stop the article. Up to eight uncached visuals are described per opening, two at a time, with a one-minute overall deadline; remaining visuals use article metadata. Previously saved descriptions remain available offline, though remote images themselves may not.

This applies to new imports. Re-import older articles whose images were already stripped. Fetching cannot recover diagrams drawn only by page JavaScript or canvas, and a provider may not be able to load protected or unsupported image URLs. Inline SVG requires a browser with canvas support. Large embedded visuals are bounded to keep the shared library small. Old positions in documents with newly recognized visual blocks restart once because sentence indices changed.
## Library catalogue

Each document carries a catalogue record for later research. The Reader's **Details** button (books icon, in the header) opens it above the text: title, the original link (with a button to open it), author, published date, site, category, summary status, the page's description, and your notes. Fields save when they lose focus (Enter for one-line fields, Escape discards) and are shared through library sync. **Copy citation** copies `Author (Date). Title. Site. Link`.

Articles fetched from a URL, the clipboard, or the share target keep their link, and their author, published date (as `YYYY-MM-DD` when parseable), site name, and description are read from the page's meta tags and Schema.org JSON-LD. Documents added before this keep only their domain; paste the link into Details.

Categories come from [Jev](https://docs.typesafe.ai), TypeSafe's classification model. Jev answers one Choice question over the library's shelves (`CATEGORIES` in `src/lib/category.ts`, plus any category you have typed yourself) from the title, link, site, author, description, summary, and the first 24,000 characters of the text, and returns its pick with a confidence score. New documents are filed in the background as they are added; **Ask Jev** in Details refiles one, and the Library's **File N uncategorized with Jev** files the rest. Typing a category in Details overrides Jev and is never replaced by background filing. The Library filters by category and searches titles, links, authors, sites, categories, descriptions, and notes.

Paste a TypeSafe API key in **Settings → Library** (from console.typesafe.ai/keys). Like the OpenCode key, the server checks it, saves it as `typesafe.json` (mode 600) in `LIBRARY_DATA_DIR`, and only ever shows the browser its last four characters; a saved key takes precedence over `TYPESAFE_API_KEY`. `/api/jev` forwards `POST /v1/systemone` only, to `TYPESAFE_URL` (default `https://api.typesafe.ai`). Without a key, documents can still be categorized by hand.

## Links

Every document keeps the hyperlinks it came with: the links inside a fetched article, and any Markdown or bare URLs in pasted or uploaded text. When playback finishes the word or phrase a link was attached to, the link appears as a toast for five seconds; selecting it opens the address in a new tab. Skipping past a link with a seek does not show it. Turn the toasts off with **Settings → Playback → Show links as they are read**.

The Reader's **Links** button (chain icon, in the header) opens the links table beside the text, or in a sheet on a phone. **Read** fills in as links are read, newest first; **All** lists every link in reading order and ticks the ones behind your place. Both follow the saved position, so they are the same after a reload or on another device.

Links are stored with their text, not a position, so each is matched to the place its words are read (`src/lib/linkPlaces.ts`). When the same words also appear unlinked just before the link, the toast can come at that earlier mention. A link whose words are not in the reading, such as most links while the Jamaican Patois adaptation is read, is listed under **All** and counted as read once the reading ends. Summaries have no links table.

## Themes

`packages/tokens/src/themes.css` defines `--bg … --danger` on `html[data-theme]` for dark, light, tokyo-night, catppuccin, gruvbox, nord, everforest and kanagawa. The Tailwind preset maps `bg-bg2`, `text-fg2`, `border-line`, `bg-hl`, `rounded-card`, `shadow-overlay` and so on to those variables. First visit follows `prefers-color-scheme`; the rail and reader header cycle themes.

`pnpm contrast` verifies WCAG AA for text on every surface, including `--fg` on `--hl` composited over `--bg` in every theme.

### Deviations from the brief, for accessibility

- Light accent is `#a35b25` rather than `#b5692d`. The original fails AA for white text on the Listen button (4.18:1) and for accent-coloured links on the light background (3.74:1).
- `--fg3` is never used for running text. The dim highlight mode uses it for inactive sentences as specified; this is below 4.5:1 in several themes and is a deliberate de-emphasis. Placeholders use `--fg2`.
- The Waybar mockup's accent-on-`--hl` speaking state is below AA in light, tokyo-night, nord and everforest. It mirrors the real Waybar module, whose colours come from Omarchy, and is reported as advisory by the contrast script.

## Keyboard

Space play/pause · ← → sentences · [ ] speed ±0.25 · ⌘↵ Listen · Ctrl/⌘V read clipboard · F focus · / search library · ? shortcuts · Esc exit/close. Ignored while typing, except Esc and ⌘↵. Pasting in text fields keeps its normal editing behavior.

Use **Read clipboard** from the sidebar, composer, or mobile toolbar to open copied text directly in the reader and start listening. A copied HTTP(S) article link fetches the article first. You can also paste anywhere outside a text field without opening Compose; this works even when the browser blocks clipboard reading. Clipboard contents are read only after clicking the button or pasting, and existing composer drafts are preserved.

## PWA

Manifest with icons, maskable icon and a splash screenshot. Web Share Target opens `/read/new?text=&url=&title=`; it auto-plays only when "Auto-play on share" is on.
