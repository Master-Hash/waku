import type { ReactNode } from 'react';
import { Link } from 'waku/router/client';

const HomeLayout = ({ children }: { children: ReactNode }) => (
  <div>
    <title>Waku</title>
    <ul>
      <li>
        <Link
          to="/"
        >
          Home
        </Link>
      </li>
      <li>
        <Link
          to="/foo"
        >
          Foo
        </Link>
      </li>
      <li>
        <Link
          to="/bar"
          unstable_prefetchOnEnter
        >
          Bar
        </Link>
      </li>
      <li>
        <Link
          to="/nested/baz"
        >
          Nested / Baz
        </Link>
      </li>
      <li>
        <Link
          to="/nested/qux"
        >
          Nested / Qux
        </Link>
      </li>
      <li>
        <Link to="/slice-page">Slice Page</Link>
      </li>
    </ul>
    {children}
  </div>
);

export default HomeLayout;
