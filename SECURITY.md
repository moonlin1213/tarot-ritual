# Security and privacy

This application is a **single-user loopback service**, not an Internet-facing API. Do not expose it through port forwarding, tunnels or a public reverse proxy.

DSH access is opt-in through the same-origin Import button or `TAROT_DSH_IMPORT=1` at startup. Button consent lasts for the current local server process; it is not written to disk. The import endpoint requires POST, JSON, explicit consent and the existing Host/Origin/request-marker checks. Import itself makes no provider requests and returns no API keys or OAuth tokens. Custom keys remain in page memory. The local service sends authentication and reading inputs only to the selected provider; it cannot control that provider's retention policies. Avoid sensitive questions and photos. Other local processes and privileged browser extensions are outside this threat model.

An additional local-only opt-in, `TAROT_DSH_OAUTH_REFRESH=1`, delegates Codex renewal to an explicitly configured installed DSH module. This changes the read-only boundary: it may rotate and persist DSH OAuth credentials using DSH's own cross-process lock and atomic owner-only writes. It does not refresh during startup/import, expose credentials in metadata, or automatically retry a model request. Rotated tokens shared with another client can affect its login. Module paths are server configuration, never request parameters; configure only trusted local code. A missing module fails closed.

For a suspected security issue, use GitHub's private vulnerability reporting if available. Do not post working credentials, DSH files, unredacted HAR files, personal readings or photos in a public issue. If private reporting is unavailable, open only a minimal issue asking for a private contact channel, without exploit details or secrets.

If a real secret was accidentally published, revoke/rotate it first. Deleting the file in a later commit does not remove it from Git history or previously downloaded copies.
