'use client';

import {
  Component,
  createContext,
  startTransition,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  AnchorHTMLAttributes,
  MouseEvent,
  ReactElement,
  ReactNode,
  Ref,
  RefObject,
  TransitionFunction,
} from 'react';
import { preloadModule } from 'react-dom';
import { getErrorInfo } from '../lib/utils/custom-errors.js';
import { addBase, removeBase } from '../lib/utils/path.js';
import {
  Root,
  Slot,
  unstable_prefetchRsc as prefetchRsc,
  unstable_registerCallServerElementsListener as registerCallServerElementsListener,
  useElementsPromise_UNSTABLE as useElementsPromise,
  useFetchRscStore_UNSTABLE as useFetchRscStore,
  useRefetch,
  unstable_withEnhanceFetchFn as withEnhanceFetchFn,
} from '../minimal/client.js';
import type { RouteConfig } from './base-types.js';
import {
  HAS404_ID,
  IS_STATIC_ID,
  ROUTE_ID,
  SKIP_HEADER,
  encodeRoutePath,
  encodeSliceId,
  pathnameToRoutePath,
} from './common.js';
import type { RouteProps } from './common.js';

type AllowTrailingSlash<Path extends string> = Path extends '/'
  ? Path
  : Path | `${Path}/`;

type AllowPathDecorators<Path extends string> = Path extends unknown
  ?
      | AllowTrailingSlash<Path>
      | `${AllowTrailingSlash<Path>}?${string}`
      | `${AllowTrailingSlash<Path>}#${string}`
      | `?${string}`
      | `#${string}`
  : never;

type InferredPaths = RouteConfig extends {
  paths: infer UserPaths extends string;
}
  ? AllowPathDecorators<UserPaths>
  : string;

const pathnameToCurrentRoutePath = (pathname: string) =>
  pathnameToRoutePath(
    removeBase(pathname, import.meta.env.WAKU_CONFIG_BASE_PATH),
  );

const parseRoute = (url: URL): RouteProps => {
  const { pathname, searchParams, hash } = url;
  return {
    path: pathnameToCurrentRoutePath(pathname),
    query: searchParams.toString(),
    hash,
  };
};

// @ts-expect-error tbd
const getRouteUrl = (route: RouteProps): URL => {
  const nextUrl = new URL(window.location.href);
  nextUrl.pathname = route.path;
  nextUrl.search = route.query;
  nextUrl.hash = route.hash;
  return nextUrl;
};

const getHttpStatusFromMeta = (): string | undefined => {
  const httpStatusMeta = document.querySelector('meta[name="httpstatus"]');
  if (
    httpStatusMeta &&
    'content' in httpStatusMeta &&
    typeof httpStatusMeta.content === 'string'
  ) {
    return httpStatusMeta.content;
  }
  return undefined;
};

const parseRouteFromLocation = (): RouteProps => {
  const httpStatus = getHttpStatusFromMeta();
  if (httpStatus === '404') {
    return { path: '/404', query: '', hash: '' };
  }
  return parseRoute(new URL(window.location.href));
};

const isPathChange = (next: RouteProps, prev: RouteProps) =>
  next.path !== prev.path;

// @ts-expect-error tbd
const isHashChange = (next: RouteProps, prev: RouteProps) =>
  next.hash !== prev.hash;

const isSameRoute = (next: RouteProps, prev: RouteProps) =>
  next.path === prev.path &&
  next.query === prev.query &&
  next.hash === prev.hash;

let savedRscParams: [query: string, rscParams: URLSearchParams] | undefined;

const createRscParams = (query: string): URLSearchParams => {
  if (savedRscParams && savedRscParams[0] === query) {
    return savedRscParams[1];
  }
  const rscParams = new URLSearchParams({ query });
  savedRscParams = [query, rscParams];
  return rscParams;
};

type ChangeRouteOptions = {
  shouldScroll: boolean;
  refetch?: boolean; // true: force refetch, false: don't refetch, undefined: auto-decide based on route change
  mode?: undefined | 'push' | 'replace';
  url?: URL | undefined;
  signal?: AbortSignal;
  unstable_startTransition?: ((fn: TransitionFunction) => void) | undefined;
};

