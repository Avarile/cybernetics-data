/* eslint-disable @typescript-eslint/naming-convention */
import {
  AGENT_ROBOT_ID,
  ANONYMOUS_USER_ID,
  APP_ROBOT_ID,
  AUTOMATION_ROBOT_ID,
  HttpErrorCode,
} from '@cybernetics/core';
import type { CanActivate } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';

const NON_HUMAN_IDS = new Set([
  AGENT_ROBOT_ID,
  APP_ROBOT_ID,
  AUTOMATION_ROBOT_ID,
  ANONYMOUS_USER_ID,
  'aiRobot',
  'system',
]);

const denied = () =>
  new CustomHttpException(
    'Only instance admins can use the agent',
    HttpErrorCode.RESTRICTED_RESOURCE,
    {
      localization: { i18nKey: 'httpErrors.permission.userNotAdmin' },
    }
  );

/**
 * Every /api/agent route: a signed-in instance admin using a session. Personal access tokens,
 * share links, template previews, robots and anonymous users are refused (design §9.1).
 */
@Injectable()
export class AgentAdminGuard implements CanActivate {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  canActivate(): boolean {
    const user = this.cls.get('user');
    if (!user?.id || NON_HUMAN_IDS.has(user.id)) throw denied();
    if (this.cls.get('accessTokenId')) throw denied();
    if (this.cls.get('baseShare') || this.cls.get('template') || this.cls.get('tempAuthBaseId')) {
      throw denied();
    }
    if (user.isAdmin !== true) throw denied();
    return true;
  }
}
