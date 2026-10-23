import type { IUser } from '@cybernetics/sdk';
import { axios } from './axios';

export async function getUserMe(cookie?: string) {
  return await axios
    .get<IUser>(`/auth/user/me`, {
      headers: { cookie },
    })
    .then(({ data }) => data);
}
