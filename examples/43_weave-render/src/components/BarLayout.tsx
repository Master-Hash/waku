import type { ReactNode } from 'react';
import { Link } from 'waku/router/client';

import '../styles.css';

const Pending = ({ isPending }: { isPending: boolean }) => (
  <span
    style={{
      marginLeft: 5,
      transition: 'opacity 75ms 100ms',
      opacity: isPending ? 1 : 0,
    }}
  >
    Pending...
  </span>
);

const BarLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div>
      <p>This Layout is expected to be static</p>
      <ul>
        <li>
          <Link to="/">Home</Link>
        </li>
        <li>
          <Link to="/foo">Foo</Link>
        </li>
        <li>
          <Link to={'/nested/bar' as never}>Link to 404</Link>
        </li>
      </ul>
      {children}
    </div>
  );
};

export default BarLayout;
