# Paramount E-mart — Architecture Notes

## Server

`server.js` is a **zero-dependency pure Node.js HTTP server** — no Express, no Mongoose.
It handles file serving, gzip, ETags, sessions, rate limiting, backups, and analytics
using only Node.js built-ins.

## Dead Code (safe to delete)

The following files exist from an earlier Express/Mongoose design but are NOT used:

- `routes/` — Express route handlers (unused)
- `middleware/` — Express middleware (unused)  
- `models/` — Mongoose schemas (unused)
- `services/emailService.js` — Express-based email service (unused; server.js has its own)

These can be deleted to clean up the project without affecting functionality.

## Dependencies

`package.json` lists Express, Mongoose, Stripe, etc. — **none are required** by `server.js`.
The only runtime dependency is Node.js ≥ 16.

Run with: `node server.js`
