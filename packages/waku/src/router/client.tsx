'use client';

import {
  Component,
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
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
  unstable_startTransition?: ((fn: TransitionFunction) => void) | undefined;
};

type ChangeRoute = (
  route: RouteProps,
  options: ChangeRouteOptions,
) => Promise<void>;

type PrefetchRoute = (route: RouteProps) => void;

type SliceId = string;

const PendingContext = createContext<boolean>(false);

// Not sure whether this is necessary
// We have navigation.transition
// but it's not reactive
export function usePending() {
  return use(PendingContext);
}

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
  useEffect(() => {
    // ensure single re-fetch per server redirection error on StrictMode
    // https://github.com/wakujs/waku/pull/1512
    if (handledErrorSet.has(error as object)) {
      return;
    }
    handledErrorSet.add(error as object);

    const url = new URL(to, window.location.href);

    window.navigation.navigate(url, { history: 'replace' });
  }, [error, handledErrorSet, to]);
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
            error={this.state.error}
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

const scrollToRoute = (
  route: RouteProps,
  behavior: ScrollBehavior,
  scrollTopForMissingHash: boolean,
) => {
  if (route.hash) {
    const element = document.getElementById(route.hash.slice(1));
    if (!element) {
      if (!scrollTopForMissingHash) {
        return;
      }
      window.scrollTo({
        left: 0,
        top: 0,
        behavior,
      });
      return;
    }
    const scrollMarginTop =
      Number.parseFloat(window.getComputedStyle(element).scrollMarginTop) || 0;
    window.scrollTo({
      left: 0,
      top:
        element.getBoundingClientRect().top + window.scrollY - scrollMarginTop,
      behavior,
    });
    return;
  }
  window.scrollTo({
    left: 0,
    top: 0,
    behavior,
  });
};

const InnerRouter = ({
  initialRoute,
  httpStatus,
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
  const routeChangeListenersRef = useRef<ReturnType<
    typeof createRouteChangeListeners
  > | null>(null);
  if (routeChangeListenersRef.current === null) {
    routeChangeListenersRef.current = createRouteChangeListeners();
  }
  // Update the route post-load to include the current hash.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = initialRoute;
    setRoute((prev) => (isSameRoute(prev, initialRoute) ? prev : initialRoute));
    setErr(null);
    setPendingScroll(null);
    setPendingHistory(null);
  }, [initialRoute]);
  const [err, setErr] = useState<unknown>(null);
  const [pendingHistory, setPendingHistory] = useState<{
    mode: 'push' | 'replace';
    url: URL | undefined;
  } | null>(null);
  useLayoutEffect(() => {
    if (pendingHistory) {
      const { mode, url } = pendingHistory;
      const urlToWrite = url || getRouteUrl(route);
      writeUrlToHistory(mode, urlToWrite);
    }
  }, [route, pendingHistory]);
  const [pendingScroll, setPendingScroll] = useState<{
    pathChanged: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll) {
      const { pathChanged } = pendingScroll;
      const scrollBehavior: ScrollBehavior = pathChanged ? 'instant' : 'auto';
      scrollToRoute(route, scrollBehavior, pathChanged);
    }
  }, [route, pendingScroll]);
  // TODO(daishi): consider combining three or four useState hooks above.

  const [routeChangeEvents, emitRouteChangeEvent] =
    routeChangeListenersRef.current;
  const routeChangeAbortRef = useRef<AbortController | null>(null);
  const changeRoute: ChangeRoute = useCallback(
    async (nextRoute, options) => {
      routeChangeAbortRef.current?.abort();
      const abortController = new AbortController();
      routeChangeAbortRef.current = abortController;
      const isAborted = () => abortController.signal.aborted;
      emitRouteChangeEvent('start', nextRoute);
      const startTransitionFn =
        options.unstable_startTransition || ((fn: TransitionFunction) => fn());
      const prevPathname = window.location.pathname;
      let { mode, url } = options;
      const routeBeforeChange = routeRef.current;
      const shouldRefetch =
        options.refetch ?? !isSameRoute(nextRoute, routeBeforeChange);
      const pathChanged = isPathChange(nextRoute, routeBeforeChange);
      if (!staticPathSetRef.current.has(nextRoute.path) && shouldRefetch) {
        const rscPath = encodeRoutePath(nextRoute.path);
        const rscParams = createRscParams(nextRoute.query);
        const skipHeaderEnhancer =
          (fetchFn: typeof fetch) =>
          (input: RequestInfo | URL, init: RequestInit = {}) => {
            if (init.signal === undefined) {
              init.signal = abortController.signal;
            }
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
          if (isAborted()) {
            return;
          }
          routeChangeAbortRef.current = null;
          // Write URL synchronously
          // React may rollback transition state updates when the render throws
          if (mode && window.location.pathname === prevPathname) {
            const urlToWrite = url || getRouteUrl(nextRoute);
            writeUrlToHistory(mode, urlToWrite);
          }
          setErr(e);
          throw e;
        }
      }
      if (isAborted()) {
        return;
      }
      startTransitionFn(() => {
        if (isAborted()) {
          return;
        }
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        setErr(null);
        setPendingScroll(options.shouldScroll ? { pathChanged } : null);
        setPendingHistory(mode ? { mode, url } : null);
        routeChangeAbortRef.current = null;
        emitRouteChangeEvent('complete', nextRoute);
      });
    },
    [emitRouteChangeEvent, refetch],
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

  useEffect(() => {
    const callback = () => {
      const nextRoute = routeInterceptor(
        parseRoute(new URL(window.location.href)),
      );
      if (!nextRoute) {
        return;
      }
      changeRoute(nextRoute, {
        shouldScroll: shouldScrollForRouteChange(nextRoute, routeRef.current),
      }).catch((err) => {
        console.log('Error while navigating back:', err);
      });
    };
    window.addEventListener('popstate', callback);
    return () => {
      window.removeEventListener('popstate', callback);
    };
  }, [changeRoute, routeInterceptor]);

  const routeElement =
    err !== null ? (
      <ThrowError error={err} />
    ) : (
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
        routeChangeEvents,
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
  unstable_fetchRscStore?: Parameters<typeof Root>[0]['fetchRscStore'];
  unstable_routeInterceptor?: (route: RouteProps) => RouteProps | false;
}) {
  const initialRscPath = encodeRoutePath(initialRoute.path);
  const initialRscParams = createRscParams(initialRoute.query);
  const httpStatus = getHttpStatusFromMeta();
  return (
    <Root
      initialRscPath={initialRscPath}
      initialRscParams={initialRscParams}
      fetchRscStore={unstable_fetchRscStore}
    >
      <InnerRouter
        initialRoute={initialRoute}
        httpStatus={httpStatus}
        routeInterceptor={unstable_routeInterceptor}
      />
    </Root>
  );
}

const MOCK_ROUTE_CHANGE_LISTENER: Record<
  'on' | 'off',
  (event: ChangeRouteEvent, handler: ChangeRouteCallback) => void
> = {
  on: () => notAvailableInServer('routeChange:on'),
  off: () => notAvailableInServer('routeChange:off'),
};

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
          routeChangeEvents: MOCK_ROUTE_CHANGE_LISTENER,
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
