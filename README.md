# VSPH Control Center — Backend migration

**Development branch:** `migration/fastify-backend-parity` in `ThunderKhan/app-vsph-backend`.

The production behavior reference is `ThunderKhan/vsph-control-center@3b3a1535873aa0517aea41da32a407f3d9680547`, not the earlier v3 scaffold. Next.js remains a separately deployed frontend; its server-only `VSPH_INTERNAL_API_ORIGIN` should point to the Fastify origin only after contract, identity and staging acceptance.

**Stack:** Node.js 24, TypeScript, Fastify 5, Supabase Auth, existing Supabase-hosted PostgreSQL and service-only SQL RPCs, Zod. Prisma 7 will be configured against an approved disposable database or verified schema snapshot; it must not replace privileged SQL/RPC or migrate live data.

Start with Node 24 and `npm install` only in a development environment with approved network/dependency access. Run `npm run check`, then `npm run dev`. The documented `npm ci`/Docker build is **blocked until a reviewed package-lock.json exists**. Do not connect this partial implementation to production traffic.

See [migration progress](docs/migration/PROGRESS.md) for currently implemented endpoints, outstanding compatibility and security gates. The source Express application and its tests remain the functional authority until fully ported.
