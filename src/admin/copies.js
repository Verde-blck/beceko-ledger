import { businessToken } from './token.js';

const TIMEOUT_MS = 25_000;

export function copiesClient({ operatorSecret, fetchImpl = fetch }) {
  async function call(business, path, body) {
    let response;
    try {
      response = await fetchImpl(`${business.url}/api/admin/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${businessToken(operatorSecret, business.id)}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        error.name === 'TimeoutError'
          ? 'It did not answer in time. If it was asleep, refresh in a moment.'
          : 'It could not be reached. Check the address and that the service is online.',
      );
    }
    const data = await response.json().catch(() => null);
    if (response.status === 404) throw new Error('The admin connection is not set up on this copy. Set its ADMIN_TOKEN.');
    if (response.status === 401) throw new Error('The ADMIN_TOKEN on this copy does not match. Copy it again from its token page.');
    if (!response.ok) throw new Error(data?.error ?? `It replied with an error (${response.status}).`);
    return data;
  }

  return {
    status: (business) => call(business, 'status'),
    update: (business, change) => call(business, 'subscription', change),
  };
}
