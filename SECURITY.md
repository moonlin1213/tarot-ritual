# Security and privacy

This application is a **single-user loopback service**, not an Internet-facing API. Do not expose it through port forwarding, tunnels or a public reverse proxy.

DSH access is opt-in. Custom keys remain in page memory. The local service sends authentication and reading inputs only to the selected provider; it cannot control that provider's retention policies. Avoid sensitive questions and photos. Other local processes and privileged browser extensions are outside this threat model.

For a suspected security issue, use GitHub's private vulnerability reporting if available. Do not post working credentials, DSH files, unredacted HAR files, personal readings or photos in a public issue. If private reporting is unavailable, open only a minimal issue asking for a private contact channel, without exploit details or secrets.

If a real secret was accidentally published, revoke/rotate it first. Deleting the file in a later commit does not remove it from Git history or previously downloaded copies.
