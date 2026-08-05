# Contract-test regression fixtures

Each file here is a **faithful replay of a defect that actually shipped**, reduced
to the smallest page that still reproduces it. They exist so
`tests/web-client-server-contract.test.js` can prove it catches the bugs it
claims to catch — a contract test nobody has watched fail is a green light of
unknown value.

The base constants are copied verbatim out of git history, not paraphrased.
Verify with the commands in each file's header comment.

| Fixture | Defect | Shipped | Caught by |
|---|---|---|---|
| `01-brain-api-null-origin.html` | `BRAIN_API = location.origin + '/__brain'` — on a `file://` page `location.origin` is the STRING `"null"`, so the base became `"null/__brain"` and `new URL()` threw `TypeError` out of every panel | pre-`91a5c98` | **(b1)** `base-url` under `file:` |
| `02-brain-api-direct-8001.html` | the *fix* for 01: repoint `BRAIN_API` straight at `:8001`, because a grep for `/__brain` in **this** repo found nothing. The route lives in `sentinel-desktop`. Parses fine everywhere; still breaks every client behind the Cloudflare Tunnel, which has no route to the server's `:8001` | `91a5c98`, merged in #61, reverted in #62 | **(b2)** `base-cross-origin` under `http:` and `https:` |
| `03-missing-server-route.html` | `/api/files`, `/api/files/content`, `/api/files/download`, `/api/conversations` called with no server handler — 404 on every file/conversation panel | pre-`v31.1.0` of sentinel-desktop | **(a)** `route` |
| `04-undeclared-base-prefix.html` | a base introducing a path prefix no server declares | hypothetical — the generalisation of 01/02 | **(c)** `base-prefix` |

Fixture 02 is the important one. It is the reason check (b) is not just "does
`new URL()` throw": that base parses cleanly under every protocol, so a
URL-validity check waves it straight through. The invariant it violates is
**same-origin** — a base must address the origin that served the page, or the
dashboard only works on the machine the server runs on.

Fixtures 01 and 02 are also replayed against the **real**
`web/dashboard-prime.html` by the `historical regressions` describe block, by
substituting the base constant in memory. That guards against the fixtures
drifting into something the real page could never contain.
