/**
 * Normalises a managed-provider Postgres URL for use with an explicit `ssl`
 * option.
 *
 * DigitalOcean hands out URLs ending in `?sslmode=require`. Recent pg versions
 * treat `require` as an alias for `verify-full`, and the URL parameter takes
 * precedence over the `ssl` object passed alongside it — so full CA
 * verification is attempted and fails against DO's self-signed chain with
 * SELF_SIGNED_CERT_IN_CHAIN.
 *
 * Dropping the parameter lets the explicit `ssl` option decide, which still
 * encrypts the connection but does not pin the CA.
 */
export function stripSslMode(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    // Not a parseable URL; hand it back untouched rather than lose the value.
    return url;
  }
}
