// A mistake in one request must not take the whole site down (Railway would show a "502 Bad gateway" while it restarts).
// The error is written to the logs, and the site carries on.
process.on('unhandledRejection', e => console.error('[unhandled rejection]', e && e.stack || e));
process.on('uncaughtException', e => console.error('[uncaught exception]', e && e.stack || e));
