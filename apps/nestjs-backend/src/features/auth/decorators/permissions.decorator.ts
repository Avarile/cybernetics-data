import type { Action } from '@cybernetics/core';
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Permissions = (...permissions: Action[]) => SetMetadata(PERMISSIONS_KEY, permissions);
