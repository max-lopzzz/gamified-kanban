export class NotLinkedError extends Error {}
export class ForbiddenError extends Error {}
export class ApiUnreachableError extends Error {}

export function createApi({ baseUrl, botSecret }) {
  async function call(path, { method = "GET", token, headers = {}, body } = {}) {
    let res;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiUnreachableError(err.message);
    }
    if (res.status === 401) throw new NotLinkedError("token rejected");
    if (res.status === 403 || res.status === 404) {
      throw new ForbiddenError(`${res.status} on ${path}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  return {
    getBoards: (token) => call("/api/boards", { token }),
    getBoard: (token, boardId) => call(`/api/boards/${boardId}`, { token }),
    redeemCode: ({ code, discordUserId }) =>
      call("/api/bot/discord/redeem", {
        method: "POST",
        headers: { "x-bot-secret": botSecret },
        body: { code, discordUserId },
      }),
  };
}
