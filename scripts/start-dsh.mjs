// Explicit opt-in, portable across Windows, macOS and Linux shells.
process.env.TAROT_DSH_IMPORT = '1';
await import('../server.mjs');