type ChangeRoute = (
  route: RouteProps,
  options: ChangeRouteOptions,
) => Promise<void>;

type PrefetchRoute = (route: RouteProps) => void;

type SliceId = string;

// This is an internal thing, not a public API
const RouterContext = createContext<{
  route: RouteProps;
  changeRoute: ChangeRoute;
  prefetchRoute: PrefetchRoute;
  fetchingSlices: Set<SliceId>;
} | null>(null);

export function useRouter() {
  const router = use(RouterContext);
  if (!router) {
    throw new Error('Missing Router');
  }

  const { route, prefetchRoute } = router;
  /**
   * @deprecated use window.navigation.navigate() instead
   */
  const push = useCallback((to: InferredPaths) => {
    to = addBase(to, import.meta.env.WAKU_CONFIG_BASE_PATH);
    window.navigation.navigate(to);
  }, []);
  /**
   * @deprecated use window.navigation.navigate() instead
   */
  const replace = useCallback((to: InferredPaths) => {
    to = addBase(to, import.meta.env.WAKU_CONFIG_BASE_PATH);
    window.navigation.navigate(to, { history: 'replace' });
  }, []);
  /**
   * @deprecated use window.navigation.reload() instead
   */
  const reload = useCallback(async () => {
    window.navigation.reload();
  }, []);
  /**
   * @deprecated use window.navigation.back() instead
   */
  const back = useCallback(() => {
    window.navigation.back();
  }, []);
  /**
   * @deprecated use window.navigation.forward() instead
   */
  const forward = useCallback(() => {
    window.navigation.forward();
  }, []);
  const prefetch = useCallback(
    (to: string) => {
      const url = new URL(to, window.location.href);
      prefetchRoute(parseRoute(url));
    },
    [prefetchRoute],
  );
  return {
    ...route,
    push,
    replace,
    reload,
    back,
    forward,
    prefetch,
  };
}

function useSharedRef<T>(
  ref: Ref<T | null> | undefined,
): [RefObject<T | null>, (node: T | null) => void | (() => void)] {
  const managedRef = useRef<T>(null);

  const handleRef = useCallback(
    (node: T | null): void | (() => void) => {
      managedRef.current = node;
      const isRefCallback = typeof ref === 'function';
      let cleanup: void | (() => void);
      if (isRefCallback) {
        cleanup = ref(node);
      } else if (ref) {
        // TODO is this a false positive?
        // eslint-disable-next-line react-hooks/immutability
        ref.current = node;
      }
      return () => {
        managedRef.current = null;
        if (isRefCallback) {
          if (cleanup) {
            cleanup();
          } else {
            ref(null);
          }
        } else if (ref) {
          ref.current = null;
        }
      };
    },
    [ref],
  );

  return [managedRef, handleRef];
}

export type LinkProps = {
  to: InferredPaths;
  children: ReactNode;
  unstable_prefetchOnEnter?: boolean;
  unstable_prefetchOnView?: boolean;
  ref?: Ref<HTMLAnchorElement> | undefined;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

export function Link({
  to,
  children,
  unstable_prefetchOnEnter,
  unstable_prefetchOnView,
  ref: refProp,
  ...props
}: LinkProps): ReactElement {
  to = addBase(to, import.meta.env.WAKU_CONFIG_BASE_PATH);
  const router = use(RouterContext);
  const prefetchRoute = router
    ? router.prefetchRoute
    : () => {
        throw new Error('Missing Router');
      };
  const [ref, setRef] = useSharedRef<HTMLAnchorElement>(refProp);

  useEffect(() => {
    if (!unstable_prefetchOnView || !ref.current) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const url = new URL(to, window.location.href);
            if (router && url.href !== window.location.href) {
              router.prefetchRoute(parseRoute(url));
            }
          }
        });
      },
      { threshold: 0.1 },
    );

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
    };
  }, [unstable_prefetchOnView, router, to, ref]);
  const onMouseEnter = unstable_prefetchOnEnter
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        const url = new URL(to, window.location.href);
        if (url.href !== window.location.href) {
          prefetchRoute(parseRoute(url));
        }
        props.onMouseEnter?.(event);
      }
    : props.onMouseEnter;
  const ele = (
    <a {...props} href={to} onMouseEnter={onMouseEnter} ref={setRef}>
      {children}
    </a>
  );
  return ele;
}

