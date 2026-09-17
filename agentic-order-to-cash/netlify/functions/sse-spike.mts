import type { Config } from "@netlify/functions";

// Day-1 transport spike: proves SSE streams unbuffered through Netlify's CDN.
// Ten events, 400ms apart. If curl sees them arrive spread over ~4s, we're good;
// if they arrive in one burst at the end, something is buffering.
export default async (_req: Request) => {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 10; i++) {
        controller.enqueue(
          enc.encode(`event: tick\ndata: {"i":${i},"serverTime":${Date.now()}}\n\n`),
        );
        await new Promise((r) => setTimeout(r, 400));
      }
      controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
};

export const config: Config = {
  path: "/api/sse-spike",
};
