import type { ReactNode } from 'react';
import { Link } from 'waku/router/client';

const HomeLayout = ({ children }: { children: ReactNode }) => (
  <div>
    <ul>
      <li>
        <Link to="/">Home</Link>
      </li>
      <li>
        <Link to="/foo">Foo</Link>
      </li>
      <li>
        <Link to="/bar1">Bar1</Link>
      </li>
      <li>
        <Link to="/bar2">Bar2</Link>
      </li>
      <li>
        <Link to="/baz1">Baz1</Link>
      </li>
      <li>
        <Link to="/baz2">Baz2</Link>
      </li>
    </ul>
    {children}
  </div>
);

export default HomeLayout;
