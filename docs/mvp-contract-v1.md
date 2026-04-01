# luci-app-podman MVP Contract v1

Status: **frozen for implementation tasks 2+**

## 1) Scope and invariants

- Transport: LuCI backend proxy only → local rootful Unix socket `unix:///run/podman/podman.sock`.
- API namespace: **Libpod endpoints only** (`/libpod/...`) for all resource operations.
- No browser-direct engine access.
- Pods are first-class in MVP.

## 2) Supported version floor (packaging/runtime matrix)

| Layer | Floor | Why |
|---|---|---|
| OpenWrt | **23.05+** | modern rpcd/ubus + ucode runtime expected by backend design |
| LuCI | **23.05 branch or newer** | JS/rpc patterns and ACL/menu conventions used by MVP |
| Podman engine | **5.0.0+** | stable Libpod API family with pods, events, and resource endpoints required by MVP |
| Libpod API (server advertised) | **>= 5.0.0** | required by backend version negotiation and endpoint set below |

If any floor is not met, backend reports **unsupported platform/version** and disables mutating actions.

## 3) API versioning and drift rule

### Path construction

- For all versioned API calls, backend constructs: `/{apiVersion}/libpod/<path>`.
- `apiVersion` is discovered from server capability data (`Libpod-API-Version` header on `_ping` and/or `/libpod/version`).

### Health exception (non-versioned)

- **Allowed:** `GET /libpod/_ping` (also `HEAD` supported by server).
- Reason: `_ping` is explicitly non-versioned and exposes Podman-specific `Libpod-API-Version` headers used for capability negotiation.
- This is **not** a Docker-compat fallback; it is a Podman service health + capability probe exception.

### Drift handling

- If server Libpod API `< 5.0.0`: fail closed (unsupported).
- If server major is newer than contract major: continue in compatibility mode using the highest contract-tested path version, mark `drift=forward` in status.
- If endpoint returns `404/501` due to version drift: feature is marked unavailable; no fallback to compat namespace.

## 4) Default numeric budgets (hard limits)

- Read timeout: **10s**
- Mutating timeout: **30s**
- Image pull/prune timeout: **60s**
- Max inspect/list response body: **1 MiB**
- Max log snapshot body: **256 KiB**
- Max events window: **200 rows**
- Polling interval: **5s** default, exponential/step backoff up to **30s** on repeated failures

## 5) MVP allowlist (exact endpoints)

Only the methods/paths below are in v1 contract.

### 5.1 System

- `GET /libpod/_ping` *(health/capability exception; non-versioned)*
- `GET /libpod/info`
- `GET /libpod/version`
- `GET /libpod/system/df`
- `POST /libpod/system/prune`

### 5.2 Pods

- `GET /libpod/pods/json`
- `POST /libpod/pods/create`
- `GET /libpod/pods/{name}/json`
- `GET /libpod/pods/{name}/exists`
- `POST /libpod/pods/{name}/start`
- `POST /libpod/pods/{name}/stop`
- `POST /libpod/pods/{name}/restart`
- `POST /libpod/pods/{name}/pause`
- `POST /libpod/pods/{name}/unpause`
- `POST /libpod/pods/{name}/kill`
- `DELETE /libpod/pods/{name}`
- `POST /libpod/pods/prune`

### 5.3 Containers

- `GET /libpod/containers/json`
- `POST /libpod/containers/create`
- `GET /libpod/containers/{name}/json`
- `GET /libpod/containers/{name}/exists`
- `POST /libpod/containers/{name}/start`
- `POST /libpod/containers/{name}/stop`
- `POST /libpod/containers/{name}/restart`
- `POST /libpod/containers/{name}/kill`
- `POST /libpod/containers/{name}/pause`
- `POST /libpod/containers/{name}/unpause`
- `DELETE /libpod/containers/{name}`
- `GET /libpod/containers/{name}/logs` *(bounded by log snapshot budget, non-hijack mode only)*
- `POST /libpod/containers/prune`

### 5.4 Images

- `GET /libpod/images/json`
- `GET /libpod/images/{name}/json`
- `GET /libpod/images/{name}/exists`
- `POST /libpod/images/pull`
- `GET /libpod/images/search`
- `DELETE /libpod/images/{name}`
- `POST /libpod/images/prune`
- `POST /libpod/images/{name}/tag`
- `POST /libpod/images/{name}/untag`

### 5.5 Networks

- `GET /libpod/networks/json`
- `POST /libpod/networks/create`
- `GET /libpod/networks/{name}/json`
- `GET /libpod/networks/{name}/exists`
- `POST /libpod/networks/{name}/connect`
- `POST /libpod/networks/{name}/disconnect`
- `DELETE /libpod/networks/{name}`
- `POST /libpod/networks/prune`

### 5.6 Volumes

- `GET /libpod/volumes/json`
- `POST /libpod/volumes/create`
- `GET /libpod/volumes/{name}/json`
- `GET /libpod/volumes/{name}/exists`
- `DELETE /libpod/volumes/{name}`
- `POST /libpod/volumes/prune`

### 5.7 Events

- `GET /libpod/events` with `stream=false` for snapshot windows.
- UI event feed must be bounded to `max events window = 200` and polling policy above.

## 6) Explicitly blocked in v1 (non-MVP)

Blocked by policy even if present in swagger:

- **Compat fallback/API mixing**: any `/*` compat namespace fallback behavior.
- **Attach/hijack/interactive stream endpoints**:
  - `/libpod/containers/{name}/attach`
  - `/libpod/exec/{id}/start` and interactive attach-like flows
- **Build/import/export/archive/cp workflows**:
  - `/libpod/build`
  - `/libpod/images/import`, `/libpod/images/export`, `/libpod/images/{name}/get`, `/libpod/images/load`
  - `/libpod/containers/{name}/archive` (copy in/out)
  - `/libpod/containers/{name}/export`
  - `/libpod/volumes/{name}/export`, `/libpod/volumes/{name}/import`
- **Kubernetes play/apply workflows**:
  - `/libpod/play/kube` and related kube generation/apply paths
- **Rootless runtime mode support** (out of scope in v1)
- **Remote Podman management** (SSH/TCP/remote sockets) in UI/backend
- **Generic proxying**: arbitrary method/path forwarding outside this allowlist

## 7) Reconciliation/autostart semantics (OpenWrt, no systemd)

- v1 must not depend on systemd/Quadlet for boot recovery.
- Service model is OpenWrt `procd` + explicit reconciliation helper.
- Reconciliation target set:
  - pods/containers with restart policy `always`, `unless-stopped`, or `on-failure`
  - skip already-running resources
  - preserve intentionally stopped resources
- Single-pass ordering: **pods first, then standalone containers**.
- Per-resource reconciliation timeout: **30s**, continue-on-error with per-resource audit record.

## 8) Contract authority

- Source snapshot: local `swagger-latest.yaml` in this workspace.
- This file is the design-time contract for MVP implementation and review.
- Any endpoint outside this file requires explicit contract update before code use.