const notAvailableInServer = (name: string) => () => {
  throw new Error(`${name} is not in the server`);
};

function renderError(message: string) {
  return (
    <html>
      <head>
        <title>Unhandled Error</title>
      </head>
      <body
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          placeContent: 'center',
          placeItems: 'center',
          fontSize: '16px',
          margin: 0,
        }}
      >
        <h1>Caught an unexpected error</h1>
        <p>Error: {message}</p>
      </body>
    </html>
  );
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: unknown }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = {};
  }
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if ('error' in this.state) {
      if (this.state.error instanceof Error) {
        return renderError(this.state.error.message);
      }
      return renderError(String(this.state.error));
    }
    return this.props.children;
  }
}

const NotFound = ({
  error,
  has404,
  reset,
  handledErrorSet,
}: {
  error: unknown;
  has404: boolean;
  reset: () => void;
  handledErrorSet: WeakSet<object>;
}) => {
  const router = use(RouterContext);
  if (!router) {
    throw new Error('Missing Router');
  }
  const { changeRoute } = router;
  useEffect(() => {
    if (has404) {
      if (handledErrorSet.has(error as object)) {
        return;
      }
      handledErrorSet.add(error as object);
      const url = new URL('/404', window.location.href);
      changeRoute(parseRoute(url), { shouldScroll: false })
        .then(() => {
          reset();
        })
        .catch((err) => {
          console.log('Error while navigating to 404:', err);
        });
    }
  }, [error, has404, reset, changeRoute, handledErrorSet]);
  return has404 ? null : <h1>Not Found</h1>;
};

const Redirect = ({
  error,
  to,
  handledErrorSet,
}: {
  error: unknown;
  to: string;
  handledErrorSet: WeakSet<object>;
}) => {
  const router = use(RouterContext);
  if (!router) {
    throw new Error('Missing Router');
  }
  const { changeRoute } = router;
  useEffect(() => {
    // ensure single re-fetch per server redirection error on StrictMode
    // https://github.com/wakujs/waku/pull/1512
    if (handledErrorSet.has(error as object)) {
      return;
    }
    handledErrorSet.add(error as object);

    const url = new URL(to, window.location.href);
    // FIXME this condition seems too naive
    if (url.hostname !== window.location.hostname) {
      window.location.replace(to);
      return;
    }
    const currentPath = window.location.pathname;
    const newPath = url.pathname !== currentPath;
    const historyUrl = url.origin === window.location.origin ? url : undefined;
    changeRoute(parseRoute(url), {
      shouldScroll: newPath,
      mode: 'replace',
      url: historyUrl,
    })
      .then(() => {
        handledErrorSet.delete(error as object);
        // FIXME: As we understand it, we should have a proper solution.
        setTimeout(() => {
          // @ts-expect-error tbd
          reset();
        }, 1);
      })
      .catch((err) => {
        handledErrorSet.delete(error as object);
        console.log('Error while navigating to redirect:', err);
      });
  }, [error, to, handledErrorSet]);
  return null;
};

class CustomErrorHandler extends Component<
  { has404: boolean; children?: ReactNode },
  { error: unknown | null }
