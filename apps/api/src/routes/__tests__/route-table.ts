// The routes the API registers, read from the Express router stack, so a spec can fail on a route nobody classified
// (REV-206 for the token, REV-209 for the studio)

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  name?: string;
  regexp?: RegExp;
  handle?: { stack?: Layer[] };
}

const prefixOf = (layer: Layer): string =>
  (layer.regexp?.source ?? '')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/^\^/, '')
    .replace(/\\\//g, '/')
    .replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, ':param');

const routesOf = (stack: Layer[], prefix = ''): string[] =>
  stack.flatMap((layer) => {
    if (layer.route) {
      const paths = [layer.route.path].flat();
      return Object.keys(layer.route.methods).flatMap((method) =>
        paths.map((path) => `${method.toUpperCase()} ${prefix}${path}`.replace(/\/$/, '')),
      );
    }
    if (layer.name === 'router' && layer.handle?.stack) return routesOf(layer.handle.stack, prefix + prefixOf(layer));
    return [];
  });

/** Every route of the API router, as `METHOD /path` relative to the API prefix */
export function listApiRoutes(app: unknown): string[] {
  const api = (app as { _router: { stack: Layer[] } })._router.stack.find((layer) => layer.name === 'router' && layer.handle?.stack)!;
  return routesOf(api.handle!.stack!);
}
