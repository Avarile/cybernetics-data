import { HttpErrorCode } from '@teable/core';
import { READ_PATH } from '@teable/openapi';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import { CustomHttpException } from '../../../custom.exception';

export type IImportUrlTarget =
  // An attachment served by this app, given as a path.
  | { kind: 'relative'; path: string }
  // A full URL. `trusted` is true for configured storage hosts and for this
  // app's own attachment reads; anything else must be fetched SSRF-safely.
  | { kind: 'absolute'; url: string; trusted: boolean };

const attachmentReadPrefix = `${READ_PATH}/`;

const invalidImportUrl = () =>
  new CustomHttpException('Invalid import file URL', HttpErrorCode.VALIDATION_ERROR);

const toHostname = (value?: string) => {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    // MinIO endpoints are configured as bare hostnames.
    return value.toLowerCase();
  }
};

const getStorageHosts = () => {
  const { publicUrl, privateBucketEndpoint, minio, s3 } = storageConfig();
  return new Set(
    [
      publicUrl,
      privateBucketEndpoint,
      s3.endpoint,
      s3.internalEndpoint,
      minio.endPoint,
      minio.internalEndPoint,
    ]
      .map(toHostname)
      .filter((host): host is string => Boolean(host))
  );
};

const getAppHosts = () => {
  const { publicOrigin, storagePrefix } = baseConfig();
  return new Set(
    [publicOrigin, storagePrefix].map(toHostname).filter((host): host is string => Boolean(host))
  );
};

/**
 * Classifies the URL a user gave for an import. Relative URLs may only point at
 * attachment reads; absolute URLs must be http(s). Users can import from any
 * public URL, so untrusted absolute URLs are allowed but must be fetched with
 * the SSRF-safe agent (or checked with assertPublicHost).
 */
export const classifyImportUrl = (rawUrl: string): IImportUrlTarget => {
  const value = rawUrl.trim();

  if (value.startsWith('/') && !value.startsWith('//')) {
    if (!value.startsWith(attachmentReadPrefix)) {
      throw invalidImportUrl();
    }
    return { kind: 'relative', path: value };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidImportUrl();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidImportUrl();
  }

  const host = parsed.hostname.toLowerCase();
  const trusted =
    getStorageHosts().has(host) ||
    (getAppHosts().has(host) && parsed.pathname.startsWith(attachmentReadPrefix));

  return { kind: 'absolute', url: parsed.toString(), trusted };
};