> {
  #handledErrorSet = new WeakSet();
  #prevLocation = {} as Location;
  constructor(props: {
    has404: boolean;
    error: unknown;
    children?: ReactNode;
  }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidMount() {
    this.#prevLocation = window.location;
  }
  componentDidUpdate() {
    if (this.state.error !== null && this.#prevLocation !== window.location) {
      this.setState({ error: null });
    }
    this.#prevLocation = window.location;
  }
  reset = () => {
    this.setState({ error: null });
  };
  render() {
    if (this.state.error !== null) {
      const info = getErrorInfo(this.state.error);
      if (info?.status === 404) {
        return (
          <NotFound
            // @ts-expect-error tbd
            error={error}
            has404={this.props.has404}
            reset={this.reset}
            handledErrorSet={this.#handledErrorSet}
          />
        );
      }
      if (info?.location) {
        return (
          <Redirect
            error={this.state.error}
            to={info.location}
            handledErrorSet={this.#handledErrorSet}
          />
        );
      }
      throw this.state.error;
    }
    return this.props.children;
  }
}

const getRouteSlotId = (path: string) => 'route:' + path;
const getSliceSlotId = (id: SliceId) => 'slice:' + id;

export function Slice({
  id,
  children,
  ...props
}: {
  id: SliceId;
  children?: ReactNode;
} & (
  | {
      lazy?: false;
    }
  | {
      lazy: true;
      fallback: ReactNode;
    }
)) {
  const router = use(RouterContext);
  if (!router) {
    throw new Error('Missing Router');
  }
  const { fetchingSlices } = router;
  const refetch = useRefetch();
  const slotId = getSliceSlotId(id);
  const elementsPromise = useElementsPromise();
  const elements = use(elementsPromise);
  const needsToFetchSlice =
    props.lazy &&
    (!(slotId in elements) ||
      // FIXME: hard-coded for now
      elements[IS_STATIC_ID + ':' + slotId] !== true);
  useEffect(() => {
    // FIXME this works because of subtle timing behavior.
    if (needsToFetchSlice && !fetchingSlices.has(id)) {
      fetchingSlices.add(id);
      const rscPath = encodeSliceId(id);
      refetch(rscPath)
        .catch((e) => {
          console.error('Failed to fetch slice:', e);
        })
        .finally(() => {
          fetchingSlices.delete(id);
        });
    }
  }, [fetchingSlices, refetch, id, needsToFetchSlice]);
  if (props.lazy && !(slotId in elements)) {
    // FIXME the fallback doesn't show on refetch after the first one.
    return props.fallback;
  }
  return <Slot id={slotId}>{children}</Slot>;
}
const defaultRouteInterceptor = (route: RouteProps) => route;

const InnerRouter = ({
  initialRoute,
  httpStatus,
  // @ts-expect-error tbd
  routeInterceptor = defaultRouteInterceptor,
}: {
  initialRoute: RouteProps;
  httpStatus: string | undefined;
  routeInterceptor: ((route: RouteProps) => RouteProps | false) | undefined;
}) => {
  if (import.meta.hot) {
    const refetchRoute = () => {
      staticPathSetRef.current.clear();
      cachedIdSetRef.current.clear();
      const rscPath = encodeRoutePath(route.path);
      const rscParams = createRscParams(route.query);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      refetch(rscPath, rscParams);
    };
    globalThis.__WAKU_RSC_RELOAD_LISTENERS__ ||= [];
    const index = globalThis.__WAKU_RSC_RELOAD_LISTENERS__.indexOf(
      globalThis.__WAKU_REFETCH_ROUTE__!,
    );
    if (index !== -1) {
      globalThis.__WAKU_RSC_RELOAD_LISTENERS__.splice(index, 1, refetchRoute);
    } else {
      globalThis.__WAKU_RSC_RELOAD_LISTENERS__.unshift(refetchRoute);
    }
    globalThis.__WAKU_REFETCH_ROUTE__ = refetchRoute;
  }

  const elementsPromise = useElementsPromise();
  const [has404, setHas404] = useState(false);
  const staticPathSetRef = useRef(new Set<string>());
  const cachedIdSetRef = useRef(new Set<string>());
  // FIXME this "fetchingSlices" hack feels suboptimal.
  const fetchingSlicesRef = useRef(new Set<SliceId>());
  useEffect(() => {
    elementsPromise.then(
      (elements) => {
        const {
          [ROUTE_ID]: routeData,
          [IS_STATIC_ID]: isStatic,
          [HAS404_ID]: has404FromElements,
          ...rest
        } = elements;
        if (has404FromElements) {
          setHas404(true);
        }
        if (routeData) {
          const [path, _query] = routeData as [string, string];
          if (isStatic) {
            staticPathSetRef.current.add(path);
          }
        }
        cachedIdSetRef.current = new Set(Object.keys(rest));
      },
      () => {},
    );
  }, [elementsPromise]);

  const refetch = useRefetch();
  const [route, setRoute] = useState(() => ({
    // This is the first initialization of the route, and it has
    // to ignore the hash, because on server side there is none.
    // Otherwise there will be a hydration error.
    // The client side route, including the hash, will be updated in the effect below.
    ...initialRoute,
    hash: '',
  }));
  // Update the route post-load to include the current hash.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = initialRoute;
    setRoute((prev) => (isSameRoute(prev, initialRoute) ? prev : initialRoute));
    setErr(null);
  }, [initialRoute]);
  const [err, setErr] = useState<unknown>(null);

  const routeChangeAbortRef = useRef<AbortSignal | null>(null);
  // @ts-expect-error tbd
  const routeChangeControllerRef = useRef<NavigationPrecommitController | null>(
    null,
  );
  const changeRoute: ChangeRoute = useCallback(
    async (nextRoute, options) => {
      // @ts-expect-error tbd
      const isAborted = () => routeChangeAbortRef.current?.aborted ?? false;
      const startTransitionFn =
        options.unstable_startTransition || ((fn: TransitionFunction) => fn());
      // @ts-expect-error tbd
      const prevPathname = window.location.pathname;
      // @ts-expect-error tbd
      let { mode, url } = options;
      const routeBeforeChange = routeRef.current;
      const shouldRefetch =
        options.refetch ?? !isSameRoute(nextRoute, routeBeforeChange);
      // @ts-expect-error tbd
      const pathChanged = isPathChange(nextRoute, routeBeforeChange);
      if (!staticPathSetRef.current.has(nextRoute.path) && shouldRefetch) {
        const rscPath = encodeRoutePath(nextRoute.path);
        const rscParams = createRscParams(nextRoute.query);
        const skipHeaderEnhancer =
          (fetchFn: typeof fetch) =>
          (input: RequestInfo | URL, init: RequestInit = {}) => {
            // if (init.signal === undefined) {
            //   init.signal = abortController.signal;
            // }
            const skipStr = JSON.stringify(Array.from(cachedIdSetRef.current));
            const headers = (init.headers ||= {});
            if (Array.isArray(headers)) {
              headers.push([SKIP_HEADER, skipStr]);
            } else if (headers instanceof Headers) {
              headers.set(SKIP_HEADER, skipStr);
            } else {
              (headers as Record<string, string>)[SKIP_HEADER] = skipStr;
            }
            return fetchFn(input, init);
          };
        try {
          const elements = await refetch(
            rscPath,
            rscParams,
            withEnhanceFetchFn(skipHeaderEnhancer),
          );
          const { [ROUTE_ID]: routeData, [IS_STATIC_ID]: isStatic } = elements;
          if (routeData) {
            const [path, query] = routeData as [string, string];
            if (
              nextRoute.path !== path ||
              (!isStatic && nextRoute.query !== query)
            ) {
              nextRoute = {
                path,
                query,
                hash: '',
              };
              if (mode) {
                mode = path === '/404' ? undefined : 'push';
                url = undefined;
              }
            }
          }
        } catch (e) {
          // if (isAborted()) {
          //   return;
          // }
          routeChangeAbortRef.current = null;
          // Write URL synchronously
          // React may rollback transition state updates when the render throws
          // if (mode && window.location.pathname === prevPathname) {
          //   const urlToWrite = url || getRouteUrl(nextRoute);
          //   writeUrlToHistory(mode, urlToWrite);
          // }
          setErr(e);
          throw e;
        }
      }
      // if (isAborted()) {
      //   return;
      // }
      startTransitionFn(() => {
        // if (isAborted()) {
        //   return;
        // }
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        setErr(null);
        routeChangeAbortRef.current = null;
      });
    },
    [refetch],
  );
  const applyChangeRouteData = useCallback(
    async (routeData: unknown, isStatic: unknown) => {
      if (!routeData) {
        return;
      }
      const [path, query] = routeData as [string, string];
      const currentRoute = routeRef.current;
      if (
        currentRoute.path === path &&
        (isStatic || currentRoute.query === query)
      ) {
        return;
      }
      const url = new URL(window.location.href);
      url.pathname = path;
      url.search = query;
      url.hash = '';
      await changeRoute(parseRoute(url), {
        refetch: false,
        shouldScroll: false,
        mode: path === '/404' ? undefined : 'push',
        url,
      });
    },
    [changeRoute],
  );
  const fetchRscStore = useFetchRscStore();
  useEffect(() => {
    const listener = (elements: Record<string, unknown>) => {
      const { [ROUTE_ID]: routeData, [IS_STATIC_ID]: isStatic } = elements;
      applyChangeRouteData(routeData, isStatic).catch((err) => {
        console.log('Error while handling route updates:', err);
      });
    };
    return registerCallServerElementsListener(fetchRscStore, listener);
  }, [applyChangeRouteData, fetchRscStore]);

  const prefetchRoute: PrefetchRoute = useCallback((route) => {
    if (staticPathSetRef.current.has(route.path)) {
      return;
    }
    const rscPath = encodeRoutePath(route.path);
    const rscParams = createRscParams(route.query);
    const skipHeaderEnhancer =
      (fetchFn: typeof fetch) =>
      (input: RequestInfo | URL, init: RequestInit = {}) => {
        const skipStr = JSON.stringify(Array.from(cachedIdSetRef.current));
        const headers = (init.headers ||= {});
        if (Array.isArray(headers)) {
          headers.push([SKIP_HEADER, skipStr]);
        } else if (headers instanceof Headers) {
          headers.set(SKIP_HEADER, skipStr);
        } else {
          (headers as Record<string, string>)[SKIP_HEADER] = skipStr;
        }
        return fetchFn(input, init);
      };
    prefetchRsc(rscPath, rscParams, withEnhanceFetchFn(skipHeaderEnhancer));
    (globalThis as any).__WAKU_ROUTER_PREFETCH__?.(route.path, (id: string) => {
      preloadModule(id, { as: 'script' });
    });
  }, []);

  // https://github.com/facebook/react/blob/main/fixtures/view-transition/src/components/App.js
  useEffect(() => {
    const callback = ((event: NavigateEvent) => {
      if (
        !event.canIntercept ||
        // If this is a download,
        // let the browser perform the download.
        event.downloadRequest ||
        // If this is a form submission,
        // let that go to the server.
        event.formData
      ) {
        return;
      } else if (
        // If this is just a hashChange,
        // just let the browser handle scrolling to the content.
        event.hashChange
      ) {
        setRoute((prev) => ({
          ...prev,
          hash: new URL(event.destination.url).hash,
        }));
        return;
      }
      const url = new URL(event.destination.url);
      const route = parseRoute(url);
      // console.log(event);
      const navigationType = event.navigationType;
      const previousIndex = window.navigation.currentEntry!.index;
      event.intercept({
        // @ts-expect-error tbd
        async precommitHandler(controller) {
          if (routeChangeAbortRef.current) {
            // It happens when click very fast.
            console.warn('Potential race condition due to rapid navigation.');
          }
          routeChangeAbortRef.current = event.signal;
          // controllerRef.current = controller;
          startTransition(async () => {
            // addTransitionType('navigation-' + navigationType);
            if (navigationType === 'traverse') {
              // For traverse types it's useful to distinguish going back or forward.
              const nextIndex = event.destination.index;
              if (nextIndex > previousIndex) {
                // addTransitionType('navigation-forward');
              } else if (nextIndex < previousIndex) {
                // addTransitionType('navigation-back');
              }
              // const err = customErrorHandlerRef.current?.state.error;
              if (err) {
                const info = getErrorInfo(err);
                if (info?.status === 404) {
                  // if 404 sans 404.tsx, manually go back
                  // should make CustomErrorHandler state
                  // Haha, upstream is broken too
                  // customErrorHandlerRef.current?.reset();
                }
              }
              await changeRoute(route, {
                shouldScroll: false,
                unstable_startTransition: startTransition,
                signal: event.signal,
              }).catch((err) => {
                console.log('Error while navigating back:', err);
              });
            } else {
              prefetchRoute(route);
              try {
                await changeRoute(route, {
                  shouldScroll: false,
                  unstable_startTransition: startTransition,
                  signal: event.signal,
                });
              } catch (err) {
                // Handle 404, etc here
                // customErrorHandlerRef.current?.setState({ error: err });
                resolver.current?.();
                if (has404 && err) {
                  const info = getErrorInfo(err);
                  if (info?.status === 404) {
                    await changeRoute(
                      { path: '/404', query: '', hash: '' },
                      {
                        signal: event.signal,
                        shouldScroll: false,
                      },
                    );
                  }
                }
              }
            }
            if (routeChangeAbortRef.current === event.signal) {
              routeChangeAbortRef.current = null;
            }
            // if (controllerRef.current === controller) {
            //   controllerRef.current = null;
            // }
          });
          await flushAsync();
          return;
        },
        scroll: 'after-transition',
      });
    }) as EventListener;
    window.navigation.addEventListener('navigate', callback);
    return () => {
      window.navigation.removeEventListener('navigate', callback);
    };
  }, [changeRoute, prefetchRoute, has404, err]);

  // run after new route DOM mounted
  useEffect(() => {
    resolver.current?.();
    resolver.current = null;
  }, [route]);

  const resolver = useRef<(value?: undefined) => void>(null);

  async function flushAsync() {
    const deferred = Promise.withResolvers();
    resolver.current = deferred.resolve;
    await deferred.promise;
    return;
  }

  const routeElement = (
    // err !== null ? (
    //   <ThrowError error={err} />
    // ) :
    <Slot id={getRouteSlotId(route.path)} />
  );
  const rootElement = (
    <Slot id="root">
      <meta name="httpstatus" content={httpStatus} />
      <CustomErrorHandler has404={has404}>{routeElement}</CustomErrorHandler>
    </Slot>
  );
  return (
    <RouterContext
      value={{
        route,
        changeRoute,
        prefetchRoute,
        fetchingSlices: fetchingSlicesRef.current,
      }}
    >
      {rootElement}
    </RouterContext>
  );
};

export function Router({
  initialRoute = parseRouteFromLocation(),
  unstable_fetchRscStore,
  unstable_routeInterceptor,
}: {
  initialRoute?: RouteProps;
  unstable_fetchRscStore?: Parameters<typeof Root>[0]['unstable_fetchRscStore'];
  unstable_routeInterceptor?: (route: RouteProps) => RouteProps | false;
}) {
  const initialRscPath = encodeRoutePath(initialRoute.path);
  const initialRscParams = createRscParams(initialRoute.query);
  const httpStatus = getHttpStatusFromMeta();
  return (
    <Root
      initialRscPath={initialRscPath}
      initialRscParams={initialRscParams}
      unstable_fetchRscStore={unstable_fetchRscStore}
    >
      <InnerRouter
        initialRoute={initialRoute}
        httpStatus={httpStatus}
        routeInterceptor={unstable_routeInterceptor}
      />
    </Root>
  );
}

/**
 * ServerRouter for SSR
 * This is not a public API.
 */
export function INTERNAL_ServerRouter({
  route,
  httpstatus,
}: {
  route: RouteProps;
  httpstatus: number;
}) {
  const routeElement = <Slot id={getRouteSlotId(route.path)} />;
  const rootElement = (
    <Slot id="root">
      <meta name="httpstatus" content={`${httpstatus}`} />
      {routeElement}
    </Slot>
  );
  return (
    <>
      <RouterContext
        value={{
          route,
          changeRoute: notAvailableInServer('changeRoute'),
          prefetchRoute: notAvailableInServer('prefetchRoute'),
          fetchingSlices: new Set<SliceId>(),
        }}
      >
        {rootElement}
      </RouterContext>
    </>
  );
}

// Highly experimental to expose internal APIs
// Subject to change without notice
export type Unstable_RouteProps = RouteProps;
export const unstable_HAS404_ID = HAS404_ID;
export const unstable_IS_STATIC_ID = IS_STATIC_ID;
export const unstable_ROUTE_ID = ROUTE_ID;
export const unstable_SKIP_HEADER = SKIP_HEADER;
export const unstable_encodeRoutePath = encodeRoutePath;
export const unstable_encodeSliceId = encodeSliceId;
export const unstable_getRouteSlotId = getRouteSlotId;
export const unstable_getSliceSlotId = getSliceSlotId;
export const unstable_getErrorInfo = getErrorInfo;
export const unstable_addBase = addBase;
export const unstable_removeBase = removeBase;
export const unstable_RouterContext = RouterContext;
export type Unstable_ChangeRoute = ChangeRoute;
export type Unstable_PrefetchRoute = PrefetchRoute;
export type Unstable_SliceId = SliceId;
export type Unstable_InferredPaths = InferredPaths;
export const unstable_parseRoute = parseRoute;
export const unstable_getHttpStatusFromMeta = getHttpStatusFromMeta;
