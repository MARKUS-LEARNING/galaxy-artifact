# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not open a public GitHub issue**.

Instead, report it via one of these methods:
- Open a [GitHub Security Advisory](https://github.com/MARKUS-LEARNING/galaxy-artifact/security/advisories/new) (private disclosure)

I will acknowledge the report within 72 hours and aim to release a fix within 14 days for confirmed vulnerabilities.

## Scope

This is a **client-side only** static web application. There is no server, no database,
and no user accounts. All CSV data you upload is processed entirely in your own browser
and is never transmitted to any server.

## Known Limitations

- This app runs on GitHub Pages, which does not support server-side HTTP security headers.
  A `<meta>` Content Security Policy tag is used as a mitigation.
- Users are responsible for the CSV files they upload. Do not upload files containing
  sensitive or personally identifiable information (PII).
