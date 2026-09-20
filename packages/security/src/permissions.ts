import type { Permission, PermissionLevel } from '@tahlely/domain';
import { READ_PERMISSIONS } from '@tahlely/domain';

/**
 * Default levels for a fresh project policy. Reads are allowed (analysis must
 * be frictionless); every mutation or external effect requires approval or is
 * denied outright.
 */
export const DEFAULT_POLICY_LEVELS: Record<Permission, PermissionLevel> = {
  READ_FILE: 'allow',
  READ_DIRECTORY: 'allow',
  WRITE_FILE: 'require-approval',
  CREATE_FILE: 'require-approval',
  RENAME_FILE: 'require-approval',
  MOVE_FILE: 'require-approval',
  DELETE_FILE: 'require-approval',
  RUN_COMMAND: 'require-approval',
  INSTALL_PACKAGE: 'require-approval',
  NETWORK_ACCESS: 'require-approval',
  GIT_READ: 'allow',
  GIT_WRITE: 'require-approval',
  GIT_COMMIT: 'require-approval',
  GIT_PUSH: 'deny',
  DATABASE_ACCESS: 'require-approval',
  SYSTEM_ACCESS: 'deny',
};

export function isReadPermission(permission: Permission): boolean {
  return (READ_PERMISSIONS as readonly string[]).includes(permission);
}

/** Permissions that can never be auto-approved by policy (deny-only ceiling). */
export const ALWAYS_DENY_BY_DEFAULT: readonly Permission[] = ['SYSTEM_ACCESS'];
