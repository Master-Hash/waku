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

const getCurrentTime = () => new Date();

const HomeLayout = ({ children }: { children: ReactNode }) => {
  const currentTime = getCurrentTime();
  return (
    <>
      <title>Waku</title>

      <div>
        <h1>Home layout</h1>
        <p>Last render time: {currentTime.toISOString()}</p>
        <ul>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li>
            <Link to="/foo">Foo</Link>
          </li>
          <li>
            <Link to="/bar">Bar</Link>
          </li>
        </ul>
        {children}
      </div>
    </>
  );
};

export default HomeLayout;
