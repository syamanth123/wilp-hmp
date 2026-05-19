import type { RoleName } from '@hmp/db';

declare module 'next-auth' {
  interface User {
    roles?: RoleName[];
    permissions?: string[];
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      roles: RoleName[];
      permissions: string[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    roles?: RoleName[];
    permissions?: string[];
  }
}
