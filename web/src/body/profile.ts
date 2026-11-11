// Moved to api/_lib/fit/profile.ts so the ChatGPT plugin (api/mcp.ts) runs the same code: Vercel compiles api/ as
// CommonJS and web/ as ES modules, so a function can't load modules from web/src. Shared code lives in api/_lib (as
// look.ts and uniqlo.ts already do) and the web app imports it through @api.
export * from '@api/fit/profile';
