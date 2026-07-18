# Security policy

## Reporting

Please report suspected vulnerabilities privately through GitHub Security Advisories for this repository. Do not attach malicious KML/KMZ payloads to a public issue.

## Threat model

The selected KML/KMZ is untrusted. The plugin assumes XML, description HTML, archive names, compressed sizes, asset URLs, and NetworkLinks can be malicious. It does not assume a malicious installed plugin: GeoLibre external plugins already execute as trusted code in the host document.

## Controls

- no DTD, external entity, or entity declaration processing
- allowlist-based description HTML sanitization; scripts/styles/iframes/objects/forms/SVG/MathML removed
- event/style attributes removed; only safe link/image attributes retained
- only HTTP(S) links retained in sanitized HTML; only HTTPS NetworkLinks are fetched
- safe in-memory archive path normalization; no filesystem extraction
- compressed, entry-count, entry-size, total-size, ratio, linked-response, depth, and resource limits
- archive asset result caching to avoid repeated inflation
- network fetches omit credentials and use a recursion visited set

## Residual risks

- DOMParser and JSZip are dependencies exposed to adversarial input; keep dependencies updated.
- Declared ZIP sizes come from archive metadata. JSZip extraction is still bounded after extraction for renderable assets, but JavaScript cannot cancel every decompressor operation mid-entry.
- A maximum-size but valid XML document can consume significant CPU and memory. v0.2 should move parsing into a cancellable Web Worker.
- Remote content may reveal the user's IP address when the NetworkLink option is enabled. It is disabled by default.
