# Security Policy

Solo-maintained project. Reports are triaged best-effort, no SLA.

## Supported versions

Only the latest release. No LTS branch — if you're running an older build, upgrade first.

## Threat model

Acrobat Clone runs entirely on your local machine — no cloud, no telemetry, no accounts. Realistic attack surface:

- **Malicious PDFs** — crafted documents exploiting PDF.js or pdf-lib parsing.
- **Electron-specific** — sandbox bypass, `contextBridge` misuse, IPC abuse.
- **Supply chain** — npm dependency compromise.

Out of scope because the feature doesn't exist: authentication, server-side issues, cloud OCR/storage.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/newhashbrown/acrobat-clone/security/advisories/new). It keeps the report private until a fix lands and gives us a coordinated disclosure path.

Please include:

- Affected version or commit SHA
- Reproduction steps or a sample PDF that triggers the issue
- Impact (crash, info disclosure, RCE, etc.)

I'll acknowledge within a week and keep you in the loop. Happy to credit you in release notes if you want.

## What is NOT a vulnerability

Documented limitations from the [README](./README.md#limitations):

- **Visual-only redaction.** Black rectangles don't remove underlying text from the PDF content stream. True redaction is a planned Tier 2 feature.
- **Helvetica-encoded OCR text layer.** Non-Latin glyphs may be dropped from the searchable layer; the visible OCR results in the side panel are intact.
- **Sanitize doesn't remove hidden text, hidden layers, or cropped content.**

Documentation that misleads users about any of these *is* worth reporting — open an issue or Discussion instead of a security advisory.
