export type AuthRole = 'ADMIN' | 'DEVELOPER' | 'USER';

export type LocalAuthUser = {
  id: string;
  uid: string;
  email: string | null;
  username?: string | null;
  displayName: string | null;
  photoURL: string | null;
  hasPassword?: boolean;
  role?: AuthRole;
  capabilities?: { developer: boolean; admin: boolean };
  projectRoles?: {
    memberships?: Array<{ projectId: string; role: 'OWNER' | 'MEMBER' }>;
    teamLeaderGrants?: Array<{ projectId: string; expiresAt?: string | null }>;
    projectDeveloperGrants?: Array<{ projectId: string; expiresAt?: string | null }>;
  };
};
