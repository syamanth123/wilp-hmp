import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, type RoleName } from '@hmp/db';
import { loadUserAccess } from './rbac';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Required for NextAuth v5 in production builds behind any reverse proxy
  // or when running under `next start` on http://localhost (CI e2e). Without
  // this, NextAuth refuses to honour the Host header and the session cookie
  // set by signIn isn't recognized on the redirect — the middleware bounces
  // every authed request back to /login. Dev mode is permissive and hides it.
  // See https://authjs.dev/reference/nextjs#trusthost
  trustHost: true,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active || !user.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    // NOTE: SSO provider plugs in here. Implement OIDC/SAML provider in `sso.ts`
    // and add a `next-auth` provider that delegates to it.
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        const access = await loadUserAccess(user.id);
        token.uid = user.id;
        token.roles = access.roles;
        token.permissions = access.permissions;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user = {
          ...session.user,
          id: token.uid as string,
          roles: (token.roles ?? []) as RoleName[],
          permissions: (token.permissions ?? []) as string[],
        };
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
