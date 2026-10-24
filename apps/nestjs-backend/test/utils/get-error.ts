import type { HttpError } from '@cybernetics/core';

export const getError = async (call: () => unknown) => {
  try {
    await call();
    return;
  } catch (error: unknown) {
    return error as HttpError;
  }
};
