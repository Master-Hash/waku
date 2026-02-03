import type { ReactNode } from 'react';
import { Link } from 'waku/router/client';

const HomeLayout = ({ children }: { children: ReactNode }) => (
  <div>
    <title>Waku</title>
    <ul>
      <li>
        <Link to="/">Home</Link>
      </li>
      <li>
        <Link to="/foo">Foo</Link>
      </li>
      <li>
        <Link to="/bar" unstable_prefetchOnEnter>
          Bar
        </Link>
      </li>
      <li>
        <Link to="/nested/baz">Nested / Baz</Link>
      </li>
      <li>
        <Link to="/nested/qux">Nested / Qux</Link>
      </li>
      <li>
        <Link to="/nested/encoded%20path">Nested / Encoded Path</Link>
      </li>
      <li>
        <Link to="/nested/encoded%E6%B8%AC%E8%A9%A6path">
          Nested / Encoded Unicode Path
        </Link>
      </li>
      <li>
        <Link to="/static-nested/encoded%20path">
          Nested / Static Encoded Path
        </Link>
      </li>
      <li>
        <Link to="/static-nested/encoded%E6%B8%AC%E8%A9%A6path">
          Nested / Static Encoded Unicode Path
        </Link>
      </li>
      <li>
        <Link to="/page-with-slices">Page with Slices</Link>
      </li>
      <li>
        <Link to="/css-split">Css split</Link>
      </li>
      <li>
        <Link to="/page-with-segment/introducing-waku">
          Page with Segment / Introducing Waku
        </Link>
      </li>
      <li>
        <Link to="/page-with-segment/article/introducing-waku">
          Page with Segment / Article / Introducing Waku
        </Link>
      </li>
    </ul>
    {children}
  </div>
);

export default HomeLayout;
