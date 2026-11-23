# Security baseline

- Never commit API keys, passwords, signing keys or tokens.
- Use secure secret storage (GitHub Actions secrets / cloud secret manager).
- Apply least-privilege GitHub permissions.
- Protect user repositories and project data.
- Never expose private credentials in logs.
- CI scans the built debug APK for server secret markers.